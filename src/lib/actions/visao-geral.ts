/**
 * Leitura da tela Visao geral.
 *
 * ⚠️ ESTA TELA E QUASE TODA DINHEIRO. Vendas do mes, margem media e estoque por
 * lote sao restritos ao papel que pode ver custo (RN-107). Para o operador
 * sobram os dois indicadores de perguntas — que sao o trabalho dele — e a tela
 * DIZ que o resto e restrito, em vez de mostrar zeros. Zero e mentira; "restrito"
 * e informacao.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import type { LinhaSql } from "@/lib/db/linha";
import { podeVerCusto } from "@/lib/auth/rbac";
import type { Papel } from "@/lib/auth/sessao";
import type { Canal } from "@/lib/pricing";

export interface AnuncioDestaque {
  id: string;
  produto: string;
  canal: Canal;
  preco: number;
  visitas: number;
}

export interface PerguntaRecente {
  id: string;
  canal: Canal;
  texto: string;
  item: string | null;
  segundosRestantes: number;
}

export interface LoteResumo {
  id: string;
  nome: string;
  itens: number;
  vendidos: number;
}

export interface VisaoGeral {
  /** Perguntas pendentes agora. Todo papel ve. */
  perguntasSemResposta: number;
  /**
   * Media de `respondida_em - created_at` no mes, em segundos. `null` sem
   * respostas no periodo.
   *
   * ⚠️ OTIMISTA: conta a partir da NOSSA gravacao, nao de quando o comprador
   * perguntou (`criada_em_canal` nao existe — RN-118). Atraso de ingestao
   * desaparece da conta.
   */
  tempoMedioResposta: number | null;
  /** Anuncios mais vistos. Sem margem: quem quiser margem vai para /anuncios. */
  anunciosDestaque: AnuncioDestaque[];
  perguntasRecentes: PerguntaRecente[];

  // --- so para quem pode ver custo ---
  vendasDoMes?: number;
  /**
   * Margem REALIZADA das vendas do mes: `(liquido - custo_na_venda) / valor`.
   * `null` quando nao houve venda. Usa o custo CONGELADO (RN-114).
   */
  margemMedia?: number | null;
  lotes?: LoteResumo[];
  dinheiroOculto: boolean;
}

export async function lerVisaoGeral(papel: Papel): Promise<VisaoGeral> {
  const mostrarDinheiro = podeVerCusto(papel);

  const [perguntas] = (
    await db.execute<{ pendentes: number; tempoMedio: number | null }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pendente')::int AS pendentes,
        avg(EXTRACT(EPOCH FROM (respondida_em - created_at)))
          FILTER (WHERE respondida_em >= date_trunc('month', now()))
          ::double precision                             AS "tempoMedio"
      FROM perguntas
      WHERE is_deleted = false
    `)
  ).rows;

  const anunciosDestaque = await db.execute<LinhaSql<AnuncioDestaque>>(sql`
    SELECT a.id, i.nome AS produto, a.canal, a.preco::double precision AS preco, a.visitas
    FROM anuncios a
    JOIN itens i ON i.id = a.item_id AND i.is_deleted = false
    WHERE a.is_deleted = false AND a.status <> 'pausado'
    ORDER BY a.visitas DESC
    LIMIT 5
  `);

  /**
   * As perguntas mais URGENTES, nao as mais recentes.
   *
   * O card do handoff se chama "Perguntas recentes", mas numa tela de resumo o
   * que o dono precisa ver e o que esta prestes a estourar o SLA (RN-105.1) —
   * "recente" e "urgente" so coincidem enquanto nada atrasa.
   */
  const perguntasRecentes = await db.execute<LinhaSql<PerguntaRecente>>(sql`
    SELECT p.id, p.canal, p.texto, i.nome AS item,
           EXTRACT(EPOCH FROM (p.prazo_sla - now()))::double precision AS "segundosRestantes"
    FROM perguntas p
    LEFT JOIN itens i ON i.id = p.item_id AND i.is_deleted = false
    WHERE p.is_deleted = false AND p.status = 'pendente'
    ORDER BY p.prazo_sla ASC
    LIMIT 3
  `);

  const base: VisaoGeral = {
    perguntasSemResposta: perguntas?.pendentes ?? 0,
    tempoMedioResposta: perguntas?.tempoMedio ?? null,
    anunciosDestaque: anunciosDestaque.rows,
    perguntasRecentes: perguntasRecentes.rows,
    dinheiroOculto: !mostrarDinheiro,
  };

  if (!mostrarDinheiro) return base;

  const [mes] = (
    await db.execute<{ vendas: number; margem: number | null }>(sql`
      SELECT
        coalesce(sum(valor), 0)::double precision AS vendas,
        -- Margem REALIZADA e ponderada pelo valor: somar as margens de cada
        -- pedido e dividir por N daria o mesmo peso a uma venda de R$ 500 e a
        -- uma de R$ 50.000, e o numero deixaria de descrever o mes.
        CASE WHEN sum(valor) > 0
             THEN (sum(liquido - custo_na_venda) / sum(valor))::double precision
        END AS margem
      FROM pedidos
      WHERE is_deleted = false
        AND status <> 'cancelado'
        AND vendido_em >= date_trunc('month', now())
        AND vendido_em <  date_trunc('month', now()) + interval '1 month'
    `)
  ).rows;

  const lotes = await db.execute<LinhaSql<LoteResumo>>(sql`
    SELECT l.id, l.nome,
           count(i.id)::int                                        AS itens,
           count(i.id) FILTER (WHERE i.situacao = 'vendido')::int  AS vendidos
    FROM lotes l
    JOIN itens i ON i.lote_id = l.id AND i.is_deleted = false
    WHERE l.is_deleted = false
    GROUP BY l.id, l.nome
    ORDER BY l.data_arremate DESC
    LIMIT 4
  `);

  return {
    ...base,
    vendasDoMes: mes?.vendas ?? 0,
    margemMedia: mes?.margem ?? null,
    lotes: lotes.rows,
  };
}
