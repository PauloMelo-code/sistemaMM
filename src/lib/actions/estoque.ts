/**
 * Leitura da tela Estoque.
 *
 * ⚠️ RN-107 EM DOBRO AQUI. Some `custo` **e** `preco_alvo` para quem nao pode
 * ver custo: o preco alvo sai da formula da RN-100 a partir do custo, entao
 * mostrar um entrega o outro por aritmetica. Esconder so a coluna `custo` seria
 * teatro — e foi por isso que a auditoria pediu para tratar "derivado de custo"
 * como CLASSE de dado, nao como lista de colunas.
 *
 * Os dois campos nem entram na consulta quando o papel nao pode ve-los: dado que
 * nao e lido nao vaza por descuido do proximo que mexer aqui.
 */
import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { anuncios } from "@/lib/db/schema/anuncios";
import { itens } from "@/lib/db/schema/itens";
import { lotes } from "@/lib/db/schema/lotes";
import type { LinhaSql } from "@/lib/db/linha";
import { podeVerCusto } from "@/lib/auth/rbac";
import type { Papel } from "@/lib/auth/sessao";
import type { Canal } from "@/lib/pricing";

export type SituacaoItem = "anunciado" | "sem_anuncio" | "reservado" | "pausado" | "vendido";

export interface ItemNoEstoque {
  id: string;
  sku: string;
  nome: string;
  lote: string;
  segmento: string;
  situacao: SituacaoItem;
  /** Canais em que o item tem anuncio ativo. Vazio = nenhum. */
  canais: Canal[];
  /** So para quem pode ver custo (RN-107). Ausente, nao nulo, para os demais. */
  custo?: number;
  precoAlvo?: number | null;
}

export interface KpisEstoque {
  disponiveis: number;
  semAnuncio: number;
  reservados: number;
  vendidosNoMes: number;
}

export interface EstadoEstoque {
  itens: ItemNoEstoque[];
  kpis: KpisEstoque;
  /** Segmentos que existem DE FATO no estoque, para os chips. */
  segmentos: string[];
  /** `true` = custo e preco alvo foram omitidos por permissao. */
  custoOculto: boolean;
}

export interface FiltroEstoque {
  segmento?: string;
  situacao?: SituacaoItem;
}

export async function lerEstoque(
  papel: Papel,
  filtro: FiltroEstoque = {},
): Promise<EstadoEstoque> {
  const mostrarCusto = podeVerCusto(papel);

  /**
   * KPIs sobre o estoque INTEIRO, nunca sobre o filtro.
   *
   * Se acompanhassem o filtro, clicar em "Sem anuncio · 12" faria o proprio
   * KPI virar 12 de 12 — o painel deixaria de dizer quanto do estoque tem
   * problema e passaria a dizer so quanto esta na tela.
   */
  const [kpis] = (
    await db.execute<LinhaSql<KpisEstoque>>(sql`
      SELECT
        count(*) FILTER (WHERE situacao IN ('anunciado','sem_anuncio'))::int AS disponiveis,
        count(*) FILTER (WHERE situacao = 'sem_anuncio')::int                AS "semAnuncio",
        count(*) FILTER (WHERE situacao = 'reservado')::int                  AS reservados,
        count(*) FILTER (
          WHERE situacao = 'vendido' AND updated_at >= date_trunc('month', now())
        )::int                                                              AS "vendidosNoMes"
      FROM itens
      WHERE is_deleted = false
    `)
  ).rows;

  const segmentos = await db
    .selectDistinct({ segmento: itens.segmento })
    .from(itens)
    .where(eq(itens.is_deleted, false))
    .orderBy(asc(itens.segmento));

  const condicoes: SQL[] = [eq(itens.is_deleted, false)];
  if (filtro.segmento) condicoes.push(eq(itens.segmento, filtro.segmento));
  if (filtro.situacao) condicoes.push(eq(itens.situacao, filtro.situacao));

  const linhas = await db
    .select({
      id: itens.id,
      sku: itens.sku,
      nome: itens.nome,
      lote: lotes.nome,
      segmento: itens.segmento,
      situacao: itens.situacao,
      custo: mostrarCusto ? itens.custo : sql<string | null>`NULL`,
      precoAlvo: mostrarCusto ? itens.preco_alvo : sql<string | null>`NULL`,
      /**
       * Canais com anuncio ativo, agregados no BANCO. Buscar os anuncios numa
       * segunda consulta e juntar em memoria daria N+1 numa tela que lista o
       * estoque inteiro.
       */
      canais: sql<string[]>`
        coalesce(
          array(
            SELECT a.canal::text FROM ${anuncios} a
            WHERE a.item_id = ${itens.id} AND a.is_deleted = false
            ORDER BY a.canal
          ),
          '{}'
        )
      `,
    })
    .from(itens)
    .innerJoin(lotes, eq(lotes.id, itens.lote_id))
    .where(and(...condicoes))
    .orderBy(asc(itens.nome));

  return {
    custoOculto: !mostrarCusto,
    segmentos: segmentos.map((s) => s.segmento),
    kpis: kpis ?? { disponiveis: 0, semAnuncio: 0, reservados: 0, vendidosNoMes: 0 },
    itens: linhas.map((l) => {
      const base: ItemNoEstoque = {
        id: l.id,
        sku: l.sku,
        nome: l.nome,
        lote: l.lote,
        segmento: l.segmento,
        situacao: l.situacao as SituacaoItem,
        canais: (l.canais ?? []) as Canal[],
      };

      if (!mostrarCusto) return base; // as chaves nem existem

      return {
        ...base,
        custo: Number(l.custo ?? 0),
        precoAlvo: l.precoAlvo === null ? null : Number(l.precoAlvo),
      };
    }),
  };
}
