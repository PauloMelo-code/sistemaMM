/**
 * Worker que drena `integracoes_eventos`.
 *
 * TRES FASES, e a separacao entre elas e a decisao principal deste arquivo:
 *
 *   1. reivindicar  — transacao CURTA, `FOR UPDATE SKIP LOCKED`
 *   2. executar     — FORA de qualquer transacao
 *   3. gravar       — transacao CURTA por evento
 *
 * Hoje nenhum handler faz chamada externa (nao ha credencial), entao daria para
 * fazer tudo numa transacao so e parecer mais simples. Seria uma armadilha: no
 * dia em que o primeiro handler fizer o GET na API do ML, essa transacao ficaria
 * aberta esperando HTTP de terceiro — segurando lock de linha e consumindo
 * conexao do pool enquanto o marketplace demora. A estrutura precisa tornar
 * dificil escrever esse bug, nao convidar para ele.
 *
 * ONDE ISTO RODA ainda nao foi decidido (fila em Postgres x BullMQ/Redis e ADR
 * aberto do Lucas). Por isso aqui e uma FUNCAO que drena um lote e retorna —
 * nao um daemon, nao um `setInterval`, nao um agendador. Quem chama decide:
 * hoje e a rota `/api/integracoes/worker`, amanha pode ser um cron ou um worker
 * dedicado, sem reescrever nada disto.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import type { Canal } from "@/lib/pricing";

import { HANDLERS, chaveHandler, type EventoParaHandler } from "./handlers";
import { MAX_TENTATIVAS, ErroPermanente, esgotou, descreverErro } from "./retentativa";
import { USUARIO_SISTEMA_ID } from "./usuario-sistema";

/**
 * A politica de retentativa mora em `./retentativa.ts`, que e PURO — este
 * arquivo importa `db` e obrigaria um teste daquelas funcoes a ter banco no ar.
 * Reexportado para quem consome o worker nao precisar saber disso.
 */
export { MAX_TENTATIVAS, esgotou, descreverErro } from "./retentativa";

/** Tamanho padrao do lote. Baixo de proposito: e melhor drenar mais vezes. */
export const LOTE_PADRAO = 20;

export interface ResumoDrenagem {
  /** Eventos que este worker pegou para si nesta passada. */
  reivindicados: number;
  processados: number;
  /** Falharam nesta passada e ainda serao tentados de novo. */
  falhados: number;
  /** Falharam e bateram o teto de tentativas — nao voltam sozinhos. */
  esgotados: number;
  /**
   * Concluidos COM RESSALVA: o sistema olhou e decidiu que nao ha o que fazer
   * (pedido de outro vendedor, venda nao paga, peca ja vendida). Saem da fila
   * com o motivo gravado — nao sao falha nem sucesso.
   */
  ignorados: number;
  /**
   * Pendentes que NINGUEM sabe processar: nao ha handler para o topico deles.
   * Enquanto nao houver credencial do ML, este numero e o total da fila — e
   * isso e o esperado, nao um defeito.
   */
  aguardandoHandler: number;
}

/**
 * O `db.execute` tipado exige uma forma indexavel (`Record<string, unknown>`),
 * porque a linha vem do driver sem garantia de formato. O `type` com assinatura
 * de indice satisfaz isso sem afrouxar os campos que realmente usamos.
 */
type LinhaReivindicada = {
  id: string;
  canal: Canal;
  topico: string | null;
  recurso: string | null;
  corpo: unknown;
  tentativas: number;
  [coluna: string]: unknown;
};

/** Pendentes que nao estao esgotados — a fila real, tenha handler ou nao. */
async function contarPendentes(): Promise<number> {
  const resultado = await db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total
    FROM integracoes_eventos
    WHERE processado_em IS NULL
      AND is_deleted = false
      AND tentativas < ${MAX_TENTATIVAS}
  `);
  return resultado.rows[0]?.total ?? 0;
}

/**
 * Fase 1 — reivindicar.
 *
 * Um UNICO `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)
 * RETURNING`: e atomico por construcao, sem precisar abrir transacao explicita.
 * `SKIP LOCKED` faz dois workers simultaneos dividirem a fila em vez de um
 * esperar o outro; sem ele, o segundo bloquearia na primeira linha travada.
 *
 * O incremento de `tentativas` E a reivindicacao — por isso acontece aqui, no
 * mesmo comando, e nao depois. Se fosse gravado so no fim, um worker que
 * morresse no meio deixaria o evento sem marca nenhuma e ele seria tentado para
 * sempre.
 *
 * O filtro por handler existe para o evento nao queimar tentativa enquanto
 * ninguem sabe processa-lo: sem ele, os eventos que estao esperando a
 * integracao chegariam esgotados no dia em que houvesse o que fazer com eles.
 */
async function reivindicar(limite: number): Promise<LinhaReivindicada[]> {
  const chaves = [...HANDLERS.keys()];
  if (chaves.length === 0) return [];

  const lista = sql.join(
    chaves.map((chave) => sql`${chave}`),
    sql`, `,
  );

  const resultado = await db.execute<LinhaReivindicada>(sql`
    UPDATE integracoes_eventos
    SET tentativas = tentativas + 1,
        updated_at = now(),
        modified_by = ${USUARIO_SISTEMA_ID}
    WHERE id IN (
      SELECT id
      FROM integracoes_eventos
      WHERE processado_em IS NULL
        AND is_deleted = false
        AND tentativas < ${MAX_TENTATIVAS}
        AND canal::text || ':' || coalesce(topico, '') IN (${lista})
      ORDER BY recebido_em
      FOR UPDATE SKIP LOCKED
      LIMIT ${limite}
    )
    RETURNING id, canal, topico, recurso, corpo, tentativas
  `);

  return resultado.rows;
}

/**
 * Fase 3 — sucesso.
 *
 * `manterErro` e para a conclusao COM RESSALVA (erro permanente): o evento sai
 * da fila, mas o motivo de nao ter virado nada fica gravado. Limpar `erro` ali
 * apagaria a unica explicacao de por que aquela notificacao nao gerou pedido.
 */
async function marcarProcessado(id: string, { manterErro = false } = {}): Promise<void> {
  await db.execute(sql`
    UPDATE integracoes_eventos
    SET processado_em = now(),
        ${manterErro ? sql`` : sql`erro = NULL,`}
        updated_at = now(),
        modified_by = ${USUARIO_SISTEMA_ID}
    WHERE id = ${id}
  `);
}

/** Fase 3 — falha. `processado_em` continua nulo: o evento segue na fila. */
async function marcarErro(id: string, erro: string): Promise<void> {
  await db.execute(sql`
    UPDATE integracoes_eventos
    SET erro = ${erro}, updated_at = now(), modified_by = ${USUARIO_SISTEMA_ID}
    WHERE id = ${id}
  `);
}

/**
 * Drena um lote. Devolve o que aconteceu — quem chama decide se roda de novo.
 *
 * Nunca lanca por causa de UM evento: handler que explode vira `erro` gravado e
 * a fila continua. Um evento problematico nao pode travar os outros.
 */
export async function drenarEventos({ limite = LOTE_PADRAO } = {}): Promise<ResumoDrenagem> {
  const linhas = await reivindicar(limite);

  const resumo: ResumoDrenagem = {
    reivindicados: linhas.length,
    processados: 0,
    falhados: 0,
    esgotados: 0,
    ignorados: 0,
    aguardandoHandler: 0,
  };

  // Fase 2 — FORA de transacao. Ver o cabecalho do arquivo.
  for (const linha of linhas) {
    const handler = HANDLERS.get(chaveHandler(linha.canal, linha.topico));

    // Nao deveria acontecer: a consulta so traz topico com handler. Se
    // acontecer, e porque o registro mudou no meio da passada — o seguro e
    // devolver o evento a fila, nao marcar como processado.
    if (!handler) {
      resumo.aguardandoHandler += 1;
      continue;
    }

    const evento: EventoParaHandler = {
      id: linha.id,
      canal: linha.canal,
      topico: linha.topico,
      recurso: linha.recurso,
      corpo: linha.corpo,
      tentativas: linha.tentativas,
    };

    try {
      await handler(evento);
      await marcarProcessado(linha.id);
      resumo.processados += 1;
    } catch (erro) {
      // Falha que nao muda por tentar de novo (pedido de outro vendedor, venda
      // nao paga, peca ja vendida): CONCLUIDA com ressalva. Nos olhamos e
      // decidimos que nao ha o que fazer — repetir cinco vezes so encheria de
      // ruido a lista que deveria mostrar o que precisa de gente.
      if (erro instanceof ErroPermanente) {
        await marcarErro(linha.id, descreverErro(erro));
        await marcarProcessado(linha.id, { manterErro: true });
        resumo.ignorados += 1;
        console.info(`[worker] evento ${linha.id} ignorado: ${erro.message}`);
        continue;
      }

      await marcarErro(linha.id, descreverErro(erro));
      if (esgotou(linha.tentativas)) {
        resumo.esgotados += 1;
        console.error(
          `[worker] evento ${linha.id} esgotou ${MAX_TENTATIVAS} tentativas — parou aqui`,
          erro,
        );
      } else {
        resumo.falhados += 1;
        console.warn(`[worker] evento ${linha.id} falhou (tentativa ${linha.tentativas})`, erro);
      }
    }
  }

  // Só custa uma consulta quando o lote veio vazio — que e o caso enquanto nao
  // ha handler nenhum. E justamente ai que este numero e a informacao util.
  if (linhas.length === 0) {
    resumo.aguardandoHandler = await contarPendentes();
  }

  return resumo;
}
