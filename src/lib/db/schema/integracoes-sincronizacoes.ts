/**
 * Marca d'agua da reconciliacao — ate onde ja conferimos cada canal.
 *
 * O PROBLEMA QUE ISTO RESOLVE: nenhum marketplace garante 100% de entrega de
 * notificacao. Se uma venda se perder, o sistema **nao sabe que nao soube** — o
 * item segue anunciado, segue no site, e a descoberta vem quando o segundo
 * comprador paga. Idempotencia nao pega isso: nao da para ser idempotente sobre
 * um evento que nunca chegou.
 *
 * A marca d'agua responde "conferimos ate quando", e `ultimo_sucesso_em`
 * responde "ha quanto tempo nao conseguimos conferir" — que e o alarme de
 * obsolescencia, e o estado de erro que a tela Integracoes hoje nao tem.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, jsonb, boolean, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { canalEnum } from "./anuncios"; // enum de canal compartilhado

export const integracoesSincronizacoes = pgTable(
  "integracoes_sincronizacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    canal: canalEnum("canal").notNull(),
    /** O que foi conferido: "pedidos", "anuncios"... Vocabulario NOSSO. */
    recurso: text("recurso").notNull(),

    /**
     * Ate qual instante ja conferimos. A proxima passada comeca daqui.
     *
     * Nulo na primeira execucao — e ai a varredura vai ate onde o limite de
     * paginas alcancar, sem tentar reconstruir o historico inteiro.
     */
    ate_qual_instante: timestamp("ate_qual_instante"),

    /**
     * Quando a ultima passada terminou BEM.
     *
     * Separado de `updated_at` de proposito: a linha e tocada tambem quando a
     * passada falha (para gravar o erro), e ai `updated_at` diria que esta tudo
     * recente. O alarme de obsolescencia olha ESTA coluna — passou X minutos
     * sem sucesso, o card fica vermelho.
     */
    ultimo_sucesso_em: timestamp("ultimo_sucesso_em"),

    /** Resumo da ultima passada (achados, divergencias, erro). */
    resultado: jsonb("resultado"),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    modified_by: uuid("modified_by")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => user.id, { onDelete: "restrict" }),
  },
  (t) => ({
    /**
     * UMA marca d'agua por (canal, recurso). Duas linhas para o mesmo par
     * fariam a reconciliacao ler uma e gravar na outra, andando para tras em
     * silencio — e uma marca d'agua que retrocede reprocessa sempre o mesmo
     * periodo e nunca alcanca o presente.
     */
    canalRecursoIdx: uniqueIndex("idx_integracoes_sincronizacoes_canal_recurso")
      .on(t.canal, t.recurso)
      .where(sql`${t.is_deleted} = false`),
  })
);

export type IntegracaoSincronizacao = typeof integracoesSincronizacoes.$inferSelect;
