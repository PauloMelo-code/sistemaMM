/**
 * Validacao de entrada de Lote e Item — a fronteira do formulario.
 *
 * O que estes testes protegem, e por que valem mais que a media: **dinheiro
 * digitado por gente**. "12.000,50" e "12000.50" sao o mesmo valor para uma
 * pessoa e coisas completamente diferentes para o Postgres. Um erro aqui nao
 * quebra a tela — grava um numero errado com cara de certo, que e o defeito que
 * este projeto mais teme (invariante 3 do CLAUDE.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loteSchema, normalizarDinheiro } from "./lote.ts";
import { itemSchema } from "./item.ts";

const HOJE = new Date().toISOString().slice(0, 10);

const loteValido = {
  nome: "Lote 14",
  segmento: "Oftalmologia",
  data_arremate: "2026-03-10",
  custo_total: "12000,50",
};

const itemValido = {
  sku: "mm-oft-1401",
  nome: "Autorrefrator",
  // UUID v4 de verdade. `00000000-...-0001` (o uuid do usuario-sistema) NAO
  // passa: o Zod 4 confere a RFC, onde o digito de versao precisa ser 1-8.
  lote_id: "6f1c2a3e-9d47-4b2f-8a10-5c7e2b9d4f11",
  segmento: "Oftalmologia",
  custo: "3300,00",
  preco_alvo: "",
  local_galpao: "",
  situacao: "sem_anuncio",
  quantidade: "1",
};

// --------------------------------------------------------------------------
// normalizarDinheiro — o coracao do problema
// --------------------------------------------------------------------------

test("dinheiro: formato brasileiro completo vira ponto decimal", () => {
  assert.equal(normalizarDinheiro("12.000,50"), "12000.50");
  assert.equal(normalizarDinheiro("1.234.567,89"), "1234567.89");
});

test("dinheiro: virgula sozinha e separador decimal", () => {
  assert.equal(normalizarDinheiro("12000,5"), "12000.5");
});

test("dinheiro: SEM virgula, o ponto e decimal e nao milhar", () => {
  // Este e o caso que se erra: tratar "12000.50" como milhar daria 1.200.050.
  assert.equal(normalizarDinheiro("12000.50"), "12000.50");
});

test("dinheiro: inteiro puro passa intacto", () => {
  assert.equal(normalizarDinheiro("12000"), "12000");
});

// --------------------------------------------------------------------------
// Lote
// --------------------------------------------------------------------------

test("lote: entrada valida normaliza dinheiro e segmento", () => {
  const r = loteSchema.safeParse(loteValido);
  assert.equal(r.success, true);
  assert.equal(r.data?.custo_total, "12000.50");
  // Minusculo na gravacao: o banco ja mostrou "Oftalmologia" e "oftalmologia"
  // como segmentos SEPARADOS, com filtros que nao se encontram.
  assert.equal(r.data?.segmento, "oftalmologia");
});

test("lote: custo zero e recusado", () => {
  // Zero faria `custoRecuperado` devolver 100% para um lote que nao se pagou.
  const r = loteSchema.safeParse({ ...loteValido, custo_total: "0" });
  assert.equal(r.success, false);
});

test("lote: custo com texto e recusado", () => {
  assert.equal(loteSchema.safeParse({ ...loteValido, custo_total: "R$ 12000" }).success, false);
  assert.equal(loteSchema.safeParse({ ...loteValido, custo_total: "doze mil" }).success, false);
});

test("lote: arremate no futuro e recusado", () => {
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assert.equal(loteSchema.safeParse({ ...loteValido, data_arremate: amanha }).success, false);
});

test("lote: arremate hoje e aceito", () => {
  assert.equal(loteSchema.safeParse({ ...loteValido, data_arremate: HOJE }).success, true);
});

test("lote: nome vazio e recusado", () => {
  assert.equal(loteSchema.safeParse({ ...loteValido, nome: "   " }).success, false);
});

// --------------------------------------------------------------------------
// Item
// --------------------------------------------------------------------------

test("item: SKU sobe para maiusculo", () => {
  const r = itemSchema.safeParse(itemValido);
  assert.equal(r.success, true);
  assert.equal(r.data?.sku, "MM-OFT-1401");
});

test("item: SKU com espaco no meio e recusado", () => {
  assert.equal(itemSchema.safeParse({ ...itemValido, sku: "MM OFT 1401" }).success, false);
});

test("item: preco alvo vazio vira NULL, nao zero", () => {
  // Zero significaria "decidimos vender de graca"; null significa "ainda nao
  // precificamos". A diferenca aparece na margem de toda tela.
  const r = itemSchema.safeParse({ ...itemValido, preco_alvo: "" });
  assert.equal(r.success, true);
  assert.equal(r.data?.preco_alvo, null);
});

test("item: preco alvo preenchido normaliza", () => {
  const r = itemSchema.safeParse({ ...itemValido, preco_alvo: "5.200,00" });
  assert.equal(r.data?.preco_alvo, "5200.00");
});

test("item: local do galpao vazio vira NULL", () => {
  const r = itemSchema.safeParse({ ...itemValido, local_galpao: "  " });
  assert.equal(r.data?.local_galpao, null);
});

test("item: custo zero e recusado", () => {
  // Custo zero viraria margem de 100% em toda tela do sistema.
  assert.equal(itemSchema.safeParse({ ...itemValido, custo: "0" }).success, false);
});

test("item: custo vazio e recusado (a coluna e NOT NULL)", () => {
  assert.equal(itemSchema.safeParse({ ...itemValido, custo: "" }).success, false);
});

test("item: lote precisa ser uuid", () => {
  assert.equal(itemSchema.safeParse({ ...itemValido, lote_id: "lote-14" }).success, false);
});

test("item: situacao fora do enum e recusada", () => {
  assert.equal(itemSchema.safeParse({ ...itemValido, situacao: "quase_vendido" }).success, false);
});

test("item: quantidade e inteiro de zero para cima (ADR-0002)", () => {
  const r = itemSchema.safeParse({ ...itemValido, quantidade: " 19 " });
  assert.ok(r.success);
  assert.equal(r.data.quantidade, 19);
  assert.equal(itemSchema.safeParse({ ...itemValido, quantidade: "0" }).success, true);
  for (const quantidade of ["-1", "1,5", "", "abc"]) {
    assert.equal(itemSchema.safeParse({ ...itemValido, quantidade }).success, false, quantidade);
  }
});
