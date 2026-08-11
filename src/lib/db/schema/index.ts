/**
 * Barril do schema Drizzle — usado pelo drizzle.config.ts e pelo client.
 * Toda tabela nova entra aqui, senao nao vira migracao.
 *
 * Ordem = dependencia de FK: lotes -> itens -> anuncios/perguntas/pedidos.
 */
export * from "./usuarios";
export * from "./lotes";
export * from "./itens";
export * from "./anuncios";
export * from "./perguntas";
export * from "./pedidos";
export * from "./auditoria";
export * from "./integracoes-eventos";
