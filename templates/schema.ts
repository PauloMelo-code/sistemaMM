/**
 * TEMPLATE-OURO: Schema de tabela Drizzle.
 *
 * Copie este arquivo para src/lib/db/schema/<entidade>.ts e ajuste.
 * Toda tabela DEVE ter as 5 colunas de auditoria do bloco no fim.
 * Rode `node scripts/check-compliance.mjs` apos criar — deve passar limpo.
 */
import { pgTable, uuid, text, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Exemplo hierarquico: contratos -> contratos_lancamentos
import { contratos } from "./contratos";

export const contratosLancamentos = pgTable(
  "contratos_lancamentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    contrato_id: uuid("contrato_id")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => contratos.id, { onDelete: "restrict" }),
    descricao: text("descricao").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    modified_by: uuid("modified_by").notNull(),
  },
  (t) => ({
    contratoIdx: index("idx_lancamentos_contrato").on(t.contrato_id),
    naoDeletadosIdx: index("idx_lancamentos_ativos").on(t.is_deleted),
  })
);

export type ContratoLancamento = typeof contratosLancamentos.$inferSelect;
export type NovoContratoLancamento = typeof contratosLancamentos.$inferInsert;
