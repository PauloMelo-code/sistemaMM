/**
 * Trilha de auditoria (RN-002 e CLAUDE.md: "quem, o que, quando").
 *
 * TODA acao de criar, alterar ou excluir grava uma linha aqui. Nenhum CRUD do
 * sistema pode nascer sem escrever nesta tabela — e o que sustenta o Dashboard
 * Owner/Admin (registros deletados, volume de erro por usuario) e a defesa em
 * caso de "sumiu coisa".
 *
 * Formato definido em docs/back.md ("Tabela de Auditoria").
 *
 * ATENCAO — esta tabela e a UNICA excecao ao padrao de colunas de auditoria:
 * ela E o log. Um registro de auditoria nunca e alterado nem excluido (nem
 * logicamente), entao nao tem updated_at, deleted_at, is_deleted nem
 * modified_by. `user_id` ja responde "quem" e `created_at` responde "quando".
 * Se algum dia precisar apagar linha daqui, a resposta e nao.
 */
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

import { usuarios } from "./usuarios";

// compliance:append-only — excecao deliberada as colunas de auditoria.
// Esta tabela E a trilha: linha gravada nunca e alterada nem excluida, nem
// logicamente. Dar `is_deleted` a ela permitiria sumir com a propria prova.
// Formato conforme docs/back.md ("Tabela de Auditoria").
export const auditoria = pgTable(
  "auditoria",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Quem executou a acao. */
    user_id: uuid("user_id")
      .notNull()
      // FK com RESTRICT — usuario com trilha nao pode ser removido do banco
      .references(() => usuarios.id, { onDelete: "restrict" }),

    /** O que foi feito: "criar" | "atualizar" | "excluir". */
    acao: text("acao").notNull(),
    /** Tabela afetada (nome fisico, ex.: "pedidos"). */
    tabela: text("tabela").notNull(),
    /** Id do registro afetado. */
    registro_id: uuid("registro_id").notNull(),
    /** Descricao legivel: "alterou preco de X para Y". */
    detalhes: text("detalhes").notNull(),

    // Snapshots em JSON stringified. Nulos em criacao/exclusao, conforme o caso.
    dados_anteriores: text("dados_anteriores"),
    dados_novos: text("dados_novos"),

    /** Quando. Unica coluna temporal — o log nunca e atualizado. */
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // O dashboard filtra por registro, por usuario e por tabela.
    registroIdx: index("idx_auditoria_registro").on(t.tabela, t.registro_id),
    usuarioIdx: index("idx_auditoria_usuario").on(t.user_id),
    dataIdx: index("idx_auditoria_data").on(t.created_at),
  })
);

export type Auditoria = typeof auditoria.$inferSelect;
export type NovaAuditoria = typeof auditoria.$inferInsert;
