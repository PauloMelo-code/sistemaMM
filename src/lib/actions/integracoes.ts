/**
 * Estado real das integracoes — o que a tela Integracoes precisa saber.
 *
 * O PROTOTIPO desenhou esta tela como cinco cards com pill "Conectado" fixa e
 * nenhum estado de erro. A auditoria registrou isso como o defeito principal
 * dela: token OAuth expira, e quando o ML cai, quatro das doze telas envelhecem
 * **em silencio** — o painel continua bonito e o Anderson descobre pelo cliente.
 *
 * Entao aqui as pills saem de fato do banco, e junto vem o que so passou a
 * existir com a integracao: fila parada, tarefa esgotada, reconciliacao velha.
 *
 * NUNCA devolve token, nem pedaco dele. So se ha credencial e quando vence.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { MAX_TENTATIVAS } from "@/lib/integracoes/retentativa";
import type { Canal } from "@/lib/pricing";

/**
 * Estado de uma conexao.
 *
 * `nao_configurado` e diferente de `erro` de proposito: "nunca foi ligado" e
 * pendencia de setup; "estava ligado e quebrou" e incidente. Misturar os dois
 * faria o painel gritar vermelho desde o primeiro dia e ninguem mais olharia.
 */
export type EstadoConexao = "conectado" | "vencendo" | "vencido" | "nao_configurado";

export interface Conexao {
  canal: Canal;
  estado: EstadoConexao;
  /** Segundos ate o token vencer. Negativo = venceu. Nulo sem credencial. */
  segundosAteVencer: number | null;
  contaExterna: string | null;
}

export interface Fila {
  eventosPendentes: number;
  eventosEsgotados: number;
  tarefasPendentes: number;
  /** Tarefas que desistiram: anuncio pode ter ficado NO AR com item vendido. */
  tarefasEsgotadas: number;
  /** Tarefas que nenhum executor sabe fazer — hoje, as da OLX sem decisao. */
  tarefasSemExecutor: number;
}

export interface Sincronizacao {
  recurso: string;
  /** Segundos desde a ultima passada bem-sucedida. Nulo = nunca teve. */
  segundosDesdeSucesso: number | null;
  ateQualInstante: Date | null;
}

export interface EstadoIntegracoes {
  conexoes: Conexao[];
  fila: Fila;
  sincronizacoes: Sincronizacao[];
}

/** Margem em que o token ja conta como "vencendo" (1h). */
export const MARGEM_VENCENDO_S = 3600;

/**
 * Reconciliacao mais velha que isto e obsoleta.
 *
 * A analise pede cadencia de 15-30 min; 90 minutos da folga para duas passadas
 * falharem antes de acusar. Enquanto **nada agenda** a reconciliacao, o estado
 * util e "nunca executou" — e por isso `segundosDesdeSucesso` nulo NAO e tratado
 * como obsoleto: falta de setup nao e incidente.
 */
export const LIMITE_OBSOLESCENCIA_S = 90 * 60;

export async function lerEstadoIntegracoes(): Promise<EstadoIntegracoes> {
  const credenciais = await db.execute<{
    canal: Canal;
    conta: string | null;
    segundos: number;
  }>(sql`
    SELECT canal, conta_externa_id AS conta,
           EXTRACT(EPOCH FROM (expira_em - now()))::double precision AS segundos
    FROM integracoes_credenciais
    WHERE is_deleted = false
  `);

  const porCanal = new Map(credenciais.rows.map((l) => [l.canal, l]));
  const canais: Canal[] = ["mercado_livre", "olx", "whatsapp"];

  const conexoes: Conexao[] = canais.map((canal) => {
    const linha = porCanal.get(canal);
    if (!linha) {
      return { canal, estado: "nao_configurado", segundosAteVencer: null, contaExterna: null };
    }
    const estado: EstadoConexao =
      linha.segundos <= 0 ? "vencido" : linha.segundos <= MARGEM_VENCENDO_S ? "vencendo" : "conectado";
    return {
      canal,
      estado,
      segundosAteVencer: linha.segundos,
      contaExterna: linha.conta,
    };
  });

  const [eventos] = (
    await db.execute<{ pendentes: number; esgotados: number }>(sql`
      SELECT count(*) FILTER (WHERE tentativas <  ${MAX_TENTATIVAS})::int AS pendentes,
             count(*) FILTER (WHERE tentativas >= ${MAX_TENTATIVAS})::int AS esgotados
      FROM integracoes_eventos
      WHERE processado_em IS NULL AND is_deleted = false
    `)
  ).rows;

  // `sem_executor` sai de uma lista fixa e nao do registro de executores: esta
  // consulta roda no server component da tela, e importar o registro traria
  // junto o cliente do ML. A tela so precisa saber que ha tarefa parada.
  const [tarefas] = (
    await db.execute<{ pendentes: number; esgotadas: number; sem_executor: number }>(sql`
      SELECT count(*) FILTER (WHERE tentativas <  ${MAX_TENTATIVAS})::int AS pendentes,
             count(*) FILTER (WHERE tentativas >= ${MAX_TENTATIVAS})::int AS esgotadas,
             count(*) FILTER (WHERE tentativas = 0 AND canal = 'olx')::int  AS sem_executor
      FROM integracoes_tarefas
      WHERE processado_em IS NULL AND is_deleted = false
    `)
  ).rows;

  const sincronizacoes = await db.execute<{
    recurso: string;
    segundos: number | null;
    ate: Date | null;
  }>(sql`
    SELECT recurso,
           EXTRACT(EPOCH FROM (now() - ultimo_sucesso_em))::double precision AS segundos,
           ate_qual_instante AS ate
    FROM integracoes_sincronizacoes
    WHERE is_deleted = false
    ORDER BY recurso
  `);

  return {
    conexoes,
    fila: {
      eventosPendentes: eventos?.pendentes ?? 0,
      eventosEsgotados: eventos?.esgotados ?? 0,
      tarefasPendentes: tarefas?.pendentes ?? 0,
      tarefasEsgotadas: tarefas?.esgotadas ?? 0,
      tarefasSemExecutor: tarefas?.sem_executor ?? 0,
    },
    sincronizacoes: sincronizacoes.rows.map((l) => ({
      recurso: l.recurso,
      segundosDesdeSucesso: l.segundos,
      ateQualInstante: l.ate,
    })),
  };
}
