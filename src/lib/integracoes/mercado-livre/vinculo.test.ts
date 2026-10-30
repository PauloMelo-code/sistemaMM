/**
 * Testes do plano do vinculo anuncio do ML -> item (RN-124).
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  definirSkus,
  montarPlano,
  prefixoDoSku,
  resumirLotes,
  situacaoDoItem,
  statusDoAnuncio,
  type AnuncioParaVinculo,
} from "./vinculo.ts";

const anuncio = (over: Partial<AnuncioParaVinculo>): AnuncioParaVinculo => ({
  idExterno: "MLB1",
  titulo: "Peca",
  sku: "LEILAO-009",
  status: "active",
  preco: 100,
  qtdDisponivel: 1,
  qtdVendida: 0,
  criadoNoMl: null,
  ...over,
});

test("prefixo e o texto antes do primeiro hifen; sem SKU vai para SEM-SKU", () => {
  assert.equal(prefixoDoSku("LEILAO-009"), "LEILAO");
  assert.equal(prefixoDoSku("l3-001"), "L3");
  assert.equal(prefixoDoSku(null), "SEM-SKU");
  assert.equal(prefixoDoSku("  "), "SEM-SKU");
});

test("SKU repetido: o primeiro pelo id fica com o original, os outros ganham -B, -C", () => {
  const skus = definirSkus(
    [
      anuncio({ idExterno: "MLB3" }),
      anuncio({ idExterno: "MLB1" }),
      anuncio({ idExterno: "MLB2" }),
      anuncio({ idExterno: "MLB9", sku: null }),
    ],
    new Set(),
  );
  assert.equal(skus.get("MLB1"), "LEILAO-009");
  assert.equal(skus.get("MLB2"), "LEILAO-009-B");
  assert.equal(skus.get("MLB3"), "LEILAO-009-C");
  assert.equal(skus.get("MLB9"), "ML-MLB9");
});

test("SKU que ja existe no Estoque tambem ganha sufixo", () => {
  const skus = definirSkus([anuncio({ idExterno: "MLB1", sku: "u-001" })], new Set(["U-001"]));
  assert.equal(skus.get("MLB1"), "U-001-B");
});

test("situacao e status: zerado vira vendido; so active fica no ar", () => {
  assert.equal(situacaoDoItem("active", 0), "vendido");
  assert.equal(situacaoDoItem("active", 2), "anunciado");
  assert.equal(situacaoDoItem("paused", 2), "pausado");
  assert.equal(situacaoDoItem("inactive", 1), "pausado");
  assert.equal(statusDoAnuncio("active"), "no_ar");
  assert.equal(statusDoAnuncio("closed"), "pausado");
});

test("resumo por lote soma unidades e sugere a data do anuncio mais antigo", () => {
  const [lote] = resumirLotes([
    anuncio({ idExterno: "MLB1", qtdDisponivel: 2, qtdVendida: 1, criadoNoMl: new Date("2026-05-10T12:00:00Z") }),
    anuncio({ idExterno: "MLB2", qtdDisponivel: 0, qtdVendida: 3, criadoNoMl: new Date("2026-03-01T12:00:00Z") }),
  ]);
  assert.deepEqual(lote, {
    prefixo: "LEILAO",
    anuncios: 2,
    unidadesDisponiveis: 2,
    unidadesVendidas: 4,
    dataSugerida: "2026-03-01",
  });
});

test("plano: custo rateado por unidade, quantidade = disponivel", () => {
  const r = montarPlano(
    [
      anuncio({ idExterno: "MLB1", preco: 100, qtdDisponivel: 1, qtdVendida: 1 }),
      anuncio({ idExterno: "MLB2", preco: 300, qtdDisponivel: 0, qtdVendida: 1, status: "paused" }),
    ],
    new Map([["LEILAO", "1000"]]),
    new Set(),
  );
  assert.ok(r.ok);
  // soma = 100*2 + 300*1 = 500 -> 200 e 600 por unidade
  assert.deepEqual(
    r.itens.map((i) => [i.sku, i.quantidade, i.custoUnitario, i.situacao, i.statusAnuncio]),
    [
      ["LEILAO-009", 1, "200.00", "anunciado", "no_ar"],
      ["LEILAO-009-B", 0, "600.00", "vendido", "pausado"],
    ],
  );
});

test("plano: lote sem custo recusa inteiro — nada de item sem custo (RN-121)", () => {
  const r = montarPlano([anuncio({ sku: "G-018" })], new Map([["LEILAO", "10"]]), new Set());
  assert.equal(r.ok, false);
});
