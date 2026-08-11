/**
 * Testes da trava de delecao na OLX.
 *
 * Isto guarda a unica acao IRREVERSIVEL que o sistema faz num canal: apagar
 * anuncio real do cliente. Na OLX nao existe "pausar" — a API tem `insert` e
 * `delete` — entao cumprir a RN-104 la e mais destrutivo do que a regra
 * descreve, e depende de decisao do Anderson.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { podeDeletarNaOlx } from "./politica.ts";

test('so o literal "true" autoriza', () => {
  assert.equal(podeDeletarNaOlx("true"), true);
});

test("falha FECHADA: ausente, vazio ou 'quase' NAO autoriza", () => {
  // Cada um destes ja apareceu em `.env` de alguem. Num comando que apaga
  // anuncio do cliente, "quase certo" tem que valer como nao.
  for (const valor of [undefined, "", " ", "TRUE", "True", "1", "sim", "yes", "true ", "on"]) {
    assert.equal(podeDeletarNaOlx(valor), false, `"${valor}" nao pode autorizar delecao`);
  }
});

test("o padrao do ambiente e NAO autorizar", () => {
  const original = process.env.OLX_DELETAR_AO_VENDER;
  delete process.env.OLX_DELETAR_AO_VENDER;
  assert.equal(podeDeletarNaOlx(), false);
  if (original !== undefined) process.env.OLX_DELETAR_AO_VENDER = original;
});
