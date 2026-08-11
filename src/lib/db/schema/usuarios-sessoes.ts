/**
 * Sessoes de login.
 *
 * Sessao em TABELA, nao em JWT: com JWT nao da para derrubar acesso antes de
 * expirar — desligar o operador exigiria esperar o token vencer. Aqui, apagar a
 * linha (ou marcar o usuario como inativo) encerra na proxima requisicao. Num
 * sistema cuja regra central e sigilo de custo (RN-107), poder revogar na hora
 * vale mais que economizar uma consulta.
 *
 * O TOKEN E GUARDADO COMO HASH, nunca em claro: um dump de banco vazado nao pode
 * virar sessao ativa. Mesma logica das credenciais de canal.
 */
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

import { usuarios } from "./usuarios";

export const usuariosSessoes = pgTable(
  "usuarios_sessoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    user_id: uuid("user_id")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => usuarios.id, { onDelete: "restrict" }),
    /** SHA-256 do token que vai no cookie. O valor em claro so existe no browser. */
    token_hash: text("token_hash").notNull(),
    expira_em: timestamp("expira_em").notNull(),
    /** Ultima vez que a sessao foi usada. Alimenta "quem esta logado". */
    ultimo_acesso_em: timestamp("ultimo_acesso_em").notNull().defaultNow(),

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
    /**
     * O caminho de TODA requisicao autenticada: achar a sessao pelo hash do
     * token. Unico porque dois registros com o mesmo hash seriam a mesma sessao
     * duplicada — e a leitura teria que escolher uma.
     */
    tokenIdx: uniqueIndex("idx_usuarios_sessoes_token").on(t.token_hash),
    /** Encerrar todas as sessoes de alguem (desligamento, troca de senha). */
    usuarioIdx: index("idx_usuarios_sessoes_usuario")
      .on(t.user_id)
      .where(sql`${t.is_deleted} = false`),
    /** Limpeza das vencidas. */
    expiraIdx: index("idx_usuarios_sessoes_expira").on(t.expira_em),
  })
);

export type UsuarioSessao = typeof usuariosSessoes.$inferSelect;
