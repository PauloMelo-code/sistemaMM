/**
 * Testes das partes PURAS do registro de evento (RN-117).
 *
 * `registrarEvento` fala com o banco e nao entra aqui — o `npm test` roda sem
 * Postgres no ar. O que esta coberto e a decisao que separa "reentrega" de
 * "evento novo", que e onde um erro custa venda perdida ou venda processada
 * duas vezes.
 *
 * Import com extensao `.ts` de proposito — mesma razao explicada em
 * `pricing.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// De `./envelope.ts`, NAO de `./eventos.ts`: aquele importa `db`, e importar
// `db` cria um Pool do Postgres e exige DATABASE_URL so para carregar o modulo —
// era o que quebrava este arquivo. Alias `@/` tambem nao funciona aqui: o
// type-stripping do `node --test` nao aplica os `paths` do tsconfig.
import { chaveEvento, extrairEnvelope, TAMANHO_MAXIMO_CORPO } from "./envelope.ts";

// -- a) a chave separa reentrega de evento novo -----------------------------

test("corpo identico gera a mesma chave — e o que faz a reentrega colidir", () => {
  const corpo = '{"topic":"orders_v2","resource":"/orders/2000012345"}';
  assert.equal(chaveEvento(corpo), chaveEvento(corpo));
});

test("eventos diferentes sobre o MESMO recurso geram chaves diferentes", () => {
  // O caso que proibe usar o id do recurso como chave: o mesmo pedido notifica
  // varias vezes ao longo da vida dele. Se as duas colidissem, a segunda
  // notificacao seria descartada como reentrega e a venda ficaria pela metade.
  const pagou = '{"topic":"orders_v2","resource":"/orders/1","status":"paid"}';
  const enviou = '{"topic":"orders_v2","resource":"/orders/1","status":"shipped"}';
  assert.notEqual(chaveEvento(pagou), chaveEvento(enviou));
});

test("a chave sai do TEXTO cru: ordem das chaves do JSON muda o hash", () => {
  // Documenta o comportamento real em vez de fingir canonizacao: o mesmo evento
  // reserializado com outra ordem contaria como novo. Aceitavel porque o canal
  // reentrega o byte-a-byte que enviou — e a razao de nao reserializarmos aqui.
  const a = '{"topic":"questions","resource":"/questions/9"}';
  const b = '{"resource":"/questions/9","topic":"questions"}';
    assert.notEqual(chaveEvento(a), chaveEvento(b));
});

test("chave e hex de 64 caracteres (sha-256), estavel para o mesmo texto", () => {
  const chave = chaveEvento("qualquer coisa");
  assert.match(chave, /^[0-9a-f]{64}$/);
  assert.equal(chave, chaveEvento("qualquer coisa"));
});

test("corpo vazio nao quebra — o ack nunca pode falhar", () => {
  assert.match(chaveEvento(""), /^[0-9a-f]{64}$/);
});

// -- b) leitura do envelope e melhor esforco, nunca excecao -----------------

test("le topico e recurso quando o envelope traz", () => {
  assert.deepEqual(
    extrairEnvelope({ topic: "orders_v2", resource: "/orders/1" }),
    { topico: "orders_v2", recurso: "/orders/1" },
  );
});

test("aceita as grafias em portugues", () => {
  assert.deepEqual(
    extrairEnvelope({ topico: "perguntas", recurso: "/questions/9" }),
    { topico: "perguntas", recurso: "/questions/9" },
  );
});

test("envelope desconhecido devolve nulos em vez de explodir", () => {
  for (const corpo of [null, undefined, 42, "texto", [], {}, { topic: 123 }, { topic: "  " }]) {
    assert.deepEqual(extrairEnvelope(corpo), { topico: null, recurso: null });
  }
});

// -- c) o teto do corpo existe e e sano ------------------------------------

test("teto do corpo e 64 KB", () => {
  assert.equal(TAMANHO_MAXIMO_CORPO, 65536);
});
