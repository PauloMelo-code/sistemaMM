/**
 * Validacao de Item de estoque.
 *
 * Modulo PURO, como o de lote: recebe dado cru, devolve dado confiavel.
 * Dinheiro entra e sai como TEXTO — ver o cabecalho de `lote.ts`.
 */
import { z } from "zod";

import { normalizarDinheiro } from "./lote.ts";

const DINHEIRO = /^\d{1,12}([.,]\d{1,2})?$/;

const dinheiro = (rotulo: string) =>
  z
    .string()
    .trim()
    .transform(normalizarDinheiro)
    .refine((v) => DINHEIRO.test(v), `${rotulo} invalido. Use apenas numeros, ex.: 3300,00`);

export const SITUACOES_ITEM = [
  "sem_anuncio",
  "anunciado",
  "reservado",
  "pausado",
  "vendido",
] as const;

export const itemSchema = z.object({
  /**
   * SKU sem formato imposto, e isso e deliberado.
   *
   * O prototipo mostra `MM-OFT-1401` e o padrao de geracao **nunca foi
   * definido** (known-issues). Cravar um regex agora seria inventar regra do
   * cliente dentro de um validador — e o dia em que o Anderson disser o formato
   * de verdade, o cadastro ja estaria cheio de codigo que nao bate. So o que da
   * para afirmar hoje: nao pode ser vazio nem ter espaco no meio.
   */
  sku: z
    .string()
    .trim()
    .min(1, "O SKU e obrigatorio.")
    .max(40, "O SKU passou de 40 caracteres.")
    .regex(/^\S+$/, "O SKU nao pode ter espacos.")
    .transform((s) => s.toUpperCase()),

  nome: z
    .string()
    .trim()
    .min(1, "O nome do item e obrigatorio.")
    .max(160, "O nome passou de 160 caracteres."),

  lote_id: z.string().uuid("Selecione um lote."),

  // Mesmo tratamento do lote: normalizado na gravacao para os chips de segmento
  // nao se duplicarem por diferenca de caixa.
  segmento: z
    .string()
    .trim()
    .min(1, "O segmento e obrigatorio.")
    .max(60, "O segmento passou de 60 caracteres.")
    .transform((s) => s.toLowerCase()),

  /**
   * Custo de arremate do ITEM. Obrigatorio porque a coluna e NOT NULL — e
   * porque sem ele nao existe margem, lance maximo nem custo congelado na venda
   * (RN-114). Zero seria pior que ausente: viraria margem de 100% em toda tela.
   *
   * ⚠️ CAMPO SIGILOSO (RN-107). Quem preenche este formulario e administrador;
   * a matriz do RBAC nao da `itens_custo` ao operador.
   */
  custo: dinheiro("O custo")
    .refine((v) => v.length > 0, "O custo e obrigatorio.")
    .refine((v) => Number(v) > 0, "O custo precisa ser maior que zero."),

  /**
   * Preco alvo: OPCIONAL, porque o item entra no estoque antes de ser
   * precificado. String vazia vira `null` — nao vira "0", que significaria
   * "decidimos vender de graca" em vez de "ainda nao decidimos".
   */
  preco_alvo: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : normalizarDinheiro(v)))
    .refine((v) => v === null || DINHEIRO.test(v), "Preco alvo invalido.")
    .refine((v) => v === null || Number(v) > 0, "O preco alvo precisa ser maior que zero."),

  /** Endereco no galpao (ex.: "A · 2"). Nulo ate ser enderecado. */
  local_galpao: z
    .string()
    .trim()
    .max(40, "O local passou de 40 caracteres.")
    .transform((v) => (v === "" ? null : v)),

  situacao: z.enum(SITUACOES_ITEM),

  /**
   * Unidades em estoque (ADR-0002). Inteiro, zero ou mais: peca unica de
   * leilao e 1. Zero e legitimo (esgotado), negativo nunca — o banco tambem
   * recusa (`chk_itens_quantidade_nao_negativa`).
   */
  quantidade: z
    .string()
    .trim()
    .regex(/^\d{1,6}$/, "Quantidade invalida. Use um numero inteiro, ex.: 1")
    .transform(Number),
});

export type EntradaItem = z.input<typeof itemSchema>;
export type ItemValidado = z.output<typeof itemSchema>;

/**
 * O que sai de um `<form>`: TODO campo e string, inclusive o que vira enum.
 *
 * As actions recebem este tipo, e nao `EntradaItem`, porque e a verdade do que
 * chega — um `<select>` devolve `string`, nao a uniao literal. Fazer cast no
 * formulario (`as EntradaItem["situacao"]`) daria um typecheck verde mentindo:
 * o valor continuaria podendo ser qualquer coisa, e o cast so calaria o
 * compilador exatamente na fronteira onde ele deveria falar.
 *
 * Quem estreita e o Zod, que e para isso que ele existe aqui. O nome dos campos
 * continua conferido, entao errar `precoAlvo` por `preco_alvo` ainda quebra.
 */
export type EntradaItemBruta = Record<keyof EntradaItem, string>;
