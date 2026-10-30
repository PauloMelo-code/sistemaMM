/**
 * Devolucoes e reembolsos do Mercado Livre (RN-126).
 *
 * O ML NAO muda o status do pedido numa devolucao — ele continua `paid`. Quem
 * diz que houve devolucao e a reclamacao (claim). Daqui saem duas portas:
 * - a varredura das reclamacoes do vendedor (conferencia a cada 15 min), que
 *   tambem acha as devolucoes antigas;
 * - a notificacao `post_purchase` (`handlerReclamacaoML`).
 *
 * So GET no ML. O que fazer com o pedido e com a peca mora em
 * `../cancelamento.ts`; a leitura do formato, em `devolucao-ml.ts`.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { pedidos } from "@/lib/db/schema/pedidos";

import { chamarML, ErroML, type Lane } from "./client";
import { decidirDevolucao, lerDevolucao, lerPaginaReclamacoes, lerReclamacao } from "./devolucao-ml";
import { cancelarPedido } from "../cancelamento";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";
import type { EventoParaHandler } from "../handlers";

const POR_PAGINA = 30;
/** Teto da varredura: as 150 reclamacoes mais recentes. A conta tem poucas. */
const MAX_PAGINAS = 5;

export type ResultadoReclamacao = "cancelado" | "atualizado" | "sem_mudanca" | "em_andamento" | "sem_pedido";

/** Decide e aplica uma reclamacao ja lida (da busca ou do GET por id). */
async function aplicar(bruta: unknown, lane: Lane): Promise<ResultadoReclamacao> {
  const rec = lerReclamacao(bruta);
  if (!rec?.numeroPedido) return "sem_pedido";

  const [local] = await db
    .select({ id: pedidos.id, status: pedidos.status, devolucao: pedidos.devolucao })
    .from(pedidos)
    .where(
      and(
        eq(pedidos.canal, "mercado_livre"),
        eq(pedidos.numero, rec.numeroPedido),
        eq(pedidos.is_deleted, false),
      ),
    );
  if (!local) return "sem_pedido";
  // Ja resolvido aqui: nao gasta chamada no ML de novo.
  if (local.status === "cancelado" && local.devolucao !== null) return "sem_mudanca";

  let devolucao = null;
  if (rec.temDevolucao) {
    try {
      devolucao = lerDevolucao(await chamarML(`/post-purchase/v2/claims/${rec.id}/returns`, { lane }));
    } catch (erro) {
      if (!(erro instanceof ErroML && erro.status === 404)) throw erro;
    }
  }

  const decisao = decidirDevolucao(rec, devolucao);
  if (!decisao) return "em_andamento";

  return db.transaction((tx) =>
    cancelarPedido(tx, local.id, {
      motivo: decisao,
      idReclamacao: rec.id,
      usuarioId: USUARIO_SISTEMA_ID,
    }),
  );
}

export interface ResumoReclamacoes {
  lidas: number;
  canceladas: number;
  emAndamento: number;
  falhas: number;
}

/** Varredura das reclamacoes em que a conta e a parte reclamada. */
export async function varrerReclamacoes(): Promise<ResumoReclamacoes> {
  const { id } = await chamarML<{ id: number | string }>("/users/me");
  const resumo: ResumoReclamacoes = { lidas: 0, canceladas: 0, emAndamento: 0, falhas: 0 };

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const busca = new URLSearchParams({
      "players.role": "respondent",
      "players.user_id": String(id),
      limit: String(POR_PAGINA),
      offset: String(pagina * POR_PAGINA),
    });
    const lista = lerPaginaReclamacoes(await chamarML(`/post-purchase/v1/claims/search?${busca}`));

    for (const bruta of lista) {
      resumo.lidas += 1;
      try {
        const r = await aplicar(bruta, "varredura");
        if (r === "cancelado" || r === "atualizado") resumo.canceladas += 1;
        if (r === "em_andamento") resumo.emAndamento += 1;
      } catch (erro) {
        resumo.falhas += 1;
        console.warn("[devolucoes-ml] reclamacao nao processada", erro);
      }
    }
    if (lista.length < POR_PAGINA) break;
  }
  return resumo;
}

/**
 * Handler da notificacao `post_purchase` (reclamacoes). O recurso e
 * `/post-purchase/v1/claims/{id}` — a doc avisa que o prefixo e recente, entao
 * aceita os dois formatos.
 */
export async function handlerReclamacaoML(evento: EventoParaHandler): Promise<void> {
  const idReclamacao = evento.recurso?.match(/\/claims\/(\d+)/)?.[1];
  if (!idReclamacao) return;
  const bruta = await chamarML(`/post-purchase/v1/claims/${idReclamacao}`, { lane: "urgente" });
  await aplicar(bruta, "urgente");
}
