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
    console.error("[importacao-ml] falhou — nada foi gravado", erro);
    if (erro instanceof SemCredencialError || erro instanceof ReautorizacaoNecessariaError) {
      return { ok: false, erro: "A conta do Mercado Livre precisa ser conectada de novo." };
    }
    // A mensagem do ML ajuda quem esta na tela a entender (ex.: 403 de
    // permissao do app). Nunca contem token: o client mascara.
    return {
      ok: false,
      erro: `A importação falhou e nada foi gravado. ${erro instanceof Error ? erro.message : ""}`.trim(),
    };
  }
}
