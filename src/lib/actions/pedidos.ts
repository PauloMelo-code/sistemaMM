/**
 * Leitura da tela Pedidos.
 *
 * ⚠️ RN-107: `valor`, `taxa`, `comissao` e `liquido` sao dinheiro — o operador
 * nao ve nenhum deles, e **os totais nem sao calculados** para ele. Um total e
 * tao revelador quanto a linha: quem soma os pedidos do mes sabe o faturamento.
 *
 * ⚠️ O periodo e por `vendido_em`, NUNCA por `created_at` (RN-114). Fechar o mes
 * pela data de digitacao joga venda de marco lancada em abril no mes errado, e
 * leva a comissao junto.
 */
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { itens } from "@/lib/db/schema/itens";
import { pedidos } from "@/lib/db/schema/pedidos";
import type { LinhaSql } from "@/lib/db/linha";
import { podeVerCusto } from "@/lib/auth/rbac";
import type { Papel } from "@/lib/auth/sessao";
import type { Canal } from "@/lib/pricing";

export type StatusPedido = "aguardando_envio" | "em_transporte" | "concluido" | "cancelado";

export interface PedidoNaTela {
  id: string;
  numero: string;
  produto: string;
  canal: Canal;
  vendidoEm: Date;
  nfeEmitida: boolean;
  status: StatusPedido;
  /** `true` = ninguem conferiu os valores contra o extrato do canal. */
  aConferir: boolean;
  /** So para quem pode ver dinheiro (RN-107). */
  valor?: number;
  taxa?: number;
  /** O que o CANAL informou de taxa. `null` quando ele nao informou. */
  taxaOrigem?: number | null;
}

export interface TotaisPedidos {
  faturamento: number;
  taxas: number;
  comissoes: number;
  liquido: number;
  /** Quantos pedidos do periodo ainda nao foram conferidos. */
  aConferir: number;
}

export interface EstadoPedidos {
  pedidos: PedidoNaTela[];
  /** Ausente para quem nao pode ver dinheiro — nao zerado. */
  totais?: TotaisPedidos;
  dinheiroOculto: boolean;
  /** Mes exibido, no formato `AAAA-MM`. */
  mes: string;
}

/** `AAAA-MM` do mes corrente. */
export function mesCorrente(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Converte `AAAA-MM` no intervalo [inicio, fim).
 *
 * Intervalo SEMIABERTO, e nao `BETWEEN`: com `<= ultimo dia` uma venda as
 * 23h30 do dia 31 fica de fora quando a coluna tem hora. Perder venda do
 * ultimo dia do mes e o jeito classico de o relatorio nao bater.
 *
 * Mes invalido devolve `null` — quem chama cai no mes corrente.
 */
export function intervaloDoMes(mes: string): { inicio: Date; fim: Date } | null {
  const casa = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!casa) return null;
  const ano = Number(casa[1]);
  const numeroMes = Number(casa[2]);
  if (numeroMes < 1 || numeroMes > 12) return null;

  return {
    inicio: new Date(ano, numeroMes - 1, 1),
    fim: new Date(ano, numeroMes, 1),
  };
}

export async function lerPedidos(papel: Papel, mesPedido?: string): Promise<EstadoPedidos> {
  const mostrarDinheiro = podeVerCusto(papel);
  const mes = (mesPedido && intervaloDoMes(mesPedido) ? mesPedido : null) ?? mesCorrente();
  const { inicio, fim } = intervaloDoMes(mes)!;

  const condicoes: SQL[] = [
    eq(pedidos.is_deleted, false),
    gte(pedidos.vendido_em, inicio),
    lt(pedidos.vendido_em, fim),
  ];

  const linhas = await db
    .select({
      id: pedidos.id,
      numero: pedidos.numero,
      produto: itens.nome,
      canal: pedidos.canal,
      vendidoEm: pedidos.vendido_em,
      nfeEmitida: pedidos.nfe_emitida,
      status: pedidos.status,
      conciliadoEm: pedidos.conciliado_em,
      valor: mostrarDinheiro ? pedidos.valor : sql<string | null>`NULL`,
      taxa: mostrarDinheiro ? pedidos.taxa : sql<string | null>`NULL`,
      taxaOrigem: mostrarDinheiro ? pedidos.taxa_origem : sql<string | null>`NULL`,
    })
    .from(pedidos)
    .innerJoin(itens, eq(itens.id, pedidos.item_id))
    .where(and(...condicoes))
    .orderBy(desc(pedidos.vendido_em));

  const lista: PedidoNaTela[] = linhas.map((l) => {
    const base: PedidoNaTela = {
      id: l.id,
      numero: l.numero,
      produto: l.produto,
      canal: l.canal,
      vendidoEm: l.vendidoEm,
      nfeEmitida: l.nfeEmitida,
      status: l.status as StatusPedido,
      aConferir: l.conciliadoEm === null,
    };
    if (!mostrarDinheiro) return base;
    return {
      ...base,
      valor: Number(l.valor ?? 0),
      taxa: Number(l.taxa ?? 0),
      taxaOrigem: l.taxaOrigem === null ? null : Number(l.taxaOrigem),
    };
  });

  if (!mostrarDinheiro) {
    return { pedidos: lista, dinheiroOculto: true, mes };
  }

  /**
   * Totais somados no BANCO, e nao a partir da lista em memoria: a lista pode
   * um dia ganhar paginacao, e um total que soma "so a pagina atual" seria um
   * numero errado com cara de certo.
   *
   * CANCELADO fica de fora do faturamento: o pedido continua no historico
   * (por isso nao e exclusao logica), mas nao entrou dinheiro.
   */
  const [totais] = (
    await db.execute<LinhaSql<TotaisPedidos>>(sql`
      SELECT
        coalesce(sum(valor)    FILTER (WHERE status <> 'cancelado'), 0)::double precision AS faturamento,
        coalesce(sum(taxa)     FILTER (WHERE status <> 'cancelado'), 0)::double precision AS taxas,
        coalesce(sum(comissao) FILTER (WHERE status <> 'cancelado'), 0)::double precision AS comissoes,
        coalesce(sum(liquido)  FILTER (WHERE status <> 'cancelado'), 0)::double precision AS liquido,
        count(*) FILTER (WHERE conciliado_em IS NULL AND status <> 'cancelado')::int      AS "aConferir"
      FROM pedidos
      WHERE is_deleted = false
        AND vendido_em >= ${inicio} AND vendido_em < ${fim}
    `)
  ).rows;

  return {
    pedidos: lista,
    dinheiroOculto: false,
    mes,
    totais: totais ?? { faturamento: 0, taxas: 0, comissoes: 0, liquido: 0, aConferir: 0 },
  };
}
