/**
 * Testes da busca paginada de pedidos e do corte pela marca d'agua.
 *
 * O corte e feito por NOS, nao pelo servidor — o nome do parametro de filtro por
 * data do ML nao pode ser confirmado. Errar aqui tem dois lados ruins: parar
 * cedo demais deixa venda perdida sem achar; nunca parar queima cota paginando
 * o historico inteiro a cada passada.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  alcancouMarcaDagua,
  lerPaginaPedidos,
  urlBuscaPedidos,
  TAMANHO_PAGINA,
  type ResumoPedido,
} from "./busca-pedidos.ts";

const pedido = (numero: string, iso: string, status = "paid"): ResumoPedido => ({
  numero,
  vendidoEm: new Date(iso),
  status,
});

// -- a) a URL usa so o que esta confirmado na doc --------------------------

test("a busca ordena por data DESC — e o que faz o corte funcionar", () => {
  const url = new URL(urlBuscaPedidos({ vendedor: "123", pagina: 0 }), "https://x");
  assert.equal(url.searchParams.get("sort"), "date_desc");
  assert.equal(url.searchParams.get("seller"), "123");
});

test("paginacao por offset, no tamanho da pagina", () => {
  const p2 = new URL(urlBuscaPedidos({ vendedor: "1", pagina: 2 }), "https://x");
  assert.equal(p2.searchParams.get("offset"), String(2 * TAMANHO_PAGINA));
  assert.equal(p2.searchParams.get("limit"), String(TAMANHO_PAGINA));
});

test("NAO manda filtro de data — o nome do parametro nao foi confirmado", () => {
  // Se alguem "otimizar" adicionando um parametro chutado, o ML pode ignorar em
  // silencio e a busca passaria a devolver o historico inteiro (ou nada).
  const url = new URL(urlBuscaPedidos({ vendedor: "1", pagina: 0 }), "https://x");
  for (const chave of [...url.searchParams.keys()]) {
    assert.ok(
      ["seller", "sort", "limit", "offset"].includes(chave),
      `parametro nao confirmado na URL: ${chave}`,
    );
  }
});

// -- b) o corte pela marca d'agua -----------------------------------------

test("nao para enquanto o mais antigo da pagina ainda for mais novo que a marca", () => {
  const marca = new Date("2026-08-01T00:00:00Z");
  const pagina = [pedido("1", "2026-08-10T00:00:00Z"), pedido("2", "2026-08-05T00:00:00Z")];
  assert.equal(alcancouMarcaDagua(pagina, marca), false);
});

test("para quando a pagina alcanca a marca", () => {
  const marca = new Date("2026-08-06T00:00:00Z");
  const pagina = [pedido("1", "2026-08-10T00:00:00Z"), pedido("2", "2026-08-05T00:00:00Z")];
  assert.equal(alcancouMarcaDagua(pagina, marca), true);
});

test("compara com o MAIS ANTIGO da pagina, nao com o primeiro", () => {
  // Se comparasse com o primeiro (o mais novo), nunca alcancaria a marca e a
  // varredura pagina ate o teto toda vez.
  const marca = new Date("2026-08-06T00:00:00Z");
  const foraDeOrdem = [pedido("2", "2026-08-05T00:00:00Z"), pedido("1", "2026-08-10T00:00:00Z")];
  assert.equal(alcancouMarcaDagua(foraDeOrdem, marca), true);
});

test("sem marca d'agua nunca alcanca — quem limita e o teto de paginas", () => {
  assert.equal(alcancouMarcaDagua([pedido("1", "2020-01-01T00:00:00Z")], null), false);
});

test("pagina vazia nao conta como alcancada", () => {
  assert.equal(alcancouMarcaDagua([], new Date()), false);
});

// -- c) leitura da pagina: descartar sem derrubar --------------------------

test("le os pedidos utilizaveis", () => {
  const { pedidos, descartados } = lerPaginaPedidos({
    results: [
      { id: 2000012345, status: "paid", date_closed: "2026-08-10T14:32:00Z" },
      { id: "2000099999", status: "cancelled", date_created: "2026-08-09T10:00:00Z" },
    ],
  });
  assert.equal(descartados, 0);
  assert.deepEqual(
    pedidos.map((p) => [p.numero, p.status]),
    [["2000012345", "paid"], ["2000099999", "cancelled"]],
  );
});

test("linha quebrada e DESCARTADA, nao derruba a passada", () => {
  // A reconciliacao existe para achar o que falta; abortar tudo por causa de
  // uma linha estranha e o oposto disso. O descarte aparece na contagem.
  const { pedidos, descartados } = lerPaginaPedidos({
    results: [
      { id: 1, status: "paid", date_closed: "2026-08-10T14:32:00Z" },
      { status: "paid", date_closed: "2026-08-10T00:00:00Z" }, // sem id
      { id: 2, date_closed: "2026-08-10T00:00:00Z" }, // sem status
      { id: 3, status: "paid" }, // sem data
      { id: 4, status: "paid", date_closed: "ontem" }, // data ilegivel
    ],
  });
  assert.equal(pedidos.length, 1);
  assert.equal(descartados, 4);
});

test("resposta sem `results` devolve vazio em vez de explodir", () => {
  for (const lixo of [null, undefined, {}, { results: "nao e array" }, 42]) {
    assert.deepEqual(lerPaginaPedidos(lixo), { pedidos: [], descartados: 0 });
  }
});
