/**
 * Testes do mapeamento do pedido do ML.
 *
 * Este arquivo cobre o que este sistema PRESUME sobre o formato do ML. Como o
 * mapeamento nao pode ser conferido contra um pedido real ainda, o valor aqui
 * nao e "provar que esta certo" — e provar que, quando estiver ERRADO, o
 * sistema recusa em vez de gravar dinheiro inventado.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { lerPedidoML, PedidoMLInvalidoError, STATUS_PAGO } from "./pedido-ml.ts";

/** Um pedido no formato que esperamos do ML. */
const pedidoOk = () => ({
  id: 2000012345,
  status: "paid",
  date_closed: "2026-08-10T14:32:00.000-03:00",
  date_created: "2026-08-10T14:00:00.000-03:00",
  total_amount: 5200,
  seller: { id: 123456789 },
  order_items: [{ item: { id: "MLB1234567890" }, quantity: 1, unit_price: 5200, sale_fee: 728 }],
});

// -- a) o caminho feliz ----------------------------------------------------

test("le os campos que o handler precisa", () => {
  const p = lerPedidoML(pedidoOk());
  assert.equal(p.numero, "2000012345");
  assert.equal(p.idAnuncio, "MLB1234567890");
  assert.equal(p.valor, 5200);
  assert.equal(p.taxaInformada, 728);
  assert.equal(p.idVendedor, "123456789");
  assert.equal(p.status, STATUS_PAGO);
});

test("id numerico vira string — o ML mistura os dois e comparar tipos diferentes falha calado", () => {
  const p = lerPedidoML(pedidoOk());
  assert.equal(typeof p.numero, "string");
  assert.equal(typeof p.idVendedor, "string");
});

test("prefere date_closed (quando fechou) a date_created (quando nasceu)", () => {
  const p = lerPedidoML(pedidoOk());
  assert.equal(p.vendidoEm.toISOString(), new Date("2026-08-10T14:32:00.000-03:00").toISOString());
});

test("sem date_closed, cai em date_created — mas NUNCA em agora", () => {
  const semFechamento = { ...pedidoOk(), date_closed: undefined };
  const p = lerPedidoML(semFechamento);
  assert.equal(p.vendidoEm.toISOString(), new Date("2026-08-10T14:00:00.000-03:00").toISOString());
});

// -- b) o que precisa RECUSAR, e por que -----------------------------------

test("campo obrigatorio ausente recusa em vez de gravar zero", () => {
  const casos: Array<[string, object]> = [
    ["sem id", { ...pedidoOk(), id: undefined }],
    ["sem status", { ...pedidoOk(), status: undefined }],
    ["sem total_amount", { ...pedidoOk(), total_amount: undefined }],
    ["sem order_items", { ...pedidoOk(), order_items: undefined }],
    ["order_items vazio", { ...pedidoOk(), order_items: [] }],
    ["sem item.id", { ...pedidoOk(), order_items: [{ item: {}, sale_fee: 1 }] }],
    ["sem data nenhuma", { ...pedidoOk(), date_closed: undefined, date_created: undefined }],
  ];

  for (const [nome, payload] of casos) {
    assert.throws(() => lerPedidoML(payload), PedidoMLInvalidoError, `${nome}: devia recusar`);
  }
});

test("`total_amount` invalido recusa — zero em coluna de dinheiro e pior que erro", () => {
  for (const valor of [null, "abc", -1, Number.NaN, {}]) {
    assert.throws(() => lerPedidoML({ ...pedidoOk(), total_amount: valor }), PedidoMLInvalidoError);
  }
});

test("data ilegivel recusa em vez de virar Invalid Date no banco", () => {
  assert.throws(
    () => lerPedidoML({ ...pedidoOk(), date_closed: "ontem", date_created: undefined }),
    PedidoMLInvalidoError,
  );
});

test("le a quantidade de unidades (ADR-0002)", () => {
  const p = lerPedidoML({
    ...pedidoOk(),
    order_items: [{ item: { id: "MLB1" }, quantity: 3, sale_fee: 10 }],
  });
  assert.equal(p.quantidade, 3);
});

test("quantidade ausente ou invalida recusa — assumir 1 baixaria o estoque errado", () => {
  for (const quantity of [undefined, 0, -1, 1.5, "abc"]) {
    assert.throws(
      () => lerPedidoML({ ...pedidoOk(), order_items: [{ item: { id: "MLB1" }, quantity }] }),
      PedidoMLInvalidoError,
      `quantity=${String(quantity)}`,
    );
  }
});

test("pedido MULTI-ITEM e recusado — nao existe representacao para ele", () => {
  // `pedidos.item_id` e NOT NULL: um pedido e UM item (com N unidades). Dois
  // anuncios no mesmo pedido nao cabem, e "so o primeiro" perderia uma venda.
  const doisItens = {
    ...pedidoOk(),
    order_items: [
      { item: { id: "MLB1" }, sale_fee: 10 },
      { item: { id: "MLB2" }, sale_fee: 20 },
    ],
  };
  assert.throws(() => lerPedidoML(doisItens), /2 itens/);
});

test("corpo que nao e objeto recusa", () => {
  for (const lixo of [null, undefined, 42, "texto", []]) {
    assert.throws(() => lerPedidoML(lixo), PedidoMLInvalidoError);
  }
});

// -- c) o que pode faltar sem derrubar -------------------------------------

test("sem sale_fee o pedido nasce com taxa ESTIMADA, e isso nao e erro", () => {
  const semTaxa = { ...pedidoOk(), order_items: [{ item: { id: "MLB1" }, quantity: 1 }] };
  const p = lerPedidoML(semTaxa);
  assert.equal(p.taxaInformada, null);
});

test("sem seller.id o pedido ainda e lido — a checagem de conta e do handler", () => {
  const semVendedor = { ...pedidoOk(), seller: undefined };
  assert.equal(lerPedidoML(semVendedor).idVendedor, null);
});

test("status diferente de paid e LIDO — quem decide o que fazer e o handler", () => {
  // O mapeamento nao filtra status: se filtrasse, o handler perderia a
  // informacao de que existe um pedido cancelado precisando de tratamento.
  const p = lerPedidoML({ ...pedidoOk(), status: "cancelled" });
  assert.equal(p.status, "cancelled");
});
