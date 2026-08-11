/**
 * Credencial OAuth de cada canal — onde o token do Mercado Livre mora.
 *
 * POR QUE TABELA E NAO VARIAVEL DE AMBIENTE: o access token do ML vive ~6h e o
 * refresh devolve um novo a cada uso. Valor que rotaciona sozinho nao cabe em
 * `.env` — trocar exigiria redeploy a cada seis horas.
 *
 * OS TOKENS SAO CIFRADOS (AES-256-GCM, ver `src/lib/integracoes/cofre.ts`).
 * Quem le este registro publica e despublica anuncio na conta do cliente, e
 * responde pergunta em nome dele. Um dump de banco vazado sem cifragem entrega
 * a operacao inteira; cifrado, entrega texto inutil sem a `CREDENCIAIS_KEY`.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

import { usuarios } from "./usuarios";
import { canalEnum } from "./anuncios"; // enum de canal compartilhado

export const integracoesCredenciais = pgTable(
  "integracoes_credenciais",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    canal: canalEnum("canal").notNull(),
    /** `user_id` do vendedor no canal. Serve para descartar evento de outra conta. */
    conta_externa_id: text("conta_externa_id"),
    /** CIFRADO. Nunca ler direto — passar por `decifrar()`. */
    access_token: text("access_token").notNull(),
    /**
     * CIFRADO. **De uso unico no ML**: cada refresh invalida este valor e
     * devolve outro. Por isso a troca acontece sob advisory lock — dois
     * refreshes concorrentes quebram a integracao de forma irrecuperavel por
     * codigo (alguem precisa reautorizar no navegador).
     */
    refresh_token: text("refresh_token").notNull(),
    expira_em: timestamp("expira_em").notNull(),
    escopo: text("escopo"),
    /** Quando o token foi trocado pela ultima vez. Alimenta o alarme de obsolescencia. */
    renovado_em: timestamp("renovado_em"),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    modified_by: uuid("modified_by")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => usuarios.id, { onDelete: "restrict" }),
  },
  (t) => ({
    /**
     * UMA credencial ativa por canal. O sistema e single-tenant (uma empresa,
     * uma conta por marketplace) e o cliente precisa saber qual token usar sem
     * escolher entre dois. Se um dia houver multiplas contas por canal, este
     * indice vira `(canal, conta_externa_id)` e o cliente passa a receber qual
     * conta usar — mudanca consciente, nao acidente.
     *
     * Parcial em `is_deleted`: desconectar um canal (exclusao logica) precisa
     * liberar o slot para reconectar depois.
     */
    canalAtivoIdx: uniqueIndex("idx_integracoes_credenciais_canal_ativo")
      .on(t.canal)
      .where(sql`${t.is_deleted} = false`),
    /** Caminho do job de renovacao proativa: quem vence primeiro. */
    expiraIdx: index("idx_integracoes_credenciais_expira")
      .on(t.expira_em)
      .where(sql`${t.is_deleted} = false`),
  })
);

export type IntegracaoCredencial = typeof integracoesCredenciais.$inferSelect;
export type NovaIntegracaoCredencial = typeof integracoesCredenciais.$inferInsert;
