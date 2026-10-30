"use server";

/**
 * Conferencia da peca devolvida (RN-126): "Volta ao estoque" ou "Nao volta".
 *
 * Quem confere e quem mexe no estoque: `itens: atualizar` (administrador e
 * operador). Nao ha custo aqui — so unidades.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { pedidos } from "@/lib/db/schema/pedidos";
import { registrarAuditoria } from "@/lib/audit/logger";
import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao } from "@/lib/auth/sessao";
import { reintegrarUnidades } from "@/lib/integracoes/cancelamento";

import type { Resultado } from "./lotes-mutacoes";

export async function resolverDevolucao(pedidoId: string, volta: boolean): Promise<Resultado> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  if (!temPermissao(sessao.papel, "itens", "atualizar")) {
    return { ok: false, erro: "Você não tem permissão para mexer no estoque." };
  }

  const resolvido = await db.transaction(async (tx) => {
    // Trava: dois cliques nao podem devolver a unidade duas vezes.
    const [p] = await tx
      .select()
      .from(pedidos)
      .where(and(eq(pedidos.id, pedidoId), eq(pedidos.devolucao, "a_conferir"), eq(pedidos.is_deleted, false)))
      .for("update");
    if (!p) return false;

    if (volta) await reintegrarUnidades(tx, p.item_id, p.quantidade, sessao.usuarioId);

    await tx
      .update(pedidos)
      .set({
        devolucao: volta ? "reintegrada" : "descartada",
        updated_at: new Date(),
        modified_by: sessao.usuarioId,
      })
      .where(eq(pedidos.id, p.id));

    await registrarAuditoria(tx, {
      userId: sessao.usuarioId,
      acao: "atualizar",
      tabela: "pedidos",
      registroId: p.id,
      detalhes: volta
        ? `Conferiu a devolucao do pedido ${p.numero}: ${p.quantidade} unidade(s) voltaram ao estoque`
        : `Conferiu a devolucao do pedido ${p.numero}: a peca NAO volta ao estoque`,
    });
    return true;
  });

  if (!resolvido) return { ok: false, erro: "Esta devolução já foi conferida." };

  revalidatePath("/pedidos");
  revalidatePath("/estoque");
  return { ok: true, dados: null };
}
