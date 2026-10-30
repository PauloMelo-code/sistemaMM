/**
 * Cancelamento e devolucao de pedido — UM lugar so (RN-126).
 *
 * Quem chama: a atualizacao de envio (pedido cancelado no canal), a leitura de
 * reclamacoes (devolucao) e a conferencia manual ("Volta ao estoque"). Se cada
 * um decidisse sozinho quando a peca volta ao estoque, um caminho devolveria a
 * unidade que o outro ja devolveu.
 *
 * Roda DENTRO da transacao de quem chama.
 */
import { and, eq, sql } from "drizzle-orm";

import { itens } from "@/lib/db/schema/itens";
import { pedidos } from "@/lib/db/schema/pedidos";
import { registrarAuditoria, type Executor } from "@/lib/audit/logger";

export type MotivoCancelamento =
  /** O canal cancelou o pedido (o status dele virou cancelado). */
  | "cancelado_no_canal"
  /** A devolucao chegou ao vendedor e o dinheiro voltou ao comprador. */
  | "devolvido"
  /** Dinheiro devolvido, peca nao volta (low cost, reclamacao com reembolso). */
  | "reembolso_sem_volta";

/**
 * Soma unidades de volta ao item. Item que estava `vendido` vira `pausado`: o
 * anuncio precisa ser reativado por alguem, nao sozinho (RN-126).
 */
export async function reintegrarUnidades(
  tx: Executor,
  itemId: string,
  quantidade: number,
  usuarioId: string,
): Promise<void> {
  await tx
    .update(itens)
    .set({
      quantidade: sql`${itens.quantidade} + ${quantidade}`,
      situacao: sql`CASE WHEN ${itens.situacao} = 'vendido' THEN 'pausado'::situacao_item ELSE ${itens.situacao} END`,
      updated_at: new Date(),
      modified_by: usuarioId,
    })
    .where(eq(itens.id, itemId));
}

const FRASE: Record<MotivoCancelamento, string> = {
  cancelado_no_canal: "cancelado no canal",
  devolvido: "devolvido pelo comprador",
  reembolso_sem_volta: "reembolsado sem devolucao da peca",
};

/**
 * Cancela o pedido e decide o que acontece com a peca:
 * - cancelado ANTES do envio e a venda tinha baixado estoque -> unidades voltam;
 * - devolvido, ou cancelado depois do envio -> "a conferir" (gente decide);
 * - reembolso sem volta -> so cancela.
 *
 * Idempotente: pedido ja cancelado nao devolve nada de novo. So ganha o
 * "a conferir" se a devolucao chegar depois do cancelamento.
 */
export async function cancelarPedido(
  tx: Executor,
  pedidoId: string,
  { motivo, idReclamacao = null, usuarioId }: { motivo: MotivoCancelamento; idReclamacao?: string | null; usuarioId: string },
): Promise<"cancelado" | "atualizado" | "sem_mudanca"> {
  const [p] = await tx
    .select()
    .from(pedidos)
    .where(and(eq(pedidos.id, pedidoId), eq(pedidos.is_deleted, false)))
    .for("update");
  if (!p) return "sem_mudanca";

  if (p.status === "cancelado") {
    if (motivo !== "devolvido" || p.devolucao !== null) return "sem_mudanca";
    await tx
      .update(pedidos)
      .set({
        devolucao: "a_conferir",
        id_reclamacao_externo: idReclamacao ?? p.id_reclamacao_externo,
        updated_at: new Date(),
        modified_by: usuarioId,
      })
      .where(eq(pedidos.id, p.id));
    await registrarAuditoria(tx, {
      userId: usuarioId,
      acao: "atualizar",
      tabela: "pedidos",
      registroId: p.id,
      detalhes: `Pedido ${p.numero} (ja cancelado): a peca voltou, marcada para conferir (RN-126)`,
    });
    return "atualizado";
  }

  const antesDoEnvio = p.status === "aguardando_envio";
  const devolveSozinho = motivo === "cancelado_no_canal" && antesDoEnvio && p.baixou_estoque;
  const aConferir = motivo === "devolvido" || (motivo === "cancelado_no_canal" && !antesDoEnvio);

  await tx
    .update(pedidos)
    .set({
      status: "cancelado",
      ...(aConferir ? { devolucao: "a_conferir" as const } : {}),
      ...(idReclamacao ? { id_reclamacao_externo: idReclamacao } : {}),
      updated_at: new Date(),
      modified_by: usuarioId,
    })
    .where(eq(pedidos.id, p.id));

  if (devolveSozinho) await reintegrarUnidades(tx, p.item_id, p.quantidade, usuarioId);

  await registrarAuditoria(tx, {
    userId: usuarioId,
    acao: "atualizar",
    tabela: "pedidos",
    registroId: p.id,
    detalhes:
      `Pedido ${p.numero} ${FRASE[motivo]}: saiu do faturamento` +
      (devolveSozinho ? `; ${p.quantidade} unidade(s) voltaram ao estoque (nao tinha sido enviado)` : "") +
      (aConferir ? "; peca marcada para conferir antes de voltar ao estoque" : "") +
      (idReclamacao ? ` (reclamacao ${idReclamacao})` : ""),
  });

  return "cancelado";
}
