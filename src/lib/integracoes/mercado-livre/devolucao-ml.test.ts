/**
 * Testes da decisao de devolucao (RN-126). O que mais importa: so cancela
 * venda quando o dinheiro voltou ao comprador — cancelar por engano apaga
 * faturamento real.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decidirDevolucao, lerDevolucao, lerPaginaReclamacoes, lerReclamacao } from "./devolucao-ml.ts";

const reclamacao = (over: Record<string, unknown> = {}) =>
  lerReclamacao({
    id: 5001,
    resource: "order",
    resource_id: 2000018406360716,
    status: "closed",
    related_entities: ["return"],
    resolution: { reason: "item_returned" },
    ...over,
  })!;

test("le a reclamacao: pedido, devolucao e motivo", () => {
  assert.deepEqual(reclamacao(), {
    id: "5001",
    numeroPedido: "2000018406360716",
    status: "closed",
    temDevolucao: true,
    motivoResolucao: "item_returned",
  });
  assert.equal(reclamacao({ resource: "shipment" }).numeroPedido, null);
  assert.equal(lerReclamacao({}), null);
});

test("devolucao que chegou e foi reembolsada: devolvido (a conferir)", () => {
  const dev = lerDevolucao({ status: "delivered", status_money: "refunded", subtype: "return_total" });
  assert.equal(decidirDevolucao(reclamacao(), dev), "devolvido");
  // a rota pode devolver lista
  assert.deepEqual(lerDevolucao([{ status: "delivered", status_money: "refunded" }])?.status, "delivered");
});

test("low cost: reembolso sem a peca voltar", () => {
  const dev = lerDevolucao({ status: "delivered", status_money: "refunded", subtype: "low_cost" });
  assert.equal(decidirDevolucao(reclamacao(), dev), "reembolso_sem_volta");
});

test("devolucao em andamento ou sem reembolso nao mexe", () => {
  for (const d of [
    { status: "shipped", status_money: "retained" },
    { status: "delivered", status_money: "retained" },
    { status: "cancelled", status_money: "available" },
    { status: "shipped", status_money: "refunded" },
  ]) {
    assert.equal(decidirDevolucao(reclamacao(), lerDevolucao(d)), null, JSON.stringify(d));
  }
});

test("reclamacao sem devolucao: so a fechada com reembolso cancela", () => {
  const semDev = { related_entities: [] };
  assert.equal(
    decidirDevolucao(reclamacao({ ...semDev, resolution: { reason: "payment_refunded" } }), null),
    "reembolso_sem_volta",
  );
  assert.equal(decidirDevolucao(reclamacao({ ...semDev, status: "opened" }), null), null);
  assert.equal(
    decidirDevolucao(reclamacao({ ...semDev, resolution: { reason: "prefered_to_keep_product" } }), null),
    null,
  );
});

test("pagina de busca aceita `data` ou `results`", () => {
  assert.equal(lerPaginaReclamacoes({ data: [1, 2] }).length, 2);
  assert.equal(lerPaginaReclamacoes({ results: [1] }).length, 1);
  assert.equal(lerPaginaReclamacoes({}).length, 0);
});
