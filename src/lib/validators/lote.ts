/**
 * Validacao de Lote — a fronteira entre o formulario e o banco.
 *
 * Modulo PURO: nao le banco, nao le sessao. Recebe dado cru e devolve dado
 * confiavel, ou explica o que esta errado — por isso e testavel sem Postgres.
 *
 * ⚠️ DINHEIRO CHEGA COMO TEXTO e sai como texto. O campo do formulario e uma
 * string, a coluna e `numeric`, e o driver espera string. Converter para
 * `number` no meio do caminho introduziria ponto flutuante numa base que
 * escolheu `numeric` justamente para nao ter — ver o invariante 3 do CLAUDE.md.
 * O `coerce` do Zod fica de fora daqui de proposito.
 */
import { z } from "zod";

/** Aceita "12000", "12000.50" e "12.000,50" — o que uma pessoa digita. */
const DINHEIRO = /^\d{1,12}([.,]\d{1,2})?$/;

/**
 * Normaliza para o formato que o Postgres aceita em `numeric`: ponto decimal,
 * sem separador de milhar.
 *
 * "12.000,50" -> "12000.50" | "12000,5" -> "12000.5" | "12000" -> "12000"
 */
export function normalizarDinheiro(bruto: string): string {
  const limpo = bruto.trim().replace(/\s/g, "");
  // Com virgula, o ponto so pode ser separador de milhar.
  if (limpo.includes(",")) return limpo.replace(/\./g, "").replace(",", ".");
  return limpo;
}

const dinheiro = (rotulo: string) =>
  z
    .string()
    .trim()
    .min(1, `${rotulo} e obrigatorio.`)
    .transform(normalizarDinheiro)
    .refine((v) => DINHEIRO.test(v), `${rotulo} invalido. Use apenas numeros, ex.: 12000,50`)
    // Zero e recusado: lote de arremate custa alguma coisa, e `custo_total`
    // zerado faria `custoRecuperado` devolver 100% para um lote que nao se pagou
    // (ver `custoRecuperado` em actions/lotes.ts).
    .refine((v) => Number(v) > 0, `${rotulo} precisa ser maior que zero.`);

export const loteSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "O nome do lote e obrigatorio.")
    .max(120, "O nome do lote passou de 120 caracteres."),

  /**
   * Texto livre, e isso e decisao registrada: o conjunto de segmentos cresce a
   * cada leilao, e um enum exigiria migracao a cada categoria nova.
   *
   * ⚠️ O `toLowerCase` NAO e cosmetico. O banco ja mostrou "Oftalmologia" e
   * "oftalmologia" como segmentos SEPARADOS — dois chips na tela Estoque,
   * filtros que nao se encontram, e item que some de uma busca que deveria
   * acha-lo (known-issues 🟡). Normalizar na gravacao resolve na origem; a
   * exibicao capitaliza.
   */
  segmento: z
    .string()
    .trim()
    .min(1, "O segmento e obrigatorio.")
    .max(60, "O segmento passou de 60 caracteres.")
    .transform((s) => s.toLowerCase()),

  /**
   * `date` sem hora — data de arremate nao tem horario, e por isso escapa do
   * problema de fuso que assombra as colunas de instante (known-issues 🟡).
   */
  data_arremate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data invalida.")
    // Arremate no futuro e quase sempre dedo trocado no ano. Barrar aqui evita
    // um lote que nunca vai aparecer como "giro lento" porque a conta de dias
    // da negativa.
    .refine((d) => d <= new Date().toISOString().slice(0, 10), "A data do arremate nao pode ser no futuro."),

  custo_total: dinheiro("O custo total"),
});

export type EntradaLote = z.input<typeof loteSchema>;
export type LoteValidado = z.output<typeof loteSchema>;
