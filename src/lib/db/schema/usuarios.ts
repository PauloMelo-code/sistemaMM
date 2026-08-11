/**
 * ⚠️ TABELA APOSENTADA — nao use em codigo novo.
 *
 * A identidade migrou para `user` (Better Auth) em 2026-08-11; ver
 * `./auth.ts`. As 11 FKs de `modified_by` que apontavam para ca agora apontam
 * para `user.id`.
 *
 * POR QUE ELA CONTINUA AQUI, em vez de ser apagada: a regra absoluta da casa
 * proibe DROP de estrutura de dados, e o `check-compliance` barra `DROP TABLE`
 * em SQL. A tabela fica vazia e sem referencia — custo zero — e some no dia em
 * que houver uma decisao consciente de limpeza de schema, com backup na mao.
 *
 * A UNICA linha que existia aqui em banco novo era o usuario-sistema das
 * integracoes (migracao 0004, uuid fixo `...0001`, `ativo = false`). A migracao
 * de corte recria essa linha em `user`, com o MESMO uuid — as escritas de
 * webhook e job continuam assinando com o id que ja usavam.
 *
 * RN-107 continua valendo, so que a partir de `user.papel`.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// Fonte do enum passou a ser ./auth (onde vive a tabela que manda hoje).
// Importado e nao redeclarado: duas declaracoes do mesmo pgEnum fariam o
// drizzle emitir dois CREATE TYPE para o mesmo nome.
import { papelUsuarioEnum } from "./auth";

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

    /**
     * Hash da senha (scrypt, ver `src/lib/auth/senha.ts`).
     *
     * NULLABLE de proposito, e isso e uma protecao: usuario sem senha NAO
     * consegue entrar. E o que mantem o usuario-sistema das integracoes
     * permanentemente impossibilitado de logar, e o que permite cadastrar uma
     * pessoa antes de definir a credencial dela.
     */
    senha_hash: text("senha_hash"),

    /**
     * Tentativas de login malsucedidas desde o ultimo acerto.
     *
     * Contado no BANCO e nao em memoria: contador em memoria zera a cada deploy
     * e nao existe entre instancias — ou seja, some justamente quando ha mais de
     * um alvo para tentar.
     */
    tentativas_falhas: integer("tentativas_falhas").notNull().default(0),
    /** Ate quando o login esta bloqueado. Nulo = liberado. */
    bloqueado_ate: timestamp("bloqueado_ate"),

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

// Os tipos `Usuario` / `NovoUsuario` saem daqui e passam a vir de `./auth`.
// Nao e so higiene: o barril (`index.ts`) usa `export *`, entao os dois
// arquivos exportando o mesmo nome deixaria ambiguo qual tabela o tipo
// descreve — e a errada e a aposentada.
