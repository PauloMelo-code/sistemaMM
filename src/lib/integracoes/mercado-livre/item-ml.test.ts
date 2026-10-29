/**
 * Testes do mapeamento do anuncio do ML (RN-123).
 *
 * Como em `pedido-ml.test.ts`: o formato foi lido da documentacao, nao de uma
 * resposta real. O que estes testes provam e que, quando o formato estiver
 * ERRADO, a importacao recusa em vez de gravar preco ou estoque inventados.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AnuncioMLInvalidoError,
  lerAnuncioML,
  lerDescricao,
  lerPaginaScan,
  lerRespostaBulk,
} from "./item-ml.ts";

const anuncioOk = () => ({
  id: "MLB1234567890",
  title: "Capô Hilux SRV 2005 a 2011",
  family_name: "Capô Hilux SRV",
  seller_id: 3606841202,
  seller_custom_field: null,
  status: "active",
  price: 1290,
  currency_id: "BRL",
  available_quantity: 1,
  sold_quantity: 3,
  category_id: "MLB1747",
  listing_type_id: "gold_special",
  condition: "new",
  permalink: "https://produto.mercadolivre.com.br/MLB-1234567890",
  date_created: "2026-05-01T10:00:00.000Z",
  last_updated: "2026-10-20T10:00:00.000Z",
  attributes: [
    { id: "BRAND", value_name: "CFC" },
    { id: "SELLER_SKU", value_name: " F-008 " },
  ],
  pictures: [
    { id: "123-MLB", url: "http://x/1.jpg", secure_url: "https://x/1.jpg" },
    { id: "456-MLB", url: "http://x/2.jpg" },
    { url: "https://x/sem-id.jpg" },
  ],
});

test("le o anuncio, com SKU do atributo SELLER_SKU", () => {
  const a = lerAnuncioML(anuncioOk());
  assert.equal(a.idExterno, "MLB1234567890");
  assert.equal(a.sku, "F-008");
  assert.equal(a.campoVendedor, null);
  assert.equal(a.preco, 1290);
  assert.equal(a.qtdDisponivel, 1);
  assert.equal(a.qtdVendida, 3);
  assert.equal(a.idVendedor, "3606841202");
});

test("foto prefere https, cai no url, e descarta a que nao tem id", () => {
  const { fotos } = lerAnuncioML(anuncioOk());
  assert.deepEqual(fotos, [
    { id: "123-MLB", url: "https://x/1.jpg" },
    { id: "456-MLB", url: "http://x/2.jpg" },
  ]);
});

test("sem preco ou sem estoque recusa — nunca grava zero inventado", () => {
  for (const campo of ["price", "available_quantity", "sold_quantity", "id", "title"]) {
    const a: Record<string, unknown> = anuncioOk();
    delete a[campo];
    assert.throws(() => lerAnuncioML(a), AnuncioMLInvalidoError, campo);
  }
});

test("anuncio sem SKU nenhum le como null, nao como erro", () => {
  const a = anuncioOk();
  a.attributes = [];
  assert.equal(lerAnuncioML(a).sku, null);
});

test("bulk separa o que leu do que o ML recusou, aceitando `code` do formato antigo", () => {
  const r = lerRespostaBulk([
    { status_code: 200, body: anuncioOk() },
    { code: 200, body: { id: "MLB2" } },
    { status_code: 404, body: { id: "MLB3", message: "not found" } },
  ]);
  assert.equal(r.corpos.length, 2);
  assert.deepEqual(r.falhas, [{ id: "MLB3", codigo: 404 }]);
});

test("pagina do scan devolve ids e scroll_id; sem results recusa", () => {
  assert.deepEqual(lerPaginaScan({ results: ["MLB1", "MLB2"], scroll_id: "abc" }), {
    ids: ["MLB1", "MLB2"],
    scrollId: "abc",
  });
  assert.deepEqual(lerPaginaScan({ results: [] }), { ids: [], scrollId: null });
  assert.throws(() => lerPaginaScan({}), AnuncioMLInvalidoError);
});

test("descricao vazia vira null", () => {
  assert.equal(lerDescricao({ plain_text: "Peca nova." }), "Peca nova.");
  assert.equal(lerDescricao({ plain_text: "" }), null);
});
