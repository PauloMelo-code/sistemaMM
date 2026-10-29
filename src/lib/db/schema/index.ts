/**
 * Barril do schema Drizzle — usado pelo drizzle.config.ts e pelo client.
 * Toda tabela nova entra aqui, senao nao vira migracao.
 *
 * Ordem = dependencia de FK: lotes -> itens -> anuncios/perguntas/pedidos.
 */
// Identidade primeiro: `user` e alvo das FKs de `modified_by` de todas as
// tabelas abaixo.
export * from "./auth";
// Aposentadas (substituidas por ./auth em 2026-08-11). Continuam exportadas
// porque a tabela continua existindo no banco — a regra da casa proibe DROP.
export * from "./usuarios";
export * from "./usuarios-sessoes";
export * from "./lotes";
export * from "./itens";
export * from "./itens-fotos";
export * from "./anuncios";
export * from "./perguntas";
export * from "./pedidos";
export * from "./auditoria";
export * from "./integracoes-eventos";
export * from "./integracoes-credenciais";
export * from "./integracoes-tarefas";
export * from "./integracoes-sincronizacoes";
export * from "./integracoes-ml-anuncios";
