/**
 * Caixa de entrada das notificacoes dos canais (RN-117).
 *
 * O marketplace nao entrega dados: entrega um aviso de que algo mudou, espera
 * 200 em fracao de segundo e REENTREGA se demorar. Depois de falhas seguidas,
 * suspende as notificacoes da aplicacao inteira — e ai vendas e perguntas param
 * de entrar em silencio.
 *
 * Por isso esta tabela e o unico efeito do request: o handler grava UMA linha e
 * responde. O trabalho de verdade (buscar o recurso na API do canal, dar baixa
 * no estoque, pausar os outros anuncios) acontece depois, fora do request.
 *
 * `corpo` e prova, NAO fonte. Ninguem deduz venda, preco ou item a partir dele —
 * a URL e publica e qualquer um pode postar o que quiser. O corpo serve para
 * saber QUAL recurso olhar, para replay e para auditoria.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, jsonb, integer, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { canalEnum } from "./anuncios"; // enum de canal compartilhado (um tipo so no Postgres)

export const integracoesEventos = pgTable(
  "integracoes_eventos",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    canal: canalEnum("canal").notNull(),
    /**
     * O que o canal chamou de topico ("orders_v2", "questions"). Texto livre de
     * proposito: e vocabulario DELES, muda sem nos avisar, e um enum nosso
     * transformaria topico novo em erro de gravacao — justamente no caminho que
     * nunca pode falhar.
     */
    topico: text("topico"),
    /** Qual recurso olhar na API do canal (ex.: "/orders/2000012345"). */
    recurso: text("recurso"),
    /**
     * Identidade do evento para fins de reentrega. Ver `chaveEvento()` em
     * `src/lib/integracoes/eventos.ts` — e o unico lugar que a produz.
     */
    chave_evento: text("chave_evento").notNull(),
    /** Envelope cru, como chegou. Prova, nao fonte. */
    corpo: jsonb("corpo").notNull(),

    recebido_em: timestamp("recebido_em").notNull().defaultNow(),
    /**
     * Nulo = ainda nao processado. E o que o worker procura.
     * Enquanto nao existir credencial do ML, TODA linha fica com nulo aqui —
     * de proposito: sem token nao ha GET, e sem GET nao ha dado confiavel.
     */
    processado_em: timestamp("processado_em"),
    tentativas: integer("tentativas").notNull().default(0),
    /** Ultimo erro de processamento. Nulo enquanto nunca falhou. */
    erro: text("erro"),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    modified_by: uuid("modified_by")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => user.id, { onDelete: "restrict" }),
  },
  (t) => ({
    /**
     * A trava de reentrega, e o motivo de a RN-117 proibir `SELECT` antes do
     * `INSERT`: com `ON CONFLICT DO NOTHING RETURNING`, duas entregas
     * SIMULTANEAS do mesmo evento sao resolvidas pelo banco. Um check-then-act
     * na aplicacao deixaria as duas passarem pela janela entre a leitura e a
     * escrita — que e exatamente quando o marketplace reentrega.
     *
     * NAO e parcial em `is_deleted`: aqui, diferente das outras tabelas, a
     * exclusao logica de um evento nao pode liberar a chave. Se liberasse,
     * apagar um evento processado abriria caminho para o mesmo evento entrar de
     * novo e a venda ser processada duas vezes.
     */
    chaveIdx: uniqueIndex("idx_integracoes_eventos_chave").on(t.canal, t.chave_evento),
    /**
     * Caminho do worker: so os pendentes, do mais antigo para o mais novo.
     * Parcial porque evento processado nunca mais interessa a essa varredura, e
     * a tabela cresce para sempre.
     */
    pendentesIdx: index("idx_integracoes_eventos_pendentes")
      .on(t.recebido_em)
      .where(sql`${t.processado_em} IS NULL AND ${t.is_deleted} = false`),
    naoDeletadosIdx: index("idx_integracoes_eventos_ativos").on(t.is_deleted),
  })
);

export type IntegracaoEvento = typeof integracoesEventos.$inferSelect;
export type NovoIntegracaoEvento = typeof integracoesEventos.$inferInsert;
