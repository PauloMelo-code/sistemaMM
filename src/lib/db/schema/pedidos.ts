/**
 * Pedidos de venda (tela Pedidos) e o fluxo de despacho (tela Expedicao).
 *
 * Dinheiro sempre em numeric(14,2) — nunca float.
 * `valor`, `taxa`, `comissao` e `liquido` sao o VALOR REALIZADO da venda,
 * gravado no fechamento do pedido. Nao recalcular na tela: a formula de
 * sugestao de preco vive em pricing.ts (RN-100) e responde outra pergunta.
 *
 * RN-102: taxa por canal (ML 14%, OLX 5%, direta 0%) + comissao de 4%.
 * RN-108: a base da comissao (bruto x liquido de taxas) ainda NAO foi
 * confirmada pelo Anderson — por isso `comissao` e gravada, nao derivada.
 *
 * RN-106: alerta de despacho a 24h do limite (fora do escopo desta tabela).
 */
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, numeric, integer, boolean, timestamp, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";

import { itens } from "./itens";
import { user } from "./auth";
import { canalEnum } from "./anuncios"; // enum de canal compartilhado (um tipo so no Postgres)

// Stepper da tela Expedicao. O 1o estado e "aguardando_nfe", NAO "nfe_emitida":
// o pedido nasce com a NF-e por emitir. Chamar o estado inicial de "nfe_emitida"
// faria todo pedido novo afirmar, ao mesmo tempo, que a nota nao foi emitida
// (nfe_emitida = false) e que a etapa corrente e "NF-e emitida" — duas fontes de
// verdade contraditorias para um fato FISCAL.
export const etapaExpedicaoEnum = pgEnum("etapa_expedicao", [
  "aguardando_nfe",
  "etiqueta",
  "embalado",
  "coletado",
]);

// "cancelado" NAO e enfeite: e o que permite devolver o item ao estoque sem
// recorrer a exclusao logica. Cancelamento nao e exclusao — o pedido existiu,
// gerou taxa e talvez NF-e, e precisa continuar no relatorio.
// E e ele que libera o item para ser revendido (ver indice de item ativo).
export const statusPedidoEnum = pgEnum("status_pedido", [
  "aguardando_envio",
  "em_transporte",
  "concluido",
  "cancelado",
]);

export const pedidos = pgTable(
  "pedidos",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // --- colunas de dominio ---
    // Numero do pedido no canal de origem. A chave natural e (canal, numero),
    // nao `numero` sozinho: nada garante que ML e OLX nao repitam numeracao.
    // E ela que sustenta a IDEMPOTENCIA do webhook de venda (RN-104) —
    // reprocessar o mesmo evento tem que colidir aqui, nao criar 2o pedido.
    // Ver indice unico parcial abaixo.
    numero: text("numero").notNull(),
    item_id: uuid("item_id")
      .notNull()
      // FK com RESTRICT — NUNCA cascade em dado critico
      .references(() => itens.id, { onDelete: "restrict" }),
    canal: canalEnum("canal").notNull(),

    // QUANDO a venda aconteceu NO CANAL — nao quando alguem digitou aqui.
    // Sem esta coluna o mes fecharia por `created_at`, entao venda de marco
    // lancada em abril cairia no mes errado, levando junto a comissao (RN-108)
    // e o relatorio por canal.
    // NOT NULL e SEM default de propositos: `defaultNow()` reintroduziria o bug
    // em silencio (voltaria a ser a hora da digitacao). Quem grava informa:
    // ML e OLX trazem no payload; venda direta e o operador quem data.
    vendido_em: timestamp("vendido_em").notNull(),

    // CUSTO CONGELADO no momento da venda (copia de `itens.custo`).
    // `itens.custo` continua editavel — corrigir um rateio de lote hoje NAO
    // pode reescrever a margem de um mes ja fechado. Sem este snapshot, o
    // relatorio muda sozinho e ninguem sabe explicar por que.
    // Nunca derive a margem historica de `itens.custo`: use esta coluna.
    // Completude depende do rateio lote -> item (ver known-issues).
    custo_na_venda: numeric("custo_na_venda", { precision: 14, scale: 2 }).notNull(),
    /**
     * Unidades vendidas neste pedido (ADR-0002). `custo_na_venda` ja e o custo
     * do pedido inteiro (unitario x quantidade, `custoNaVenda` em pricing.ts).
     */
    quantidade: integer("quantidade").notNull().default(1),

    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
    taxa: numeric("taxa", { precision: 14, scale: 2 }).notNull(),
    comissao: numeric("comissao", { precision: 14, scale: 2 }).notNull(),
    // Frete de SAIDA efetivamente pago pela MM nesta venda (RN-100).
    // No Mercado Livre, item acima de R$ 79 entra em frete gratis e o ML
    // DESCONTA a etiqueta do repasse: e dinheiro que sai, nao estimativa.
    // Em equipamento pesado sao centenas de reais por venda — sem esta coluna,
    // o `liquido` do painel nao bate com o extrato do canal.
    // Zero quando o comprador paga o envio (retirada em maos, combinado direto).
    // Este e o valor REALIZADO; o estimado que entrou no preco vive no calculo
    // de `pricing.ts`, nao aqui.
    frete_saida: numeric("frete_saida", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    // liquido = valor - taxa - comissao - frete_saida.
    // Gravado, nao derivado: e o que o canal efetivamente repassou. Se nao
    // fechar na subtracao, ha deducao que o sistema nao conhece — sinalizar na
    // tela, nao "ajustar" o numero (ver known-issues).
    liquido: numeric("liquido", { precision: 14, scale: 2 }).notNull(),
    // A taxa que o CANAL informou, ao lado da que NOS calculamos em `taxa`.
    // Duas colunas de proposito: `taxa` sai da RN-102 (14% no ML, nao
    // confirmados) e esta sai do payload do pedido. Enquanto forem so uma, uma
    // divergencia entre o painel e o extrato do ML e indistinguivel de acerto.
    // Nula quando o canal nao informa (venda direta) ou quando a venda foi
    // lancada a mao.
    taxa_origem: numeric("taxa_origem", { precision: 14, scale: 2 }),

    // Quando alguem (ou o job de reconciliacao) confirmou que os nossos numeros
    // batem com o que o canal repassou.
    //
    // NULO E O ESTADO NORMAL de um pedido recem-criado por integracao: os
    // valores foram calculados com a taxa que SUPOMOS e com a base de comissao
    // ainda nao confirmada pelo Anderson (RN-108 🔴). Deixar nulo transforma
    // essa incerteza em estado visivel na tela em vez de erro silencioso no
    // relatorio — o pedido entra como "a conferir", nao como verdade.
    conciliado_em: timestamp("conciliado_em"),

    nfe_emitida: boolean("nfe_emitida").notNull().default(false),
    // Chave de 44 digitos da NF-e. Emissor fiscal ainda nao definido
    // (docs/known-issues.md) — nulo ate a integracao existir.
    nfe_chave: text("nfe_chave"),
    etapa_expedicao: etapaExpedicaoEnum("etapa_expedicao").notNull().default("aguardando_nfe"),
    rastreio: text("rastreio"),
    status: statusPedidoEnum("status").notNull().default("aguardando_envio"),

    // --- colunas de auditoria OBRIGATORIAS (nunca omitir) ---
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
    deleted_at: timestamp("deleted_at"),
    is_deleted: boolean("is_deleted").notNull().default(false),
    modified_by: uuid("modified_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
  },
  (t) => ({
    // Chave natural do pedido — trava do webhook (RN-104).
    // GLOBAL de proposito, diferente dos unicos de email/sku: o numero e do
    // MARKETPLACE, nao nosso, e nunca deve ser reaproveitado. Se fosse parcial,
    // excluir um pedido logicamente liberaria a chave e o reprocessamento do
    // webhook criaria um SEGUNDO pedido para a mesma venda — o cenario exato
    // que a RN-104 existe para impedir.
    canalNumeroIdx: uniqueIndex("idx_pedidos_canal_numero").on(t.canal, t.numero),

    // ===================================================================
    // COMPRA SIMULTANEA — onde a trava mora agora (ADR-0002).
    //
    // Ate 2026-10-29 havia aqui `idx_pedidos_item_ativo`: um pedido ativo por
    // item, porque todo item era peca unica. Com `itens.quantidade`, um item
    // de 19 unidades tem 19 pedidos legitimos, e o indice recusaria o segundo.
    //
    // A garantia passou para `itens`: `CHECK (quantidade >= 0)`, com o handler
    // baixando a quantidade no MESMO commit do pedido. Duas vendas disputando a
    // ultima unidade levam a -1 e o banco recusa. Ver RN-112.
    // ===================================================================
    itemIdx: index("idx_pedidos_item").on(t.item_id),
    // Pedido de zero unidades nao e venda.
    quantidadePositiva: check("chk_pedidos_quantidade_positiva", sql`${t.quantidade} >= 1`),
    // Todo relatorio filtra e agrupa por periodo de VENDA (mes fechado,
    // comissao do dia 5, vendas por canal). E o acesso mais repetido da tabela.
    vendidoEmIdx: index("idx_pedidos_vendido_em").on(t.vendido_em),
    naoDeletadosIdx: index("idx_pedidos_ativos").on(t.is_deleted),
  })
);

export type Pedido = typeof pedidos.$inferSelect;
export type NovoPedido = typeof pedidos.$inferInsert;
