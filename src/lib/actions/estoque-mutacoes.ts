"use server";

/**
 * Escrita de Itens de estoque: criar, atualizar e excluir.
 *
 * Arquivo separado de `estoque.ts` pelo mesmo motivo de `lotes-mutacoes.ts`: um
 * modulo `"use server"` so exporta funcoes async, e a leitura convive com tipos
 * e constantes.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ EXIGE DUAS PERMISSOES, E ISSO NAO E EXCESSO DE ZELO.
 *
 * A matriz do RBAC da ao operador `itens: criar`, mas NEGA `itens_custo`
 * (RN-107). Acontece que `itens.custo` e NOT NULL: nao existe cadastro de item
 * sem informar custo. E o formulario tambem exige escolher um LOTE, recurso que
 * a matriz nao da ao operador de forma nenhuma.
 *
 * Ou seja, pela matriz de hoje o operador tem permissao de criar um item e
 * nenhum jeito de preencher o formulario. Enquanto o Anderson nao decidir
 * (registrado em known-issues), cadastro exige as DUAS permissoes — o que na
 * pratica significa administrador.
 *
 * Deixar so `itens` aqui produziria o pior desfecho: o operador ve o botao,
 * abre o formulario, digita tudo e leva erro no fim — ou, se alguem
 * "resolvesse" pondo custo zero por padrao, gravaria margem de 100% em toda
 * tela do sistema.
 * ---------------------------------------------------------------------------
 */
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { itens } from "@/lib/db/schema/itens";
import { anuncios } from "@/lib/db/schema/anuncios";
import { pedidos } from "@/lib/db/schema/pedidos";
import { lerSessao } from "@/lib/auth/sessao";
import { temPermissao } from "@/lib/auth/rbac";
import { registrarAuditoria, descreverMudancas } from "@/lib/audit/logger";
import { itemSchema, type EntradaItemBruta } from "@/lib/validators/item";
import type { Resultado } from "./lotes-mutacoes";

const CAMPOS = [
  "sku", "nome", "segmento", "custo", "preco_alvo", "local_galpao", "situacao", "quantidade",
] as const;

function explicar(erro: unknown): string {
  const codigo = (erro as { code?: string })?.code;
  // O unico parcial de `sku` (WHERE is_deleted = false) so pega itens ATIVOS —
  // SKU de item excluido volta a ficar livre, e isso e intencional.
  if (codigo === "23505") return "Ja existe um item ativo com este SKU.";
  if (codigo === "23503") return "O lote selecionado nao existe mais.";
  console.error("[itens] erro nao previsto", erro);
  return "Nao foi possivel concluir. Tente de novo.";
}

/** As duas permissoes que o cadastro exige. Ver o cabecalho. */
function podeCadastrar(papel: Parameters<typeof temPermissao>[0], acao: "criar" | "atualizar" | "deletar") {
  return temPermissao(papel, "itens", acao) && temPermissao(papel, "itens_custo", acao);
}

export async function criarItem(entrada: EntradaItemBruta): Promise<Resultado<{ id: string }>> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessao expirada. Entre de novo." };
  if (!podeCadastrar(sessao.papel, "criar")) {
    return { ok: false, erro: "Voce nao tem permissao para cadastrar itens." };
  }

  const validado = itemSchema.safeParse(entrada);
  if (!validado.success) {
    return { ok: false, erro: validado.error.issues[0]?.message ?? "Dados invalidos." };
  }

  try {
    const id = await db.transaction(async (tx) => {
      const [criado] = await tx
        .insert(itens)
        .values({ ...validado.data, modified_by: sessao.usuarioId })
        .returning();

      await registrarAuditoria(tx, {
        userId: sessao.usuarioId,
        acao: "criar",
        tabela: "itens",
        registroId: criado.id,
        detalhes: `Cadastrou o item ${criado.sku} — "${criado.nome}" (custo R$ ${criado.custo})`,
        dadosNovos: criado,
      });

      return criado.id;
    });

    revalidatePath("/estoque");
    revalidatePath("/lotes");
    revalidatePath("/");
    return { ok: true, dados: { id } };
  } catch (erro) {
    return { ok: false, erro: explicar(erro) };
  }
}

/** Atualiza com optimistic locking — ver a explicacao em `lotes-mutacoes.ts`. */
export async function atualizarItem(
  id: string,
  entrada: EntradaItemBruta,
  updatedAtOriginal: string,
): Promise<Resultado> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessao expirada. Entre de novo." };
  if (!podeCadastrar(sessao.papel, "atualizar")) {
    return { ok: false, erro: "Voce nao tem permissao para alterar itens." };
  }

  const validado = itemSchema.safeParse(entrada);
  if (!validado.success) {
    return { ok: false, erro: validado.error.issues[0]?.message ?? "Dados invalidos." };
  }

  try {
    const conflito = await db.transaction(async (tx) => {
      const [antes] = await tx.select().from(itens).where(eq(itens.id, id));
      if (!antes) return "Este item nao existe mais.";

      /**
       * ⚠️ ITEM VENDIDO NAO MUDA DE CUSTO POR AQUI.
       *
       * O pedido congela `custo_na_venda` no momento da venda (RN-114) — entao
       * mexer no custo depois NAO reescreve a margem do mes fechado, e esta bem
       * assim. O problema e outro: o custo do item passaria a divergir do que
       * foi vendido sem que nada explique a diferenca. Se o valor estava errado,
       * o caminho e corrigir a venda, nao o item.
       */
      /**
       * ⚠️ COMPARACAO NUMERICA, e nao de texto. `String(antes.custo) !== ...`
       * era o que estava aqui, e acusava alteracao onde nao houve: o banco
       * guarda `3300.00` e quem redigita `3300` no formulario mandava um texto
       * diferente com o MESMO valor — o sistema recusava a edicao dizendo que o
       * custo mudou, sem ter mudado.
       *
       * `Number` e seguro aqui porque isto e uma COMPARACAO, nao uma gravacao:
       * o valor que vai para o banco continua sendo a string validada.
       */
      if (antes.situacao === "vendido" && Number(antes.custo) !== Number(validado.data.custo)) {
        return "Este item ja foi vendido: o custo nao pode ser alterado. Corrija pelo pedido.";
      }

      const [depois] = await tx
        .update(itens)
        .set({ ...validado.data, updated_at: new Date(), modified_by: sessao.usuarioId })
        .where(
          and(
            eq(itens.id, id),
            // Texto contra texto: o valor exato do banco, sem virar `Date`.
            sql`${itens.updated_at}::text = ${updatedAtOriginal}`,
            eq(itens.is_deleted, false),
          ),
        )
        .returning();

      if (!depois) {
        return "Outra pessoa alterou este item enquanto voce editava. Recarregue a pagina e refaca a alteracao.";
      }

      await registrarAuditoria(tx, {
        userId: sessao.usuarioId,
        acao: "atualizar",
        tabela: "itens",
        registroId: id,
        detalhes: `Alterou o item ${antes.sku}: ${descreverMudancas(antes, depois, CAMPOS)}`,
        dadosAnteriores: antes,
        dadosNovos: depois,
      });

      return null;
    });

    if (conflito) return { ok: false, erro: conflito };

    revalidatePath("/estoque");
    revalidatePath("/lotes");
    revalidatePath("/");
    return { ok: true, dados: null };
  } catch (erro) {
    return { ok: false, erro: explicar(erro) };
  }
}

/**
 * Exclusao LOGICA, com duas recusas deliberadas.
 *
 * O soft delete nao dispara FK nenhuma — o banco deixaria passar. Por isso as
 * checagens vivem aqui:
 *
 * - **Item com PEDIDO** nunca sai. O pedido e dinheiro que entrou: existe nota,
 *   taxa e comissao amarrados a ele. Sumir com o item deixaria a venda apontando
 *   para o vazio no relatorio do mes.
 * - **Item com ANUNCIO ativo** nao sai antes de o anuncio ser pausado. O anuncio
 *   esta NO AR num canal externo: excluir aqui nao tira ele de la, so faz o
 *   painel esquecer que ele existe — e a peca continua a venda no Mercado Livre
 *   sem ninguem sabendo.
 */
export async function excluirItem(id: string): Promise<Resultado> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessao expirada. Entre de novo." };
  if (!podeCadastrar(sessao.papel, "deletar")) {
    return { ok: false, erro: "Voce nao tem permissao para excluir itens." };
  }

  try {
    const impedimento = await db.transaction(async (tx) => {
      const [{ vendas }] = await tx
        .select({ vendas: sql<number>`count(*)::int` })
        .from(pedidos)
        .where(and(eq(pedidos.item_id, id), eq(pedidos.is_deleted, false)));

      if (vendas > 0) {
        return "Este item tem pedido registrado e nao pode ser excluido — o historico da venda depende dele.";
      }

      const [{ noAr }] = await tx
        .select({ noAr: sql<number>`count(*)::int` })
        .from(anuncios)
        .where(
          and(
            eq(anuncios.item_id, id),
            eq(anuncios.is_deleted, false),
            sql`${anuncios.status} <> 'pausado'`,
          ),
        );

      if (noAr > 0) {
        return `Este item tem ${noAr} anuncio(s) no ar. Pause os anuncios antes de excluir — excluir aqui nao tira o anuncio do canal.`;
      }

      const [antes] = await tx.select().from(itens).where(eq(itens.id, id));
      if (!antes) return "Este item nao existe mais.";

      const [excluido] = await tx
        .update(itens)
        .set({
          is_deleted: true,
          deleted_at: new Date(),
          updated_at: new Date(),
          modified_by: sessao.usuarioId,
        })
        .where(and(eq(itens.id, id), eq(itens.is_deleted, false)))
        .returning();

      if (!excluido) return "Este item ja foi excluido.";

      await registrarAuditoria(tx, {
        userId: sessao.usuarioId,
        acao: "excluir",
        tabela: "itens",
        registroId: id,
        detalhes: `Excluiu o item ${antes.sku} — "${antes.nome}" (custo R$ ${antes.custo})`,
        dadosAnteriores: antes,
      });

      return null;
    });

    if (impedimento) return { ok: false, erro: impedimento };

    revalidatePath("/estoque");
    revalidatePath("/lotes");
    revalidatePath("/");
    return { ok: true, dados: null };
  } catch (erro) {
    return { ok: false, erro: explicar(erro) };
  }
}
