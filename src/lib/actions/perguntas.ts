/**
 * Leitura da caixa unificada de perguntas (RN-105, RN-105.1).
 *
 * Perguntas nao expoem custo, entao a RN-107 nao restringe esta tela: operador e
 * administrador veem a mesma coisa. Quando entrar a acao de responder, ela vai
 * precisar de sessao (`modified_by`) — e ai a pendencia de autenticacao
 * (docs/known-issues.md 🔴) passa a bloquear.
 */
import { sql, eq, and } from "drizzle-orm";

import { db } from "@/lib/db";
import { integracoesMlAnuncios } from "@/lib/db/schema/integracoes-ml-anuncios";
import { itens } from "@/lib/db/schema/itens";
import { perguntas } from "@/lib/db/schema/perguntas";
import type { Canal } from "@/lib/pricing";

export interface PerguntaNaFila {
  id: string;
  canal: Canal;
  texto: string;
  /** Nome do item perguntado. Nulo quando a pergunta chegou sem item vinculado. */
  item: string | null;
  respondida: boolean;
  /**
   * Segundos ate o prazo, NEGATIVO se ja venceu. Calculado pelo PostgreSQL —
   * ver a nota de fuso horario em `sla.ts`.
   */
  segundosRestantes: number;
  /** Segundos entre a chegada e a resposta. Nulo enquanto pendente. */
  segundosAteResposta: number | null;
}

/**
 * Quantas perguntas a tela carrega.
 *
 * O corte atinge PRIMEIRO a cauda de respondidas: as pendentes ordenam antes,
 * entao enquanto houver menos de 60 pendentes nenhuma pergunta em aberto some —
 * o que importa numa fila de trabalho.
 *
 * Passando de 60 PENDENTES o limite comeca a esconder pergunta em aberto, e ai a
 * tela precisa dizer isso: fila truncada em silencio parece fila vazia, e o
 * operador para de atender achando que acabou.
 */
const LIMITE_FILA = 60;

export interface FilaPerguntas {
  perguntas: PerguntaNaFila[];
  /** `true` quando existe pergunta alem do `LIMITE_FILA` — a tela avisa. */
  truncada: boolean;
}

/**
 * A fila de perguntas, ja na ordem de atendimento da RN-105.1: pendentes antes
 * de respondidas, vencidas no topo, respondidas por resposta mais recente.
 *
 * A ordenacao mora no SQL de proposito. Ordenar no cliente exigiria trazer a
 * lista inteira e reimplementar o criterio — e criterio de SLA duplicado e
 * exatamente o que a RN-105.1 proibe.
 *
 * Busca `LIMITE_FILA + 1` para saber se sobrou alguma sem gastar um `count(*)`:
 * se voltar a linha extra, a fila esta truncada. A linha extra e descartada.
 */
export async function listarPerguntas(): Promise<FilaPerguntas> {
  const linhas = await db
    .select({
      id: perguntas.id,
      canal: perguntas.canal,
      texto: perguntas.texto,
      // Sem item vinculado, o titulo do anuncio importado do ML (RN-123): a
      // pergunta chega antes do vinculo, e "—" nao diz do que se trata.
      item: sql<string | null>`coalesce(${itens.nome}, ${integracoesMlAnuncios.titulo})`.as("item"),
      status: perguntas.status,
      // `EXTRACT(EPOCH FROM ...)` devolve `numeric`, que o driver `pg` entrega
      // como STRING (precisao arbitraria nao cabe em number sem perda). O cast
      // para `double precision` faz o driver devolver number de verdade — sem
      // ele, `segundosRestantes` chegaria como "11700.4" e toda comparacao da
      // escala viraria comparacao de texto.
      segundosRestantes: sql<number>`
        EXTRACT(EPOCH FROM (${perguntas.prazo_sla} - now()))::double precision
      `.as("segundos_restantes"),
      segundosAteResposta: sql<number | null>`
        EXTRACT(EPOCH FROM (${perguntas.respondida_em} - ${perguntas.created_at}))::double precision
      `.as("segundos_ate_resposta"),
    })
    .from(perguntas)
    // LEFT: `item_id` e nullable de proposito (duvida geral no WhatsApp chega
    // sem item). INNER esconderia essas perguntas da fila — some do painel uma
    // pergunta que o SLA continua contando.
    .leftJoin(itens, and(eq(itens.id, perguntas.item_id), eq(itens.is_deleted, false)))
    .leftJoin(
      integracoesMlAnuncios,
      and(
        eq(perguntas.canal, "mercado_livre"),
        eq(integracoesMlAnuncios.id_externo, perguntas.id_anuncio_externo),
        eq(integracoesMlAnuncios.is_deleted, false),
      ),
    )
    .where(eq(perguntas.is_deleted, false))
    .orderBy(
      sql`${perguntas.status} = 'respondida'`, // false < true: pendentes primeiro
      sql`CASE WHEN ${perguntas.status} = 'pendente' THEN ${perguntas.prazo_sla} END ASC NULLS LAST`,
      sql`${perguntas.respondida_em} DESC NULLS LAST`,
    )
    .limit(LIMITE_FILA + 1);

  const truncada = linhas.length > LIMITE_FILA;

  return {
    truncada,
    perguntas: linhas.slice(0, LIMITE_FILA).map((l) => ({
      id: l.id,
      canal: l.canal,
      texto: l.texto,
      item: l.item,
      respondida: l.status === "respondida",
      segundosRestantes: l.segundosRestantes,
      segundosAteResposta: l.segundosAteResposta,
    })),
  };
}

/**
 * Quantas perguntas estao pendentes — o badge ambar da sidebar (handoff: "3").
 *
 * Consulta propria, e nao `listarPerguntas().length`, porque o badge aparece em
 * TODAS as telas do painel: o layout nao pode carregar a fila inteira so para
 * contar. Bate no indice parcial `idx_perguntas_sla_pendente`.
 */
export async function contarPerguntasPendentes(): Promise<number> {
  const [linha] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(perguntas)
    .where(and(eq(perguntas.is_deleted, false), eq(perguntas.status, "pendente")));

  return linha?.total ?? 0;
}
