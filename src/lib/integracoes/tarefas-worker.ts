/**
 * Worker que drena `integracoes_tarefas` — a segunda metade da RN-104.
 *
 * MESMAS TRES FASES do worker de eventos, e pela mesma razao: reivindicar em
 * transacao curta, executar FORA de transacao, gravar o resultado. Aqui a regra
 * e ainda mais literal — executar significa, por definicao, chamar a API de um
 * terceiro. Uma transacao aberta durante isso seguraria lock de linha enquanto
 * o marketplace demora.
 *
 * Nao foi generalizado com `worker.ts` de proposito: sao duas filas com regras
 * proprias (uma filtra por topico, a outra por par canal+tipo; uma tem handler,
 * a outra executor). Uma abstracao sobre dois casos pareceria economia e
 * cobraria em toda leitura futura.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import type { Canal } from "@/lib/pricing";

import { EXECUTORES, chaveExecutor, type TarefaParaExecutor } from "./executores";
import { MAX_TENTATIVAS, ErroPermanente, esgotou, descreverErro } from "./retentativa";
import { USUARIO_SISTEMA_ID } from "./usuario-sistema";
import type { TipoTarefa } from "./chave-tarefa";

/** Lote pequeno: cada tarefa e uma chamada de rede. */
export const LOTE_TAREFAS = 10;

export interface ResumoTarefas {
  reivindicadas: number;
  executadas: number;
  falhadas: number;
  esgotadas: number;
  /** O sistema olhou e nao ha o que fazer (anuncio sem id externo, p.ex.). */
  ignoradas: number;
  /** Pendentes que nenhum executor sabe realizar — hoje, tudo da OLX. */
  aguardandoExecutor: number;
}

type LinhaTarefa = {
  id: string;
  canal: Canal;
  tipo: TipoTarefa;
  referencia_id: string | null;
  payload: Record<string, unknown>;
  tentativas: number;
  [coluna: string]: unknown;
};

/**
 * Pendentes que NENHUM executor sabe realizar.
 *
 * Contado SEMPRE, e nao so quando o lote sai vazio: com uma tarefa da OLX parada
 * e tres do ML executadas, um resumo que dissesse `aguardandoExecutor: 0`
 * esconderia exatamente o que precisa aparecer — a metade da RN-104 que nao
 * acontece. Zero que mente e pior que numero nenhum.
 */
async function contarSemDono(chaves: string[]): Promise<number> {
  const semDono =
    chaves.length === 0
      ? sql`true`
      : sql`canal::text || ':' || tipo::text NOT IN (${sql.join(
          chaves.map((c) => sql`${c}`),
          sql`, `,
        )})`;

  const r = await db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total
    FROM integracoes_tarefas
    WHERE processado_em IS NULL AND is_deleted = false
      AND tentativas < ${MAX_TENTATIVAS}
      AND ${semDono}
  `);
  return r.rows[0]?.total ?? 0;
}

/**
 * Fase 1 — reivindicar, num unico comando atomico.
 *
 * O filtro por `(canal, tipo)` com executor evita que tarefa sem dono queime
 * tentativa: hoje toda tarefa para a OLX cairia fora, e chegaria esgotada no
 * dia em que o executor dela existisse.
 */
async function reivindicar(limite: number): Promise<LinhaTarefa[]> {
  const chaves = [...EXECUTORES.keys()];
  if (chaves.length === 0) return [];

  const lista = sql.join(chaves.map((c) => sql`${c}`), sql`, `);

  const r = await db.execute<LinhaTarefa>(sql`
    UPDATE integracoes_tarefas
    SET tentativas = tentativas + 1, updated_at = now(), modified_by = ${USUARIO_SISTEMA_ID}
    WHERE id IN (
      SELECT id FROM integracoes_tarefas
      WHERE processado_em IS NULL
        AND is_deleted = false
        AND tentativas < ${MAX_TENTATIVAS}
        AND canal::text || ':' || tipo::text IN (${lista})
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limite}
    )
    RETURNING id, canal, tipo, referencia_id, payload, tentativas
  `);
  return r.rows;
}

async function marcarFeita(id: string, { manterErro = false } = {}): Promise<void> {
  await db.execute(sql`
    UPDATE integracoes_tarefas
    SET processado_em = now(),
        ${manterErro ? sql`` : sql`erro = NULL,`}
        updated_at = now(), modified_by = ${USUARIO_SISTEMA_ID}
    WHERE id = ${id}
  `);
}

async function marcarErro(id: string, erro: string): Promise<void> {
  await db.execute(sql`
    UPDATE integracoes_tarefas
    SET erro = ${erro}, updated_at = now(), modified_by = ${USUARIO_SISTEMA_ID}
    WHERE id = ${id}
  `);
}

/**
 * Drena um lote de tarefas. Uma tarefa problematica nunca trava as outras.
 */
export async function drenarTarefas({ limite = LOTE_TAREFAS } = {}): Promise<ResumoTarefas> {
  const chaves = [...EXECUTORES.keys()];
  const linhas = await reivindicar(limite);

  const resumo: ResumoTarefas = {
    reivindicadas: linhas.length,
    executadas: 0,
    falhadas: 0,
    esgotadas: 0,
    ignoradas: 0,
    aguardandoExecutor: 0,
  };

  // Fase 2 — FORA de transacao. Cada uma destas linhas fala com um terceiro.
  for (const linha of linhas) {
    const executor = EXECUTORES.get(chaveExecutor(linha.canal, linha.tipo));
    if (!executor) {
      // Nao deveria acontecer: a consulta so traz par com executor. Se o
      // registro mudou no meio da passada, devolve a tarefa a fila.
      continue;
    }

    const tarefa: TarefaParaExecutor = {
      id: linha.id,
      canal: linha.canal,
      tipo: linha.tipo,
      referenciaId: linha.referencia_id,
      payload: linha.payload,
      tentativas: linha.tentativas,
    };

    try {
      await executor(tarefa);
      await marcarFeita(linha.id);
      resumo.executadas += 1;
    } catch (erro) {
      // Anuncio sem id externo, tipo sem executor correspondente: nada disso
      // muda por tentar de novo. Sai da fila com o motivo gravado.
      if (erro instanceof ErroPermanente) {
        await marcarErro(linha.id, descreverErro(erro));
        await marcarFeita(linha.id, { manterErro: true });
        resumo.ignoradas += 1;
        console.info(`[tarefas] ${linha.id} ignorada: ${erro.message}`);
        continue;
      }

      await marcarErro(linha.id, descreverErro(erro));
      if (esgotou(linha.tentativas)) {
        resumo.esgotadas += 1;
        console.error(
          `[tarefas] ${linha.id} (${linha.tipo}/${linha.canal}) esgotou ${MAX_TENTATIVAS} ` +
            "tentativas — anuncio pode ter ficado NO AR com item vendido",
          erro,
        );
      } else {
        resumo.falhadas += 1;
        console.warn(`[tarefas] ${linha.id} falhou (tentativa ${linha.tentativas})`, erro);
      }
    }
  }

  // Sempre — ver `contarSemDono`. O que fica sem dono precisa aparecer mesmo
  // quando a passada executou tudo o que sabia executar.
  resumo.aguardandoExecutor = await contarSemDono(chaves);

  return resumo;
}
