/**
 * Enfileiramento das acoes que precisam sair para os canais (RN-116).
 *
 * A REGRA QUE ORGANIZA ESTE ARQUIVO: `enfileirar` recebe a transacao de quem
 * chama, e nao abre uma propria. E o ponto inteiro do outbox — a intencao
 * ("pausar o anuncio X") precisa ser gravada no MESMO commit da venda. Se
 * abrisse transacao propria, voltaria a existir o instante em que a venda esta
 * gravada e a pausa nao, que e o buraco por onde o item vendido continua
 * anunciado no outro canal.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { integracoesTarefas } from "@/lib/db/schema/integracoes-tarefas";
import type { Canal } from "@/lib/pricing";

import { chaveTarefa, type IdentidadeTarefa } from "./chave-tarefa";
import { USUARIO_SISTEMA_ID } from "./usuario-sistema";

/** A chave mora em `./chave-tarefa.ts` (puro) — reexportada por conveniencia. */
export { chaveTarefa, type TipoTarefa } from "./chave-tarefa";

/**
 * `db` ou uma transacao dele. Inferido do proprio `db.transaction` para nao
 * importar tipo interno do drizzle — que muda de nome entre versoes menores.
 */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface NovaTarefa extends IdentidadeTarefa {
  canal: Canal;
  /** O que o executor precisa para agir sem consultar mais nada. */
  payload: Record<string, unknown>;
}

/**
 * Grava as tarefas na transacao recebida. Devolve quantas foram REALMENTE
 * enfileiradas — as que ja existiam sao ignoradas em silencio.
 *
 * `onConflictDoNothing` na chave: reprocessar o mesmo evento de venda nao pode
 * gerar uma segunda "pausar anuncio X". Silencio aqui e o comportamento certo,
 * nao omissao — a tarefa ja estar na fila E o resultado desejado.
 */
export async function enfileirar(executor: Executor, tarefas: NovaTarefa[]): Promise<number> {
  if (tarefas.length === 0) return 0;

  const linhas = await executor
    .insert(integracoesTarefas)
    .values(
      tarefas.map((t) => ({
        canal: t.canal,
        tipo: t.tipo,
        referencia_id: t.referenciaId,
        chave_idempotencia: chaveTarefa(t),
        payload: t.payload,
        modified_by: USUARIO_SISTEMA_ID,
      })),
    )
    .onConflictDoNothing({ target: integracoesTarefas.chave_idempotencia })
    .returning({ id: integracoesTarefas.id });

  return linhas.length;
}

export interface ResumoFila {
  pendentes: number;
  esgotadas: number;
}

/**
 * Quantas tarefas esperam e quantas desistiram — o numero que a tela
 * Integracoes precisa mostrar para a RN-104 parar de falhar em silencio.
 *
 * `esgotadas` sao as que estouraram as tentativas: continuam pendentes no banco
 * (nao viram "processadas", que seria mentira) mas sairam da fila do worker.
 * Sao as que precisam de gente.
 */
export async function contarTarefas(maxTentativas: number): Promise<ResumoFila> {
  const resultado = await db.execute<{ pendentes: number; esgotadas: number }>(sql`
    SELECT
      count(*) FILTER (WHERE tentativas < ${maxTentativas})::int  AS pendentes,
      count(*) FILTER (WHERE tentativas >= ${maxTentativas})::int AS esgotadas
    FROM integracoes_tarefas
    WHERE processado_em IS NULL AND is_deleted = false
  `);

  return {
    pendentes: resultado.rows[0]?.pendentes ?? 0,
    esgotadas: resultado.rows[0]?.esgotadas ?? 0,
  };
}
