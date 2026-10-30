/**
 * Leitura da tela Lotes.
 *
 * ⚠️ TELA INTEIRAMENTE RESTRITA. Diferente de Anuncios ou Estoque, onde o
 * operador ve uma versao reduzida, a matriz do RBAC nao da a ele **nenhum**
 * acesso a `lotes`: um lote e custo de arremate, do primeiro ao ultimo campo.
 * Nao ha versao reduzida possivel — sem os valores, sobra o nome.
 *
 * ⚠️ "Giro lento" NAO esta definido em regra nenhuma. O criterio abaixo e
 * escolha minha; ver `LENTO_DIAS` e o registro em known-issues.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import type { LinhaSql } from "@/lib/db/linha";
import { temPermissao } from "@/lib/auth/rbac";
import type { Papel } from "@/lib/auth/sessao";

/**
 * A partir de quantos dias um lote que ainda nao se pagou conta como giro lento.
 *
 * ⚠️ CHUTE MEU, nao regra do cliente. O prototipo pinta ambar para "giro lento"
 * e nunca diz o que e; a auditoria registrou a lacuna. 90 dias e um trimestre —
 * defensavel para equipamento usado de ticket alto, e nada mais que isso.
 * **Confirmar com o Anderson.**
 */
export const LENTO_DIAS = 90;

export interface LoteNaTela {
  id: string;
  nome: string;
  segmento: string;
  arrematadoEm: Date;
  custo: number;
  /**
   * Campos que o FORMULARIO precisa, em texto exato do banco.
   *
   * `custo` acima e `double precision` para exibir; aqui vai o `numeric` como
   * string. Reeditar um lote a partir do numero convertido devolveria ao banco
   * um valor que passou por ponto flutuante — pequeno, mas e dinheiro, e a base
   * escolheu `numeric` justamente para isso nao acontecer.
   *
   * `atualizadoEm` e o que sustenta o optimistic locking: a tela carrega, a
   * pessoa edita, e o servidor compara para saber se alguem gravou no meio.
   */
  custoTexto: string;
  dataArremateTexto: string;
  atualizadoEm: string;
  /** Soma do PRECO dos anuncios ativos — nao do estoque inteiro. */
  anunciado: number;
  /** Soma do valor das vendas ja realizadas. */
  vendido: number;
  itens: number;
  itensAnunciados: number;
  itensVendidos: number;
  diasDesdeArremate: number;
}

/** O lote ja se pagou? Fracao do custo recuperada em vendas. */
export function custoRecuperado(lote: Pick<LoteNaTela, "custo" | "vendido">): number {
  if (lote.custo <= 0) return 1;
  return lote.vendido / lote.custo;
}

/** Giro lento: passou do prazo e ainda nao se pagou. */
export function giroLento(lote: LoteNaTela): boolean {
  return lote.diasDesdeArremate > LENTO_DIAS && custoRecuperado(lote) < 1;
}

/**
 * Lotes para o SELETOR do formulario de item — so id, nome e segmento.
 *
 * Consulta propria, e nao um reaproveitamento de `lerLotes`: aquela agrega
 * anuncios, pedidos e contagem de itens por lote, tudo dinheiro que este
 * seletor nao usa e que o cliente nao precisa receber.
 */
export async function listarLotesParaSelecao(
  papel: Papel,
): Promise<{ id: string; nome: string; segmento: string }[]> {
  if (!temPermissao(papel, "lotes", "ler")) return [];

  const linhas = await db.execute<LinhaSql<{ id: string; nome: string; segmento: string }>>(sql`
    SELECT id, nome, segmento
    FROM lotes
    WHERE is_deleted = false
    ORDER BY data_arremate DESC
  `);

  return linhas.rows;
}

export interface EstadoLotes {
  lotes: LoteNaTela[];
  custoTotal: number;
  totalItens: number;
}

export async function lerLotes(papel: Papel): Promise<EstadoLotes | null> {
  // `null` = sem acesso. Quem chama mostra a pagina de acesso negado; devolver
  // lista vazia faria a tela dizer "nenhum lote", que e mentira.
  if (!temPermissao(papel, "lotes", "ler")) return null;

  const linhas = await db.execute<LinhaSql<LoteNaTela>>(sql`
    SELECT
      l.id, l.nome, l.segmento,
      l.data_arremate                    AS "arrematadoEm",
      l.custo_total::double precision    AS custo,
      l.custo_total::text                AS "custoTexto",
      l.data_arremate::text              AS "dataArremateTexto",
      l.updated_at::text                 AS "atualizadoEm",
      -- ANUNCIADO soma o preco dos anuncios ATIVOS, e por isso nao e
      -- comparavel com o custo do lote inteiro: sao conjuntos diferentes de
      -- itens. A tela diz quantos itens cada numero cobre.
      -- Preco do anuncio e UNITARIO: vezes as unidades em estoque (ADR-0002).
      coalesce((
        SELECT sum(a.preco * ia.quantidade) FROM anuncios a
        JOIN itens ia ON ia.id = a.item_id AND ia.is_deleted = false
        WHERE ia.lote_id = l.id AND a.is_deleted = false AND a.status <> 'pausado'
      ), 0)::double precision            AS anunciado,
      coalesce((
        SELECT sum(p.valor) FROM pedidos p
        JOIN itens ip ON ip.id = p.item_id AND ip.is_deleted = false
        WHERE ip.lote_id = l.id AND p.is_deleted = false AND p.status <> 'cancelado'
      ), 0)::double precision            AS vendido,
      count(i.id)::int                                          AS itens,
      count(i.id) FILTER (WHERE i.situacao = 'anunciado')::int   AS "itensAnunciados",
      count(i.id) FILTER (WHERE i.situacao = 'vendido')::int     AS "itensVendidos",
      (CURRENT_DATE - l.data_arremate)::int                      AS "diasDesdeArremate"
    FROM lotes l
    LEFT JOIN itens i ON i.lote_id = l.id AND i.is_deleted = false
    WHERE l.is_deleted = false
    GROUP BY l.id, l.nome, l.segmento, l.data_arremate, l.custo_total, l.updated_at
    ORDER BY l.data_arremate DESC
  `);

  const lotes = linhas.rows.map((l) => ({
    ...l,
    arrematadoEm: new Date(l.arrematadoEm),
  }));

  return {
    lotes,
    custoTotal: lotes.reduce((soma, l) => soma + l.custo, 0),
    totalItens: lotes.reduce((soma, l) => soma + l.itens, 0),
  };
}
