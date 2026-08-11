/**
 * Testes das partes PURAS do worker.
 *
 * A drenagem em si fala com o banco e nao entra aqui — o `npm test` roda sem
 * Postgres no ar. O que ela faz de dificil (reivindicar com `FOR UPDATE SKIP
 * LOCKED`, separar as fases) e verificado de ponta a ponta pela rota
 * `/api/integracoes/worker`.
 *
 * Imports com extensao `.ts` e caminho relativo de proposito — mesma razao
 * explicada em `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { chaveHandler } from "./handlers.ts";
import { MAX_TENTATIVAS, esgotou, descreverErro } from "./retentativa.ts";

// -- a) a chave decide QUEM processa o evento -------------------------------

test("canal e topico juntos formam a chave", () => {
  assert.equal(chaveHandler("mercado_livre", "orders_v2"), "mercado_livre:orders_v2");
});

test("topico nulo tem chave propria — vale como 'qualquer coisa deste canal'", () => {
  assert.equal(chaveHandler("olx", null), "olx:");
});

test("canais diferentes com o mesmo topico NAO colidem", () => {
  // Se colidissem, o handler do ML processaria notificacao da OLX — e buscaria
  // o recurso na API errada, com o token errado.
  assert.notEqual(chaveHandler("mercado_livre", "orders_v2"), chaveHandler("olx", "orders_v2"));
});

// -- b) o teto de tentativas, no limite -------------------------------------

test("esgotou compara com o valor JA incrementado pela reivindicacao", () => {
  // Com teto 5, a quinta tentativa e a ultima. O `>=` (e nao `>`) e o que
  // impede uma sexta rodada.
  assert.equal(esgotou(MAX_TENTATIVAS - 1), false);
  assert.equal(esgotou(MAX_TENTATIVAS), true);
  assert.equal(esgotou(MAX_TENTATIVAS + 1), true);
});

test("primeira tentativa nunca esgota", () => {
  assert.equal(esgotou(1), false);
});

// -- c) o erro gravado precisa servir para diagnostico ---------------------

test("Error vira texto com stack — e o unico material de uma falha de madrugada", () => {
  const texto = descreverErro(new Error("token expirado"));
  assert.match(texto, /token expirado/);
  assert.match(texto, /Error/);
});

test("o que nao e Error nao vira '[object Object]'", () => {
  assert.equal(descreverErro("falha crua"), "falha crua");
  assert.equal(descreverErro(404), "404");
  // Objeto solto ainda vira "[object Object]" — limitacao aceita e explicita:
  // handler da casa lanca Error, e este caminho e so rede de seguranca.
  assert.equal(descreverErro({ codigo: 1 }), "[object Object]");
});
