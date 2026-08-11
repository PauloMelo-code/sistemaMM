/**
 * Usuarios do painel MM Solucoes.
 *
 * RN-107 — O papel `operador` NAO pode ver custo.
 * Isso vale para: custo de arremate (itens.custo), custo do lote
 * (lotes.custo_total), margem e lucro (pricing.ts).
 * O filtro e feito NO SERVIDOR: o campo nao pode chegar ao cliente.
 * Esconder por CSS nao conta. Ver docs/regras-negocio.md (RN-107).
 */
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// administrador = Anderson (ve tudo) | operador = sem custo (RN-107) | consultoria = Orbital
export const papelUsuarioEnum = pgEnum("papel_usuario", [
  "administrador",
  "operador",
  "consultoria",
]);

export const usuarios = pgTable(
  "usuarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    nome: text("nome").notNull(),
    // UNIQUE PARCIAL (ver indice abaixo), nao `.unique()` global: com soft
    // delete, um unique global manteria o e-mail preso para sempre depois de
    // excluir o usuario — recadastrar a mesma pessoa estouraria 23505.
    email: text("email").notNull(),
    papel: papelUsuarioEnum("papel").notNull(),
    ativo: boolean("ativo").notNull().default(true),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    // UNICA tabela sem FK em modified_by: seria auto-referencia e o PRIMEIRO
    // usuario nao teria quem apontar (bootstrap chicken-and-egg). As outras 5
    // tabelas referenciam usuarios.id. Ver docs/known-issues.md.
    modified_by: uuid("modified_by").notNull(),
  },
  (t) => ({
    // Unico so entre os NAO deletados, e sobre lower(email): o Postgres compara
    // texto case-sensitive, entao sem o lower() "Anderson@mm.com.br" e
    // "anderson@mm.com.br" viram DUAS contas ativas da mesma pessoa — cada uma
    // podendo ter papel diferente, o que fura o sigilo de custo da RN-107.
    // Normalize o e-mail na escrita tambem; nao dependa so do indice.
    emailAtivoIdx: uniqueIndex("idx_usuarios_email_ativo")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.is_deleted} = false`),
    naoDeletadosIdx: index("idx_usuarios_ativos").on(t.is_deleted),
  })
);

export type Usuario = typeof usuarios.$inferSelect;
export type NovoUsuario = typeof usuarios.$inferInsert;
