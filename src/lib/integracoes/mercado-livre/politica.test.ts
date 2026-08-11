/**
 * Testes da politica de retentativa do cliente do ML.
 *
 * O portao em si (`client.ts`) chega no banco via `token.ts` e nao entra aqui.
 * O que esta coberto sao as decisoes que, erradas, viram o jeito classico de
 * estourar a cota do canal: repetir o que nao deve ser repetido e "esperar"
 * zero milissegundo depois de um 429.
 *
 * Imports com extensao `.ts` e caminho relativo — mesma razao de
 * `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deveRetentar,
  esperaDoRetryAfter,
  esperaBackoff,
  ESPERA_PADRAO_429_MS,
  ESPERA_MAXIMA_MS,
} from "./politica.ts";

// -- a) o que pode e o que nao pode ser repetido ---------------------------

test("429 e 5xx sao repetiveis", () => {
  assert.equal(deveRetentar(429), true);
  assert.equal(deveRetentar(500), true);
  assert.equal(deveRetentar(502), true);
  assert.equal(deveRetentar(503), true);
});

test("4xx que nao e 429 NUNCA repete — repetir e queimar cota pelo mesmo erro", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(deveRetentar(status), false, `status ${status} nao devia repetir`);
  }
});

test("2xx e 3xx nao entram no caminho de retentativa", () => {
  assert.equal(deveRetentar(200), false);
  assert.equal(deveRetentar(301), false);
});

// -- b) Retry-After: as duas formas do HTTP, e as bordas -------------------

test("Retry-After em segundos", () => {
  assert.equal(esperaDoRetryAfter("30"), 30_000);
});

test("Retry-After como data HTTP — a forma que viraria NaN se ignorada", () => {
  const agora = new Date("2026-08-10T12:00:00Z");
  assert.equal(esperaDoRetryAfter("Mon, 10 Aug 2026 12:00:45 GMT", agora), 45_000);
});

test("cabecalho ausente ou ilegivel cai na espera padrao, nunca em zero", () => {
  // O caso perigoso: `setTimeout(NaN)` dispara IMEDIATAMENTE, que e exatamente
  // o retry cego que o 429 existe para impedir.
  for (const valor of [null, "", "amanha", "abc"]) {
    assert.equal(esperaDoRetryAfter(valor), ESPERA_PADRAO_429_MS);
  }
});

test("valor no passado ou zero nao vira 'pode agora'", () => {
  const agora = new Date("2026-08-10T12:00:00Z");
  assert.equal(esperaDoRetryAfter("0"), ESPERA_PADRAO_429_MS);
  assert.equal(esperaDoRetryAfter("-5"), ESPERA_PADRAO_429_MS);
  assert.equal(esperaDoRetryAfter("Mon, 10 Aug 2026 11:59:00 GMT", agora), ESPERA_PADRAO_429_MS);
});

test("espera absurda e limitada pelo teto — nao travar um worker por horas", () => {
  assert.equal(esperaDoRetryAfter("86400"), ESPERA_MAXIMA_MS);
});

// -- c) backoff cresce e nao passa do teto ---------------------------------

test("backoff dobra a cada tentativa", () => {
  assert.equal(esperaBackoff(1), 500);
  assert.equal(esperaBackoff(2), 1000);
  assert.equal(esperaBackoff(3), 2000);
});

test("backoff respeita o teto mesmo em tentativa alta", () => {
  assert.equal(esperaBackoff(20), ESPERA_MAXIMA_MS);
});
