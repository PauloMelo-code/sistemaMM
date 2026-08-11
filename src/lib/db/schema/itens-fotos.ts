/**
 * Fotos de cada item (tela Site/CMS e vitrine do site publico).
 *
 * Os BYTES vivem no MinIO; aqui fica so o ponteiro (`objeto`) mais o que a tela
 * precisa saber sem ir buscar o arquivo. Guardar imagem em coluna de banco
 * inchava o dump, o backup e toda consulta que nem queria a foto.
 *
 * RN-109: item so aparece no site publico se tiver foto E com o toggle
 * `itens.exibir_no_site` ligado. Esta tabela e a metade "tiver foto" da regra.
 *
 * `largura`/`altura` sao lidos do cabecalho no upload (`src/lib/storage/imagem.ts`)
 * e servem a dois donos: o Mercado Livre degrada imagem pequena, e o site precisa
 * reservar o espaco do `<img>` para a pagina nao pular quando a foto carrega.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

import { itens } from "./itens";
import { usuarios } from "./usuarios";

export const itensFotos = pgTable(
  "itens_fotos",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    item_id: uuid("item_id")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => itens.id, { onDelete: "restrict" }),
    /**
     * Caminho dentro do bucket: `itens/<item_id>/<uuid>.<ext>`. Montado pelo
     * servidor (`gerarChave`), nunca a partir do nome enviado pelo cliente.
     * A URL publica e derivada dele em `urlPublica()` — guardar a URL inteira
     * prenderia o dominio do MinIO em cada linha, e trocar de dominio viraria
     * UPDATE em toda a tabela.
     */
    objeto: text("objeto").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    largura: integer("largura").notNull(),
    altura: integer("altura").notNull(),
    /** A foto do card e do anuncio. Uma por item — garantido pelo indice abaixo. */
    principal: boolean("principal").notNull().default(false),
    /** Ordem de exibicao na galeria. Sem unico: reordenar em lote nao pode colidir. */
    ordem: integer("ordem").notNull().default(0),
    /** Texto alternativo (acessibilidade e SEO do site). Nulo ate alguem escrever. */
    alt: text("alt"),

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
     * UMA principal por item. E constraint de negocio, nao capricho: o card do
     * site, a miniatura do painel e a foto de capa do anuncio leem "a principal"
     * — com duas, cada tela escolhe uma diferente e ninguem entende por que.
     *
     * Parcial em `principal` E `is_deleted`: excluir a foto de capa precisa
     * liberar o posto para a proxima assumir.
     */
    principalIdx: uniqueIndex("idx_itens_fotos_principal")
      .on(t.item_id)
      .where(sql`${t.principal} = true AND ${t.is_deleted} = false`),

    /**
     * GLOBAL, sem `WHERE` — de proposito, e diferente da maioria dos unicos
     * desta base. A exclusao de foto e logica e o objeto CONTINUA no bucket;
     * liberar a chave deixaria um upload novo sobrescrever o arquivo de uma foto
     * "excluida" que ainda pode ser restaurada. Mesma logica de
     * `idx_pedidos_canal_numero`.
     */
    objetoIdx: uniqueIndex("idx_itens_fotos_objeto").on(t.objeto),

    /** Caminho da galeria: todas as fotos ativas de um item, ja ordenadas. */
    itemIdx: index("idx_itens_fotos_item")
      .on(t.item_id, t.ordem)
      .where(sql`${t.is_deleted} = false`),
  })
);

export type ItemFoto = typeof itensFotos.$inferSelect;
export type NovaItemFoto = typeof itensFotos.$inferInsert;
