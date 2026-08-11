/**
 * De-para entre a nossa acao e o `status` do anuncio no Mercado Livre.
 *
 * Parte PURA (sem banco, sem rede) para o teste poder travar a garantia mais
 * importante deste arquivo sem ML nenhum no ar.
 *
 * ⚠️ O ML aceita tres valores: `active`, `paused` e **`closed`**. `closed`
 * FINALIZA a publicacao e **nao pode ser reativado** — o anuncio precisa ser
 * republicado do zero, perdendo id, historico e posicao. Nenhuma acao nossa
 * mapeia para ele, e o tipo abaixo torna isso impossivel de emitir por acidente:
 * nao existe caminho de codigo que produza a string "closed".
 *
 * O valor e case sensitive e vai em minusculo (doc oficial).
 */
import type { TipoTarefa } from "../chave-tarefa";

/** So os dois estados reversiveis. `closed` nao entra nem como tipo. */
export type StatusAnuncioML = "active" | "paused";

const DE_PARA: Partial<Record<TipoTarefa, StatusAnuncioML>> = {
  pausar_anuncio: "paused",
  reativar_anuncio: "active",
};

/**
 * O status que a acao pede. Devolve `null` para tipo que nao mexe em anuncio —
 * quem chama trata como "esse executor nao e para esta tarefa" em vez de mandar
 * algo aleatorio para a API do canal.
 */
export function statusParaTipo(tipo: TipoTarefa): StatusAnuncioML | null {
  return DE_PARA[tipo] ?? null;
}

/** O status que o anuncio DEVE ter no nosso banco depois da acao confirmada. */
export function statusLocalParaTipo(tipo: TipoTarefa): "pausado" | "no_ar" | null {
  if (tipo === "pausar_anuncio") return "pausado";
  if (tipo === "reativar_anuncio") return "no_ar";
  return null;
}
