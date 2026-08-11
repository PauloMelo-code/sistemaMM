/**
 * Tabelas do Better Auth — `user`, `session`, `account` e `verification`.
 *
 * SUBSTITUEM `usuarios` e `usuarios_sessoes`. Decisao do Paulo em 2026-08-11:
 * usar o desenho padrao da biblioteca em vez de mapear sobre as tabelas
 * existentes. As 13 FKs de `modified_by` passam a apontar para `user.id`.
 *
 * ---------------------------------------------------------------------------
 * DUAS COISAS QUE FOGEM DO PADRAO DA CASA, DE PROPOSITO E COM O PORQUE:
 *
 * 1. **Nome de tabela nao-hierarquico e, em `user`, PALAVRA RESERVADA do
 *    Postgres.** `SELECT ... FROM user` sem aspas nao e a nossa tabela — e o
 *    usuario da sessao. O Drizzle sempre cita identificador, entao o codigo da
 *    aplicacao esta seguro; **SQL cru escrito a mao precisa de `"user"` com
 *    aspas**. Vale para `scripts/db/*.sql` e para qualquer `db.execute`.
 *
 * 2. **`modified_by` NAO existe aqui.** O CLAUDE.md pede a coluna em toda
 *    tabela, mas quem escreve nestas quatro e a biblioteca, e ela nao conhece o
 *    campo: a coluna nasceria sempre nula ou sempre com o mesmo valor. Coluna de
 *    auditoria que ninguem alimenta e pior que coluna ausente — parece trilha e
 *    nao e. Ver o registro em docs/known-issues.md.
 *
 * As quatro colunas de auditoria (`created_at`, `updated_at`, `deleted_at`,
 * `is_deleted`) EXISTEM. As duas primeiras a propria biblioteca mantem; as duas
 * ultimas sao nossas e sao de verdade — `lerSessao` filtra por elas, entao
 * exclusao logica de usuario derruba o acesso na requisicao seguinte.
 * ---------------------------------------------------------------------------
 *
 * NOME EM JS x NOME EM SQL: o adaptador do Better Auth casa pelo nome da
 * PROPRIEDADE (`emailVerified`), o resto da base usa `snake_case` no SQL
 * (`email_verified`). Os dois convivem porque `pgTable` separa uma coisa da
 * outra. Nao "uniformize" um dos lados: mudar a propriedade quebra a
 * biblioteca, mudar a coluna quebra a migracao.
 */
import { sql } from "drizzle-orm";
import { pgTable, pgEnum, uuid, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Papeis do painel. Vive aqui porque `user` passou a ser a fonte da identidade;
 * `usuarios.ts` (tabela aposentada) importa daqui.
 *
 * administrador = Anderson (ve tudo) | operador = sem custo (RN-107) |
 * consultoria = Orbital
 */
export const papelUsuarioEnum = pgEnum("papel_usuario", [
  "administrador",
  "operador",
  "consultoria",
]);

export const user = pgTable(
  "user",
  {
    // `uuid` e nao `text`: as 13 FKs de `modified_by` ja sao uuid. Mantendo o
    // tipo, a migracao troca o ALVO da FK e nao o tipo da coluna em 11 tabelas.
    // O Better Auth gera o valor com `generateId: "uuid"` (ver auth/config.ts).
    id: uuid("id").primaryKey().defaultRandom(),

    // --- nucleo do Better Auth ---
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),

    // --- nossos campos (additionalFields em auth/config.ts) ---
    /**
     * RN-107 mora aqui. `input: false` no config: o papel NUNCA vem do
     * formulario — quem se cadastrasse escolheria o proprio nivel de acesso.
     */
    papel: papelUsuarioEnum("papel").notNull().default("operador"),
    /**
     * Desligar alguem sem apagar. Conferido a cada requisicao, entao o efeito e
     * na proxima — que e o motivo de a sessao ser tabela e nao JWT.
     */
    ativo: boolean("ativo").notNull().default(true),

    // --- colunas de auditoria OBRIGATORIAS ---
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => ({
    // Unico so entre os NAO deletados, e sobre lower(email). Sem o lower(),
    // "Anderson@mm.com.br" e "anderson@mm.com.br" viram DUAS contas ativas da
    // mesma pessoa — cada uma podendo ter papel diferente, o que fura a RN-107.
    // Sem o parcial, o e-mail de um usuario excluido ficaria preso para sempre.
    emailAtivoIdx: uniqueIndex("idx_user_email_ativo")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.is_deleted} = false`),
  }),
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      // RESTRICT e nao CASCADE: apagar usuario nao pode varrer o rastro dele.
      // Como todo delete nosso e logico, na pratica nada aqui e removido.
      .references(() => user.id, { onDelete: "restrict" }),

    /**
     * ⚠️ O TOKEN AQUI FICA EM CLARO — e isto e uma PERDA em relacao ao que
     * existia. `usuarios_sessoes.token_hash` guardava SHA-256, entao um dump
     * vazado nao virava sessao ativa. O Better Auth precisa do valor original
     * para casar o cookie, e o esquema dele nao preve hash.
     *
     * Consequencia pratica: quem obtiver um dump do banco entra como qualquer
     * usuario logado ate a sessao expirar (12h). A mitigacao possivel e
     * operacional, nao de codigo — restringir quem le o banco e onde o dump
     * fica. Registrado em docs/known-issues.md.
     */
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => ({
    // O caminho de TODA requisicao autenticada.
    tokenIdx: uniqueIndex("idx_session_token").on(t.token),
    // Encerrar todas as sessoes de alguem (desligamento, troca de senha).
    usuarioIdx: index("idx_session_usuario").on(t.userId),
    // Limpeza das vencidas.
    expiraIdx: index("idx_session_expira").on(t.expiresAt),
  }),
);

/**
 * Credenciais. E AQUI que a senha mora — nao em `user`.
 *
 * Para login por senha o Better Auth grava uma linha com
 * `providerId = "credential"` e o hash em `password`. A mesma tabela serve
 * login social no futuro (uma linha por provedor), que e a razao de o desenho
 * separar identidade de credencial.
 */
export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),

    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),

    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    idToken: text("id_token"),
    /** Hash da senha (scrypt do Better Auth). Nulo em conta social. */
    password: text("password"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => ({
    // Uma conta por (provedor, id no provedor). Sem isto, reautorizar o mesmo
    // provedor criaria linha nova a cada vez.
    provedorIdx: uniqueIndex("idx_account_provedor")
      .on(t.providerId, t.accountId)
      .where(sql`${t.is_deleted} = false`),
    usuarioIdx: index("idx_account_usuario").on(t.userId),
  }),
);

/**
 * Tokens de uso unico (verificacao de e-mail, redefinicao de senha).
 *
 * Nasce vazia e assim continua enquanto nao houver servico de e-mail — que e
 * decisao ainda aberta. A tabela existe porque o Better Auth a exige no schema.
 */
export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => ({
    identificadorIdx: index("idx_verification_identificador").on(t.identifier),
    expiraIdx: index("idx_verification_expira").on(t.expiresAt),
  }),
);

export type Usuario = typeof user.$inferSelect;
export type NovoUsuario = typeof user.$inferInsert;
export type Sessao = typeof session.$inferSelect;
