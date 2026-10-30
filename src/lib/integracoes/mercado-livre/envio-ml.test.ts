/**
 * Testes da traducao envio do ML -> status do pedido. O que mais importa: na
 * duvida, NAO mudar — cancelar venda por engano apaga faturamento real.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { lerPedidoParaEnvio, lerStatusDoEnvio, statusPedidoPara } from "./envio-ml.ts";

const pago = { status: "paid", idEnvio: "4400", entregue: false };

test("le o envio e as tags do pedido", () => {
  assert.deepEqual(
    lerPedidoParaEnvio({ status: "paid", shipping: { id: 4400 }, tags: ["paid", "delivered"] }),
    { status: "paid", idEnvio: "4400", entregue: true },
  );
  assert.deepEqual(lerPedidoParaEnvio({ status: "paid" }), { status: "paid", idEnvio: null, entregue: false });
  assert.equal(lerStatusDoEnvio({ id: 4400, status: "shipped" }), "shipped");
});

test("traducao dos estados do envio", () => {
  assert.equal(statusPedidoPara(pago, "pending"), "aguardando_envio");
  assert.equal(statusPedidoPara(pago, "handling"), "aguardando_envio");
  assert.equal(statusPedidoPara(pago, "ready_to_ship"), "aguardando_envio");
  assert.equal(statusPedidoPara(pago, "shipped"), "em_transporte");
  assert.equal(statusPedidoPara(pago, "delivered"), "concluido");
});

test("pedido cancelado no ML vira cancelado, qualquer que seja o envio", () => {
  assert.equal(statusPedidoPara({ ...pago, status: "cancelled" }, "delivered"), "cancelado");
});

test("na duvida nao muda: nao entregue, envio cancelado, status desconhecido", () => {
  assert.equal(statusPedidoPara(pago, "not_delivered"), null);
  assert.equal(statusPedidoPara(pago, "cancelled"), null);
  assert.equal(statusPedidoPara(pago, "algo_novo"), null);
  assert.equal(statusPedidoPara(pago, null), null);
});

test("sem envio do ML, a tag delivered conclui", () => {
  assert.equal(statusPedidoPara({ status: "paid", idEnvio: null, entregue: true }, null), "concluido");
  assert.equal(statusPedidoPara({ status: "paid", idEnvio: null, entregue: false }, null), null);
});
