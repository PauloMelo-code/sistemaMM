/**
 * Anuncios da conta do Mercado Livre, como estao no ML (RN-123).
 *
 * E uma FOTOGRAFIA, nao o Estoque: o ML nao sabe de lote nem de custo de
 * arremate, e item sem custo quebra a RN-121. Por isso o que vem do ML mora aqui
 * ate alguem vincular a um item (`item_id`, etapa 2).
 *
 * Vocabulario do ML de proposito (`status` = active/paused/closed/...): e copia
 * do que a API disse. Traduzir aqui esconderia estados que o nosso enum de
 * `anuncios` nao tem — `closed` e `under_review`, por exemplo.
 *
 * Reimportar atualiza a mesma linha pelo `id_externo`; nunca duplica.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, numeric, integer, jsonb, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

import { itens } from "./itens";
import { user } from "./auth";

/** Uma foto como o ML devolve: o id dele e a URL https. */
export interface FotoML {
  id: string;
  url: string;
}

export const integracoesMlAnuncios = pgTable(
  "integracoes_ml_anuncios",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    /** `MLB...` — a chave do anuncio no ML. */
    id_externo: text("id_externo").notNull(),
    titulo: text("titulo").notNull(),
    /** So existe em anuncio do modelo User Products (docs/ml-api-notas.md §1). */
    family_name: text("family_name"),
    /** Atributo `SELLER_SKU` — o jeito oficial de mandar SKU. */
    sku: text("sku"),
    /**
     * `seller_custom_field`. A doc diz que nao tem relacao com o `SELLER_SKU`,
     * mas anuncio antigo desta conta pode ter o SKU so aqui — por isso guardado.
     */
    campo_vendedor: text("campo_vendedor"),
    status: text("status").notNull(),
    preco: numeric("preco", { precision: 14, scale: 2 }).notNull(),
    moeda: text("moeda").notNull(),
    qtd_disponivel: integer("qtd_disponivel").notNull(),
    qtd_vendida: integer("qtd_vendida").notNull(),
    categoria_id: text("categoria_id").notNull(),
    /** `gold_special` (Classico) ou `gold_pro` (Premium) no MLB. */
    tipo_anuncio: text("tipo_anuncio").notNull(),
    condicao: text("condicao"),
    permalink: text("permalink"),
    /** Links das fotos no ML, na ordem do anuncio. Copiadas so no vinculo. */
    fotos: jsonb("fotos").$type<FotoML[]>().notNull().default(sql`'[]'::jsonb`),
    /** Texto puro da descricao. Nulo quando o anuncio nao tem. */
    descricao: text("descricao"),
    criado_no_ml: timestamp("criado_no_ml"),
    atualizado_no_ml: timestamp("atualizado_no_ml"),
    /** Quando esta linha foi conferida contra o ML pela ultima vez. */
    sincronizado_em: timestamp("sincronizado_em").notNull(),

    /** Item do Estoque que este anuncio representa. Nulo ate o vinculo. */
    item_id: uuid("item_id")
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => itens.id, { onDelete: "restrict" }),

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
    /** Chave do upsert da importacao: um anuncio do ML, uma linha ativa. */
    idExternoIdx: uniqueIndex("idx_integracoes_ml_anuncios_id_externo")
      .on(t.id_externo)
      .where(sql`${t.is_deleted} = false`),
    /** Busca e deteccao de SKU duplicado. Sem unico: o duplicado E o achado. */
    skuIdx: index("idx_integracoes_ml_anuncios_sku").on(t.sku),
    itemIdx: index("idx_integracoes_ml_anuncios_item").on(t.item_id),
    naoDeletadosIdx: index("idx_integracoes_ml_anuncios_ativos").on(t.is_deleted),
  })
);

export type IntegracaoMlAnuncio = typeof integracoesMlAnuncios.$inferSelect;
export type NovaIntegracaoMlAnuncio = typeof integracoesMlAnuncios.$inferInsert;
