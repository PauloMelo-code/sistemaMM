"use server";

/**
 * Escrita de Lotes: criar, atualizar e excluir.
 *
 * ARQUIVO SEPARADO DE `lotes.ts` por imposicao do Next, nao por gosto: um
 * modulo `"use server"` so pode exportar funcoes async, e `lotes.ts` exporta a
 * constante `LENTO_DIAS` e as funcoes puras `custoRecuperado`/`giroLento`.
 * Juntar os dois quebraria a compilacao. A leitura fica la; a escrita, aqui.
 *
 * TODA funcao daqui segue a mesma espinha, e nenhuma parte dela e opcional:
 *   1. `lerSessao()`   — quem e (e se ainda pode entrar)
 *   2. `temPermissao()`— pode fazer isto
 *   3. Zod             — o dado do formulario e confiavel
 *   4. transacao       — mutacao e auditoria juntas, ou nenhuma
 *   5. `revalidatePath`— a tela reflete o que acabou de acontecer
 */
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { lotes } from "@/lib/db/schema/lotes";
import { itens } from "@/lib/db/schema/itens";
import { lerSessao } from "@/lib/auth/sessao";
import { temPermissao } from "@/lib/auth/rbac";
import { registrarAuditoria, descreverMudancas } from "@/lib/audit/logger";
import { loteSchema, type EntradaLote } from "@/lib/validators/lote";

/** Resultado de toda mutacao: nunca lanca para o cliente, sempre explica. */
export type Resultado<T = null> = { ok: true; dados: T } | { ok: false; erro: string };

const CAMPOS = ["nome", "segmento", "data_arremate", "custo_total"] as const;

/**
 * Traduz erro de banco em frase util.
 *
 * `23505` (unico violado) e `23503` (FK) chegam aqui como mensagem crua do
 * Postgres, cheia de nome de indice. Quem le e o Anderson, nao o DBA.
 */
function explicar(erro: unknown): string {
  const codigo = (erro as { code?: string })?.code;
  if (codigo === "23503") return "Este lote esta ligado a registros que impedem a operacao.";
  console.error("[lotes] erro nao previsto", erro);
  return "Nao foi possivel concluir. Tente de novo.";
}

export async function criarLote(entrada: EntradaLote): Promise<Resultado<{ id: string }>> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessao expirada. Entre de novo." };
  if (!temPermissao(sessao.papel, "lotes", "criar")) {
    return { ok: false, erro: "Voce nao tem permissao para cadastrar lotes." };
  }

  const validado = loteSchema.safeParse(entrada);
  if (!validado.success) {
    return { ok: false, erro: validado.error.issues[0]?.message ?? "Dados invalidos." };
  }

  try {
    const id = await db.transaction(async (tx) => {
      const [criado] = await tx
        .insert(lotes)
        .values({ ...validado.data, modified_by: sessao.usuarioId })
        .returning();

      await registrarAuditoria(tx, {
        userId: sessao.usuarioId,
        acao: "criar",
        tabela: "lotes",
        registroId: criado.id,
        detalhes: `Cadastrou o lote "${criado.nome}" (${criado.segmento}), arrematado em ${criado.data_arremate} por R$ ${criado.custo_total}`,
        dadosNovos: criado,
      });

      return criado.id;
    });

    revalidatePath("/lotes");
    revalidatePath("/");
    return { ok: true, dados: { id } };
  } catch (erro) {
    return { ok: false, erro: explicar(erro) };
  }
}

/**
 * Atualiza com OPTIMISTIC LOCKING.
 *
 * O `WHERE` compara `updated_at` com o valor que a tela carregou. Se outra
 * pessoa gravou nesse meio tempo, zero linhas voltam e a operacao e recusada em
 * vez de sobrescrever em silencio o trabalho dela.
 *
 * ⚠️ Isto SO funciona porque todo UPDATE daqui seta `updated_at` a mao. Nao ha
 * trigger no banco nem `$onUpdate` no schema (known-issues): um caminho de
 * escrita que esqueca a coluna desliga a protecao de todos os outros, sem aviso.
 */
export async function atualizarLote(
  id: string,
  entrada: EntradaLote,
  updatedAtOriginal: string,
): Promise<Resultado> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessao expirada. Entre de novo." };
  if (!temPermissao(sessao.papel, "lotes", "atualizar")) {
    return { ok: false, erro: "Voce nao tem permissao para alterar lotes." };
  }

  const validado = loteSchema.safeParse(entrada);
  if (!validado.success) {
    return { ok: false, erro: validado.error.issues[0]?.message ?? "Dados invalidos." };
  }

  try {
    const conflito = await db.transaction(async (tx) => {
      const [antes] = await tx.select().from(lotes).where(eq(lotes.id, id));
      if (!antes) return "sumiu";

      const [depois] = await tx
        .update(lotes)
        .set({ ...validado.data, updated_at: new Date(), modified_by: sessao.usuarioId })
        .where(
          and(
            eq(lotes.id, id),
            eq(lotes.updated_at, new Date(updatedAtOriginal)),
            eq(lotes.is_deleted, false),
          ),
        )
        .returning();

      if (!depois) return "colidiu";

      await registrarAuditoria(tx, {
        userId: sessao.usuarioId,
        acao: "atualizar",
        tabela: "lotes",
        registroId: id,
        detalhes: `Alterou o lote "${antes.nome}": ${descreverMudancas(antes, depois, CAMPOS)}`,
        dadosAnteriores: antes,
        dadosNovos: depois,
      });

      return null;
    });

    if (conflito === "sumiu") return { ok: false, erro: "Este lote nao existe mais." };
    if (conflito === "colidiu") {
      return {
        ok: false,
        erro: "Outra pessoa alterou este lote enquanto voce editava. Recarregue a pagina e refaca a alteracao.",
      };
    }

    revalidatePath("/lotes");
    revalidatePath("/");
    return { ok: true, dados: null };
  } catch (erro) {
    return { ok: false, erro: explicar(erro) };
  }
}

/**
 * Exclusao LOGICA. Nunca `db.delete`.
 *
 * ⚠️ RECUSA lote que ainda tem item ativo, e essa regra e nova (registrada em
 * docs/regras-negocio.md). O soft delete nao dispara a FK: sem esta checagem o
 * lote sumiria da tela e os itens continuariam apontando para ele — orfaos com
 * FK intacta, que e o pior tipo, porque nada no banco reclama. A tela Estoque
 * mostraria itens de um lote que nao existe mais.
 */
export async function excluirLote(id: string): Promise<Resultado> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessao expirada. Entre de novo." };
  if (!temPermissao(sessao.papel, "lotes", "deletar")) {
    return { ok: false, erro: "Voce nao tem permissao para excluir lotes." };
  }

  try {
    const impedimento = await db.transaction(async (tx) => {
      const [{ quantos }] = await tx
        .select({ quantos: sql<number>`count(*)::int` })
        .from(itens)
        .where(and(eq(itens.lote_id, id), eq(itens.is_deleted, false)));

      if (quantos > 0) return `Este lote tem ${quantos} item(ns) no estoque. Exclua ou mova os itens antes.`;

      const [antes] = await tx.select().from(lotes).where(eq(lotes.id, id));
      if (!antes) return "Este lote nao existe mais.";

      const [excluido] = await tx
        .update(lotes)
        .set({
          is_deleted: true,
          deleted_at: new Date(),
          updated_at: new Date(),
          modified_by: sessao.usuarioId,
        })
        .where(and(eq(lotes.id, id), eq(lotes.is_deleted, false)))
        .returning();

      if (!excluido) return "Este lote ja foi excluido.";

      await registrarAuditoria(tx, {
        userId: sessao.usuarioId,
        acao: "excluir",
        tabela: "lotes",
        registroId: id,
        detalhes: `Excluiu o lote "${antes.nome}" (custo R$ ${antes.custo_total})`,
        dadosAnteriores: antes,
      });

      return null;
    });

    if (impedimento) return { ok: false, erro: impedimento };

    revalidatePath("/lotes");
    revalidatePath("/");
    return { ok: true, dados: null };
  } catch (erro) {
    return { ok: false, erro: explicar(erro) };
  }
}
