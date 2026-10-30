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
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

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
  /** Unidades em estoque (ADR-0002). Nao e custo: todo papel ve. */
  quantidade: number;
  /** Canais em que o item tem anuncio ativo. Vazio = nenhum. */
  canais: Canal[];
  /** So para quem pode ver custo (RN-107). Ausente, nao nulo, para os demais. */
  custo?: number;
  precoAlvo?: number | null;
  /**
   * Campos do FORMULARIO de edicao. Opcionais pelo mesmo motivo dos de cima:
   * quem nao pode ver custo tambem nao pode editar (o cadastro exige `itens` E
   * `itens_custo`), entao nao recebe nem estes.
   *
   * Texto exato do banco, nao numero — ver o comentario no mapeamento.
   */
  loteId?: string;
  custoTexto?: string;
  precoAlvoTexto?: string;
  localGalpao?: string;
  atualizadoEm?: string;
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

/**
 * Colunas que a tela Estoque aceita ordenar — LISTA FECHADA.
 *
 * ⚠️ Esta e a defesa contra injecao. A chave chega da URL como texto livre;
 * aqui ela vira uma REFERENCIA DE COLUNA do Drizzle, nunca um pedaco de SQL.
 * Chave desconhecida nem chega: `lerOrdem` cai no padrao.
 *
 * `custo` e `precoAlvo` estao no mapa mas sao barrados por permissao logo
 * abaixo — quem nao ve o valor tambem nao ordena por ele, senao a posicao das
 * linhas entrega a grandeza que a RN-107 esconde.
 */
export const ORDENS_ESTOQUE = [
  "nome",
  "lote",
  "segmento",
  "custo",
  "precoAlvo",
  "situacao",
] as const;
export type OrdemEstoque = (typeof ORDENS_ESTOQUE)[number];

export interface FiltroEstoque {
  segmento?: string;
  situacao?: SituacaoItem;
  ordem?: OrdemEstoque;
  direcao?: "asc" | "desc";
}

/**
 * Traduz a chave da URL numa clausula ORDER BY.
 *
 * O `nome` entra como DESEMPATE em toda ordenacao que nao seja por ele: sem
 * isso, ordenar por `segmento` (ou por qualquer coluna com valores repetidos)
 * deixa a ordem dentro do grupo a cargo do Postgres, que pode devolver linhas
 * em posicoes diferentes a cada carga. Lista que "embaralha sozinha" ao recarregar
 * e um dos jeitos mais rapidos de fazer o operador desconfiar do sistema.
 */
function ordenacao(filtro: FiltroEstoque, mostrarCusto: boolean) {
  const dir = filtro.direcao === "desc" ? desc : asc;

  // Sem permissao de custo, ordenar por custo/preco alvo entregaria a grandeza
  // pela POSICAO da linha. Cai para o padrao — nao e erro, e sigilo (RN-107).
  const pedida =
    !mostrarCusto && (filtro.ordem === "custo" || filtro.ordem === "precoAlvo")
      ? undefined
      : filtro.ordem;

  switch (pedida) {
    case "lote":
      return [dir(lotes.nome), asc(itens.nome)];
    case "segmento":
      return [dir(itens.segmento), asc(itens.nome)];
    case "custo":
      return [dir(itens.custo), asc(itens.nome)];
    case "precoAlvo":
      // `NULLS LAST` nos dois sentidos: item sem preco alvo e o que se quer
      // ACHAR, nao o que se quer ver empilhado no topo por acidente de
      // ordenacao. Em `desc` o Postgres ja poe NULL primeiro por padrao.
      return [
        filtro.direcao === "desc"
          ? sql`${itens.preco_alvo} DESC NULLS LAST`
          : sql`${itens.preco_alvo} ASC NULLS LAST`,
        asc(itens.nome),
      ];
    case "situacao":
      return [dir(itens.situacao), asc(itens.nome)];
    case "nome":
    default:
      return [dir(itens.nome)];
  }
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
        -- UNIDADES, nao linhas (ADR-0002): o rele de 19 unidades conta 19.
        coalesce(sum(quantidade) FILTER (WHERE situacao IN ('anunciado','sem_anuncio')), 0)::int
                                                                            AS disponiveis,
        count(*) FILTER (WHERE situacao = 'sem_anuncio')::int                AS "semAnuncio",
        count(*) FILTER (WHERE situacao = 'reservado')::int                  AS reservados,
        -- Unidades vendidas no mes, pelos PEDIDOS e pela data da venda no
        -- canal. Contar itens com situacao 'vendido' so via quem zerou, e
        -- pelo updated_at, que muda com qualquer edicao.
        (
          SELECT coalesce(sum(p.quantidade), 0)::int FROM pedidos p
          WHERE p.is_deleted = false AND p.status <> 'cancelado'
            AND p.vendido_em >= date_trunc('month', now())
        )                                                                   AS "vendidosNoMes"
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
      quantidade: itens.quantidade,
      custo: mostrarCusto ? itens.custo : sql<string | null>`NULL`,
      precoAlvo: mostrarCusto ? itens.preco_alvo : sql<string | null>`NULL`,
      /**
       * Campos que so o FORMULARIO usa. Saem na consulta, mas so entram no
       * objeto devolvido quando `mostrarCusto` — ou seja, so para quem pode
       * editar. Quem nao pode nao recebe nem o `lote_id`.
       */
      loteId: itens.lote_id,
      localGalpao: itens.local_galpao,
      // `::text` e nao a coluna: o carimbo tem que chegar a action como a
      // string EXATA do banco. Virar `Date` perde os microssegundos e ainda
      // desloca o fuso — as duas coisas quebram o optimistic locking.
      atualizadoEm: sql<string>`${itens.updated_at}::text`,
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
    .orderBy(...ordenacao(filtro, mostrarCusto));

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
        quantidade: l.quantidade,
        canais: (l.canais ?? []) as Canal[],
      };

      if (!mostrarCusto) return base; // as chaves nem existem

      return {
        ...base,
        custo: Number(l.custo ?? 0),
        precoAlvo: l.precoAlvo === null ? null : Number(l.precoAlvo),
        // Texto EXATO do banco para o formulario. Reeditar a partir do `Number`
        // acima devolveria um valor que passou por ponto flutuante.
        loteId: l.loteId,
        custoTexto: l.custo ?? "",
        precoAlvoTexto: l.precoAlvo ?? "",
        localGalpao: l.localGalpao ?? "",
        atualizadoEm: l.atualizadoEm,
      };
    }),
  };
}
