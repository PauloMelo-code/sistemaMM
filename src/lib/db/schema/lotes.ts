/**
 * Lotes arrematados em leilao. Um lote agrupa os itens de um arremate.
 *
 * `custo_total` e custo de arremate: dado sensivel, NAO exibir para o papel
 * operador (RN-107) — filtrar no servidor.
 */
import { pgTable, uuid, text, numeric, boolean, timestamp, date, index } from "drizzle-orm/pg-core";

import { usuarios } from "./usuarios";

export const lotes = pgTable(
  "lotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    nome: text("nome").notNull(),
    // Oftalmologia, Encadernacao, Baterias, Automotivo — texto livre:
    // o conjunto de segmentos ainda pode crescer a cada leilao.
    segmento: text("segmento").notNull(),
    // `date` (sem hora) — data do arremate nao tem horario e nao sofre
    // deslocamento de fuso.
    data_arremate: date("data_arremate").notNull(),
    custo_total: numeric("custo_total", { precision: 14, scale: 2 }).notNull(),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    modified_by: uuid("modified_by")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict" }),
  },
  (t) => ({
    naoDeletadosIdx: index("idx_lotes_ativos").on(t.is_deleted),
  })
);

export type Lote = typeof lotes.$inferSelect;
export type NovoLote = typeof lotes.$inferInsert;
