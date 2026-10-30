/**
 * Status de envio dos pedidos do Mercado Livre: aguardando, em transporte,
 * concluido — e cancelado quando o pedido e cancelado no ML.
 *
 * Antes disto o pedido era gravado uma vez e nunca mais olhado: todos ficavam
 * "Aguardando envio" para sempre, inclusive os entregues ha meses.
 *
 * Tres portas, uma regra so (`atualizarPedidoML`):
 * - a conferencia a cada 15 min (`atualizarEnviosPendentes`), que tambem corrige
 *   o historico na primeira passada;
 * - a notificacao `shipments` (`handlerEnvioML`);
 * - a notificacao `orders_v2` de um pedido que ja existe (handler de venda).
 *
 * So GET no ML. A traducao de status mora em `envio-ml.ts`.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { pedidos } from "@/lib/db/schema/pedidos";
import { registrarAuditoria } from "@/lib/audit/logger";

import { chamarML, type Lane } from "./client";
import { lerPedidoParaEnvio, lerStatusDoEnvio, statusPedidoPara } from "./envio-ml";
import { cancelarPedido } from "../cancelamento";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";
import type { EventoParaHandler } from "../handlers";

/** Pedidos por passada da conferencia. Sao 2 GETs cada; o resto fica para a proxima. */
const POR_PASSADA = 100;

const ROTULO: Record<string, string> = {
  aguardando_envio: "aguardando envio",
  em_transporte: "em transporte",
  concluido: "concluido",
  cancelado: "cancelado",
};

/**
 * Le pedido e envio no ML e atualiza o pedido daqui. `pedidoBruto` evita buscar
 * de novo quando quem chama ja tem o pedido em maos.
 *
 * `cancelado` e final: nao volta a outro status por aqui (o pedido ja saiu do
 * faturamento, e reverter isso pede gente).
 */
export async function atualizarPedidoML(
  numero: string,
  { lane = "varredura", pedidoBruto }: { lane?: Lane; pedidoBruto?: unknown } = {},
): Promise<"alterado" | "igual" | "ausente"> {
  const [local] = await db
    .select({ id: pedidos.id, status: pedidos.status, idEnvio: pedidos.id_envio_externo })
    .from(pedidos)
    .where(and(eq(pedidos.canal, "mercado_livre"), eq(pedidos.numero, numero), eq(pedidos.is_deleted, false)));

  if (!local) return "ausente";
  if (local.status === "cancelado") return "igual";

  const pedido = lerPedidoParaEnvio(pedidoBruto ?? (await chamarML(`/orders/${numero}`, { lane })));
  const statusEnvio = pedido.idEnvio
    ? lerStatusDoEnvio(
        await chamarML(`/shipments/${pedido.idEnvio}`, { lane, cabecalhos: { "x-format-new": "true" } }),
      )
    : null;

  const novo = statusPedidoPara(pedido, statusEnvio);
  const mudaStatus = novo !== null && novo !== local.status;
  const mudaEnvio = pedido.idEnvio !== null && pedido.idEnvio !== local.idEnvio;
  if (!mudaStatus && !mudaEnvio) return "igual";

  await db.transaction(async (tx) => {
    // Cancelar decide tambem o destino da peca (RN-126): mora em um lugar so.
    if (novo === "cancelado") {
      if (mudaEnvio) {
        await tx.update(pedidos).set({ id_envio_externo: pedido.idEnvio }).where(eq(pedidos.id, local.id));
      }
      await cancelarPedido(tx, local.id, { motivo: "cancelado_no_canal", usuarioId: USUARIO_SISTEMA_ID });
      return;
    }

    await tx
      .update(pedidos)
      .set({
        ...(mudaStatus ? { status: novo } : {}),
        ...(mudaEnvio ? { id_envio_externo: pedido.idEnvio } : {}),
        updated_at: new Date(),
        modified_by: USUARIO_SISTEMA_ID,
      })
      .where(eq(pedidos.id, local.id));

    if (mudaStatus) {
      await registrarAuditoria(tx, {
        userId: USUARIO_SISTEMA_ID,
        acao: "atualizar",
        tabela: "pedidos",
        registroId: local.id,
        detalhes:
          `Pedido ${numero} do Mercado Livre: ${ROTULO[local.status]} -> ${ROTULO[novo]} ` +
          `(pedido "${pedido.status ?? "?"}", envio "${statusEnvio ?? "sem envio"}")`,
      });
    }
  });

  return mudaStatus ? "alterado" : "igual";
}

export interface ResumoEnvios {
  conferidos: number;
  alterados: number;
  falhas: number;
}

/**
 * Passada da conferencia: os pedidos do ML que ainda nao terminaram. Uma falha
 * nao derruba as outras — fica para a proxima passada.
 */
export async function atualizarEnviosPendentes(): Promise<ResumoEnvios> {
  const abertos = await db
    .select({ numero: pedidos.numero })
    .from(pedidos)
    .where(
      and(
        eq(pedidos.canal, "mercado_livre"),
        inArray(pedidos.status, ["aguardando_envio", "em_transporte"]),
        eq(pedidos.is_deleted, false),
      ),
    )
    .orderBy(pedidos.vendido_em)
    .limit(POR_PASSADA);

  const resumo: ResumoEnvios = { conferidos: 0, alterados: 0, falhas: 0 };
  for (const { numero } of abertos) {
    resumo.conferidos += 1;
    try {
      if ((await atualizarPedidoML(numero)) === "alterado") resumo.alterados += 1;
    } catch (erro) {
      resumo.falhas += 1;
      console.warn(`[envios-ml] pedido ${numero}: falha ao atualizar`, erro);
    }
  }
  return resumo;
}

/**
 * Handler da notificacao `shipments`: o recurso e `/shipments/{id}`. Acha o
 * pedido pelo envio e atualiza. Envio de pedido que ainda nao chegou aqui e
 * ignorado — a notificacao do pedido vem e grava o envio junto.
 */
export async function handlerEnvioML(evento: EventoParaHandler): Promise<void> {
  const idEnvio = evento.recurso?.match(/\/shipments\/(\d+)/)?.[1];
  if (!idEnvio) return;

  const [local] = await db
    .select({ numero: pedidos.numero })
    .from(pedidos)
    .where(
      and(
        eq(pedidos.canal, "mercado_livre"),
        eq(pedidos.id_envio_externo, idEnvio),
        eq(pedidos.is_deleted, false),
      ),
    );
  if (!local) return;

  await atualizarPedidoML(local.numero, { lane: "urgente" });
}
