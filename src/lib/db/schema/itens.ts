/**
 * Itens de estoque (tela Estoque). Cada item pertence a um lote arrematado.
 *
 * `custo` e custo de arremate: dado sensivel, NAO exibir para o papel operador
 * (RN-107) — filtrar no servidor, o campo nao pode chegar ao cliente.
 *
 * `situacao` muda para "vendido" quando o item vende em qualquer canal; a mesma
 * acao pausa os anuncios dos demais canais e tira o item do site (RN-104).
 */
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, numeric, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

import { lotes } from "./lotes";
import { user } from "./auth";

export const situacaoItemEnum = pgEnum("situacao_item", [
  "anunciado",
  "sem_anuncio",
  "reservado",
  "pausado",
  "vendido",
]);

export const itens = pgTable(
  "itens",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    // Padrao de geracao do SKU ainda nao definido (docs/known-issues.md):
    // texto, sem check constraint. Nao inventar formato.
    // UNIQUE PARCIAL (ver indice abaixo): item logicamente excluido libera o
    // SKU. Um unique global prenderia o codigo para sempre num cadastro errado.
    sku: text("sku").notNull(),
    nome: text("nome").notNull(),
    lote_id: uuid("lote_id")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => lotes.id, { onDelete: "restrict" }),
    segmento: text("segmento").notNull(),
    custo: numeric("custo", { precision: 14, scale: 2 }).notNull(),
    // Nulo enquanto o item nao foi precificado (chega no lote sem preco alvo).
    // Quando definido, sai da formula unica de pricing.ts (RN-100).
    preco_alvo: numeric("preco_alvo", { precision: 14, scale: 2 }),
    // Endereco no galpao (ex.: "A · 2"). Nulo ate ser enderecado.
    local_galpao: text("local_galpao"),
    situacao: situacaoItemEnum("situacao").notNull().default("sem_anuncio"),
    /**
     * Toggle "Exibir no site" da tela Site/CMS. Nasce DESLIGADO: item entra no
     * estoque antes de ter foto e descricao, e o site nao pode publicar sozinho
     * o que ninguem revisou.
     *
     * Metade da RN-109 — a outra e ter foto (`itens_fotos`). As duas valem
     * juntas: ligar o toggle num item sem foto nao publica nada.
     */
    exibir_no_site: boolean("exibir_no_site").notNull().default(false),

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
    // Unico so entre os NAO deletados — ver comentario na coluna sku.
    skuAtivoIdx: uniqueIndex("idx_itens_sku_ativo")
      .on(t.sku)
      .where(sql`${t.is_deleted} = false`),
    loteIdx: index("idx_itens_lote").on(t.lote_id),
    naoDeletadosIdx: index("idx_itens_ativos").on(t.is_deleted),
  })
);

export type Item = typeof itens.$inferSelect;
export type NovoItem = typeof itens.$inferInsert;
