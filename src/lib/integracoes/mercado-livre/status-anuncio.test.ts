/**
 * Testes do de-para acao -> status do anuncio no ML.
 *
 * O teste que da nome ao arquivo e o ultimo: **`closed` precisa ser
 * inalcancavel**. `closed` finaliza a publicacao e NAO pode ser reativado — o
 * anuncio teria que ser republicado do zero, perdendo id, historico e posicao.
 * Um erro de digitacao num de-para nao pode custar isso.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { statusParaTipo, statusLocalParaTipo } from "./status-anuncio.ts";

test("pausar vira 'paused' e reativar vira 'active' — minusculo, como o ML exige", () => {
  assert.equal(statusParaTipo("pausar_anuncio"), "paused");
  assert.equal(statusParaTipo("reativar_anuncio"), "active");
});

test("tipo que nao mexe em anuncio devolve null em vez de algo aleatorio", () => {
  // `tirar_do_site` e interno (reservado no enum). Se caisse aqui com um valor
  // qualquer, mandariamos lixo para a API do canal.
  assert.equal(statusParaTipo("tirar_do_site"), null);
  assert.equal(statusLocalParaTipo("tirar_do_site"), null);
});

test("o status local acompanha o remoto", () => {
  assert.equal(statusLocalParaTipo("pausar_anuncio"), "pausado");
  assert.equal(statusLocalParaTipo("reativar_anuncio"), "no_ar");
});

test("NENHUM caminho de codigo produz 'closed' — e irreversivel", () => {
  const tipos = ["pausar_anuncio", "reativar_anuncio", "tirar_do_site"] as const;
  for (const tipo of tipos) {
    assert.notEqual(
      statusParaTipo(tipo),
      "closed",
      `${tipo} nao pode virar 'closed': fecha o anuncio para sempre`,
    );
  }
  // E nem por um tipo inventado: o de-para so responde ao que conhece.
  assert.equal(statusParaTipo("fechar_tudo" as never), null);
});
