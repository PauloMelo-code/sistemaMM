/**
 * TEMPLATE-OURO: Server Action (CRUD centralizado).
 *
 * Copie para src/lib/actions/<entidade>.ts. Concentra TODA a regra de negocio
 * da entidade em um unico lugar (SOLID-S). Telas/menus chamam estas funcoes —
 * nunca duplicam logica.
 *
 * Garante: autenticacao, RBAC, validacao Zod, soft delete, optimistic locking,
 * auditoria. Rode `node scripts/check-compliance.mjs` apos criar.
 */
"use server";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contratosLancamentos } from "@/lib/db/schema/contratos-lancamentos";
import { getSession, temPermissao } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/audit/logger";
import { lancamentoSchema } from "@/lib/validators/lancamento";

const tabela = contratosLancamentos;

/** Lista registros ativos (sempre filtra deletados). */
export async function listar() {
  const session = await getSession();
  if (!session) throw new Error("Nao autenticado");

  return db
    .select()
    .from(tabela)
    .where(eq(tabela.is_deleted, false))
    .orderBy(desc(tabela.created_at));
}

/** Cria registro validado + auditoria. */
export async function criar(dados: unknown) {
  const session = await getSession();
  if (!session) throw new Error("Nao autenticado");
  if (!temPermissao(session, "operador")) throw new Error("Sem permissao");

  const validado = lancamentoSchema.parse(dados);

  const [criado] = await db
    .insert(tabela)
    .values({ ...validado, modified_by: session.userId })
    .returning();

  await registrarAuditoria({
    userId: session.userId,
    acao: "criar",
    tabela: "contratos_lancamentos",
    registroId: criado.id,
    detalhes: `Criou lancamento ${criado.descricao}`,
    dadosNovos: criado,
  });

  return criado;
}

/**
 * Atualiza com optimistic locking: rejeita se outro usuario alterou o registro
 * desde que ele foi aberto (compara updated_at).
 */
export async function atualizar(
  id: string,
  dados: unknown,
  updatedAtOriginal: Date
) {
  const session = await getSession();
  if (!session) throw new Error("Nao autenticado");
  if (!temPermissao(session, "operador")) throw new Error("Sem permissao");

  const validado = lancamentoSchema.parse(dados);

  const resultado = await db
    .update(tabela)
    .set({ ...validado, updated_at: new Date(), modified_by: session.userId })
    .where(
      and(
        eq(tabela.id, id),
        eq(tabela.updated_at, updatedAtOriginal),
        eq(tabela.is_deleted, false)
      )
    )
    .returning();

  if (resultado.length === 0) {
    throw new Error(
      "Registro alterado por outro usuario. Recarregue e tente novamente."
    );
  }

  await registrarAuditoria({
    userId: session.userId,
    acao: "atualizar",
    tabela: "contratos_lancamentos",
    registroId: id,
    detalhes: `Atualizou lancamento ${id}`,
    dadosNovos: resultado[0],
  });

  return resultado[0];
}

/** Soft delete — NUNCA delete fisico. */
export async function excluir(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Nao autenticado");
  if (!temPermissao(session, "operador")) throw new Error("Sem permissao");

  const resultado = await db
    .update(tabela)
    .set({
      is_deleted: true,
      deleted_at: new Date(),
      updated_at: new Date(),
      modified_by: session.userId,
    })
    .where(and(eq(tabela.id, id), eq(tabela.is_deleted, false)))
    .returning();

  if (resultado.length > 0) {
    await registrarAuditoria({
      userId: session.userId,
      acao: "excluir",
      tabela: "contratos_lancamentos",
      registroId: id,
      detalhes: `Excluiu (soft) lancamento ${id}`,
    });
  }

  return resultado[0];
}
