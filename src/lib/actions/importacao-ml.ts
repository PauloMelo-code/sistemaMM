"use server";

/**
 * Botao "Importar agora" da tela de anuncios importados do ML (RN-123).
 *
 * So administrador: a matriz da `integracoes: atualizar` a ele e mais ninguem.
 * A importacao so faz GET no ML — o que ela escreve e a tabela local.
 */
import { revalidatePath } from "next/cache";

import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao } from "@/lib/auth/sessao";
import {
  importarAnunciosML,
  type ResumoImportacao,
} from "@/lib/integracoes/mercado-livre/importacao-anuncios";
import {
  importarPerguntasML,
  type ResumoPerguntas,
} from "@/lib/integracoes/mercado-livre/importacao-perguntas";
import { ReautorizacaoNecessariaError, SemCredencialError } from "@/lib/integracoes/mercado-livre/token";

export type ResultadoImportacao =
  | { ok: true; resumo: ResumoImportacao }
  | { ok: false; erro: string };

export async function importarAnunciosAgora(): Promise<ResultadoImportacao> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  if (!temPermissao(sessao.papel, "integracoes", "atualizar")) {
    return { ok: false, erro: "Só administrador importa os anúncios do Mercado Livre." };
  }

  try {
    const resumo = await importarAnunciosML(sessao.usuarioId);
    revalidatePath("/integracoes/mercado-livre");
    revalidatePath("/integracoes");
    return { ok: true, resumo };
  } catch (erro) {
    return { ok: false, erro: explicarFalha(erro) };
  }
}

export type ResultadoPerguntas = { ok: true; resumo: ResumoPerguntas } | { ok: false; erro: string };

/**
 * Botao "Buscar perguntas do ML" da tela Perguntas. Quem pode responder pode
 * buscar: `perguntas: criar` (administrador e operador).
 */
export async function importarPerguntasAgora(): Promise<ResultadoPerguntas> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  if (!temPermissao(sessao.papel, "perguntas", "criar")) {
    return { ok: false, erro: "Você não tem permissão para buscar perguntas." };
  }

  try {
    const resumo = await importarPerguntasML(sessao.usuarioId);
    revalidatePath("/perguntas");
    return { ok: true, resumo };
  } catch (erro) {
    return { ok: false, erro: explicarFalha(erro) };
  }
}

/** Frase para a tela. A mensagem do ML ajuda (ex.: 403 de permissao do app) e nunca traz token. */
function explicarFalha(erro: unknown): string {
  console.error("[importacao-ml] falhou — nada foi gravado", erro);
  if (erro instanceof SemCredencialError || erro instanceof ReautorizacaoNecessariaError) {
    return "A conta do Mercado Livre precisa ser conectada de novo.";
  }
  return `A importação falhou e nada foi gravado. ${erro instanceof Error ? erro.message : ""}`.trim();
}
