"use server";

/**
 * Escrita na caixa de perguntas. Hoje so "Arquivar" — responder ainda nao
 * existe (docs/known-issues.md).
 *
 * Arquivar tira a pergunta da caixa e do SLA sem responder: para o caso em que
 * o ML ainda a da como aberta, mas ela nao pede resposta (anuncio pausado que o
 * painel do ML nem mostra mais, por exemplo). Exclusao LOGICA com trilha: da
 * para saber quem arquivou, quando e o que.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { perguntas } from "@/lib/db/schema/perguntas";
import { registrarAuditoria } from "@/lib/audit/logger";
import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao } from "@/lib/auth/sessao";

import type { Resultado } from "./lotes-mutacoes";

export async function arquivarPergunta(id: string): Promise<Resultado> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  if (!temPermissao(sessao.papel, "perguntas", "atualizar")) {
    return { ok: false, erro: "Você não tem permissão para arquivar perguntas." };
  }

  const arquivada = await db.transaction(async (tx) => {
    const [linha] = await tx
      .update(perguntas)
      .set({
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date(),
        modified_by: sessao.usuarioId,
      })
      // So pendente: respondida e historico de atendimento, nao trabalho.
      .where(and(eq(perguntas.id, id), eq(perguntas.status, "pendente"), eq(perguntas.is_deleted, false)))
      .returning();

    if (!linha) return false;

    await registrarAuditoria(tx, {
      userId: sessao.usuarioId,
      acao: "excluir",
      tabela: "perguntas",
      registroId: linha.id,
      detalhes: `Arquivou sem responder a pergunta "${linha.texto.slice(0, 80)}" (${linha.canal})`,
      dadosNovos: linha,
    });
    return true;
  });

  if (!arquivada) return { ok: false, erro: "A pergunta não está mais pendente." };

  revalidatePath("/perguntas");
  revalidatePath("/");
  return { ok: true, dados: null };
}
