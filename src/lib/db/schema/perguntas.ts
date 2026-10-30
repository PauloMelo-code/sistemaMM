/**
 * Perguntas dos compradores — caixa unificada ML / OLX / WhatsApp.
 *
 * RN-105: SLA de resposta de 4h (configuravel). `prazo_sla` guarda o instante
 * limite ja calculado na entrada da pergunta; a pill vermelha e o alerta por
 * WhatsApp saem da comparacao com `now()`. Atraso derruba reputacao no ML.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

import { itens } from "./itens";
import { user } from "./auth";
import { canalEnum } from "./anuncios"; // enum de canal compartilhado (um tipo so no Postgres)

export const statusPerguntaEnum = pgEnum("status_pergunta", [
  "pendente",
  "respondida",
]);

export const perguntas = pgTable(
  "perguntas",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    canal: canalEnum("canal").notNull(),
    // ID da pergunta no canal de origem. Chave para o webhook nao duplicar.
    id_externo: text("id_externo"),
    // NULLABLE de proposito: pergunta pode chegar sem item identificado
    // (duvida geral no WhatsApp, ou anuncio ainda nao vinculado).
    item_id: uuid("item_id")
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => itens.id, { onDelete: "restrict" }),
    /**
     * Anuncio do canal em que a pergunta foi feita (`MLB...`). E o que permite
     * mostrar o produto antes do vinculo com o Estoque (RN-123) e, no vinculo,
     * preencher `item_id` sem adivinhar.
     */
    id_anuncio_externo: text("id_anuncio_externo"),
    texto: text("texto").notNull(),
    resposta: text("resposta"),
    respondida_em: timestamp("respondida_em"),
    prazo_sla: timestamp("prazo_sla").notNull(),
    status: statusPerguntaEnum("status").notNull().default("pendente"),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    modified_by: uuid("modified_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
  },
  (t) => ({
    // O comentario da coluna promete "chave para o webhook nao duplicar" — sem
    // este indice a promessa era so texto. Reentrega de notificacao do ML e
    // comum: sem a trava, a mesma pergunta entra duas vezes e a caixa unificada
    // passa a mostrar duplicata com dois prazos de SLA (RN-105).
    idExternoIdx: uniqueIndex("idx_perguntas_id_externo")
      .on(t.canal, t.id_externo)
      .where(sql`${t.is_deleted} = false`),
    // Caminho do job que varre o SLA (RN-105): so as pendentes, ordenadas por
    // prazo. Parcial porque respondida nao interessa ao alerta.
    slaPendenteIdx: index("idx_perguntas_sla_pendente")
      .on(t.prazo_sla)
      .where(sql`${t.status} = 'pendente' AND ${t.is_deleted} = false`),
    itemIdx: index("idx_perguntas_item").on(t.item_id),
    anuncioExternoIdx: index("idx_perguntas_anuncio_externo").on(t.id_anuncio_externo),
    naoDeletadosIdx: index("idx_perguntas_ativos").on(t.is_deleted),
  })
);

export type Pergunta = typeof perguntas.$inferSelect;
export type NovaPergunta = typeof perguntas.$inferInsert;
