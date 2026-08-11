/**
 * Outbox das acoes que precisam sair para os canais (RN-116).
 *
 * O PROBLEMA QUE ESTA TABELA RESOLVE: a RN-104 termina em HTTP para terceiro —
 * vendeu no ML, precisa pausar na OLX e tirar do site. Chamada externa nao faz
 * rollback, e transacao aberta esperando HTTP segura lock de linha e envenena o
 * pool de conexoes. Sem esta tabela sobram duas opcoes, e as duas sao ruins:
 * chamar dentro da transacao, ou chamar depois do commit e perder a intencao se
 * o processo morrer no meio.
 *
 * A intencao ("pausar o anuncio X no canal Y") e gravada na MESMA transacao da
 * venda. Commit atomico: ou existem a venda e as tarefas, ou nao existe nenhum
 * dos dois. Um worker drena depois, com retentativa.
 *
 * MESMO DESENHO DA `integracoes_eventos`, de proposito: `processado_em` nulo =
 * pendente, `tentativas` conta as reivindicacoes, teto vira "esgotada". Dois
 * mecanismos diferentes para a mesma ideia seria uma armadilha para quem le.
 *
 * ESTA TABELA E A ENTRADA, NAO A SAIDA. Ela nao decide onde o worker roda —
 * fila em Postgres x BullMQ/Redis segue sendo ADR aberto do Lucas. Se um dia for
 * Redis, o Redis vira o transporte e esta tabela continua sendo o registro
 * transacional, que e o unico jeito de a intencao nascer junto com a venda.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, jsonb, integer, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

import { usuarios } from "./usuarios";
import { canalEnum } from "./anuncios"; // enum de canal compartilhado

/**
 * O que fazer. Enum e nao texto livre — diferente do `topico` dos eventos, que e
 * vocabulario DELES: aqui o vocabulario e NOSSO, e tipo desconhecido significa
 * codigo que ninguem escreveu, nao integracao que mudou. Melhor falhar na
 * gravacao do que enfileirar uma tarefa que nenhum worker sabe executar.
 *
 * ⚠️ `tirar_do_site` E RESERVADO E NAO DEVE SER USADO. Tirar do site e operacao
 * INTERNA (`itens.exibir_no_site`), sem API de terceiro, entao ela acontece na
 * MESMA transacao da venda — nao no outbox. Enfileirar criava uma janela em que
 * o item estava vendido e ainda no ar na vitrine, esperando um worker, sem
 * motivo. O valor continua no enum porque remover valor de enum no Postgres
 * exige recriar o tipo e alterar a coluna, o que nao se justifica por um rotulo
 * que ninguem emite. Se um dia existir uma vitrine EXTERNA (fora do nosso
 * banco), ele ganha uso legitimo.
 */
export const tipoTarefaEnum = pgEnum("tipo_tarefa_integracao", [
  "pausar_anuncio",
  "reativar_anuncio",
  "tirar_do_site",
]);

export const integracoesTarefas = pgTable(
  "integracoes_tarefas",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    /** Onde a acao precisa acontecer. */
    canal: canalEnum("canal").notNull(),
    tipo: tipoTarefaEnum("tipo").notNull(),
    /**
     * O alvo interno (normalmente `anuncios.id`). Sem FK de proposito: a tarefa
     * pode sobreviver ao alvo (anuncio excluido logicamente enquanto a tarefa
     * espera) e uma FK RESTRICT ai transformaria limpeza de cadastro em erro de
     * banco. Quem executa confere se o alvo ainda existe.
     */
    referencia_id: uuid("referencia_id"),
    /** O que o worker precisa para executar sem consultar mais nada. */
    payload: jsonb("payload").notNull(),

    /**
     * Trava de enfileiramento duplicado.
     *
     * Reprocessar o mesmo evento de venda nao pode gerar duas tarefas "pausar o
     * anuncio X" — a RN-104 exige que a acao seja idempotente, e pausar duas
     * vezes e o caso que ela cita por nome. A chave descreve a INTENCAO
     * (`pausar_anuncio:<anuncio>:pedido:<pedido>`), nao o instante, entao a
     * segunda tentativa de enfileirar colide em vez de duplicar.
     */
    chave_idempotencia: text("chave_idempotencia").notNull(),

    /** Nulo = pendente. E o que o worker procura. */
    processado_em: timestamp("processado_em"),
    tentativas: integer("tentativas").notNull().default(0),
    /** Ultimo erro. Com `tentativas` no teto, e o que a tela Integracoes lista. */
    erro: text("erro"),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    modified_by: uuid("modified_by")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => usuarios.id, { onDelete: "restrict" }),
  },
  (t) => ({
    /**
     * NAO e parcial em `is_deleted`, pela mesma razao da `integracoes_eventos`:
     * se a exclusao logica liberasse a chave, apagar uma tarefa ja executada
     * abriria caminho para enfileirar a mesma acao de novo — e "pausar de novo"
     * e exatamente o que a RN-104 proibe.
     */
    chaveIdx: uniqueIndex("idx_integracoes_tarefas_chave").on(t.chave_idempotencia),
    /** Caminho do worker: pendentes, da mais antiga para a mais nova. */
    pendentesIdx: index("idx_integracoes_tarefas_pendentes")
      .on(t.created_at)
      .where(sql`${t.processado_em} IS NULL AND ${t.is_deleted} = false`),
    naoDeletadosIdx: index("idx_integracoes_tarefas_ativos").on(t.is_deleted),
  })
);

export type IntegracaoTarefa = typeof integracoesTarefas.$inferSelect;
export type NovaIntegracaoTarefa = typeof integracoesTarefas.$inferInsert;
