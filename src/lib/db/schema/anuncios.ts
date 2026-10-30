/**
 * Anuncios de um item por canal (Mercado Livre, OLX, WhatsApp).
 *
 * Um item pode ter um anuncio em cada canal. Venda em um canal pausa os
 * demais (RN-104) — a acao e unica e idempotente, disparada pelo webhook.
 *
 * A margem exibida na tela sai de pricing.ts (RN-100/RN-103) e nao e coluna:
 * derivar de preco x custo do item, nunca gravar copia divergente.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, numeric, integer, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

import { itens } from "./itens";
import { user } from "./auth";

/**
 * Canal de venda — enum COMPARTILHADO por anuncios, perguntas e pedidos.
 * Um unico tipo no Postgres: relatorio de vendas por canal cruza as tres
 * tabelas sem cast. Nao duplicar em enums separados por tabela.
 */
export const canalEnum = pgEnum("canal", ["mercado_livre", "olx", "whatsapp"]);

export const statusAnuncioEnum = pgEnum("status_anuncio", [
  "no_ar",
  "negociando",
  "pausado",
]);

export const anuncios = pgTable(
  "anuncios",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    item_id: uuid("item_id")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => itens.id, { onDelete: "restrict" }),
    canal: canalEnum("canal").notNull(),
    // ID do anuncio no canal (MLB..., OLX...). Nulo em venda direta/WhatsApp
    // e enquanto a publicacao nao foi confirmada pela API.
    id_externo: text("id_externo"),
    preco: numeric("preco", { precision: 14, scale: 2 }).notNull(),
    status: statusAnuncioEnum("status").notNull().default("no_ar"),
    visitas: integer("visitas").notNull().default(0),
    /**
     * Ate quando as vendas do canal ja estao descontadas de `itens.quantidade`
     * (RN-124). No vinculo com um anuncio importado do ML, e o instante da
     * importacao: a quantidade disponivel veio do ML ja sem essas vendas. Venda
     * com data ate aqui vira pedido SEM baixa — senao baixaria duas vezes.
     * Nulo = toda venda baixa (anuncio criado pelo painel).
     */
    contado_ate: timestamp("contado_ate"),

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
    // "Um item pode ter UM anuncio em cada canal" (cabecalho deste arquivo)
    // agora e garantido pelo banco. Sem isso, um reprocesso de sync criaria um
    // 2o anuncio ativo no mesmo canal e a pausa em cascata da RN-104 — que
    // naturalmente busca um por canal — deixaria o outro no ar: item vendido
    // continuando anunciado, que e o dano de reputacao que a regra evita.
    itemCanalIdx: uniqueIndex("idx_anuncios_item_canal_ativo")
      .on(t.item_id, t.canal)
      .where(sql`${t.is_deleted} = false`),
    // Chave de idempotencia do webhook do canal. NULL nao colide no Postgres,
    // entao anuncio ainda nao publicado (id_externo nulo) nao atrapalha.
    idExternoIdx: uniqueIndex("idx_anuncios_id_externo")
      .on(t.canal, t.id_externo)
      .where(sql`${t.is_deleted} = false`),
    itemIdx: index("idx_anuncios_item").on(t.item_id),
    naoDeletadosIdx: index("idx_anuncios_ativos").on(t.is_deleted),
  })
);

export type Anuncio = typeof anuncios.$inferSelect;
export type NovoAnuncio = typeof anuncios.$inferInsert;
