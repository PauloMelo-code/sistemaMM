/**
 * Testes do fluxo OAuth de autorizacao do ML — as partes puras.
 *
 * O que esta coberto sao as duas garantias que, se falharem, nao aparecem em
 * teste de tela nenhum: o PKCE precisa ser mesmo o S256 do verifier, e o
 * `state` divergente ou vencido precisa ser recusado. Um `state` que passa
 * batido e o CSRF de OAuth — o painel conectado a conta de outra pessoa.
 *
 * Imports com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

import {
  COOKIE_ESTADO,
  VALIDADE_ESTADO_MS,
  abrirEstado,
  desafioDe,
  estadoConfere,
  gerarPkce,
  novoEstado,
  selarEstado,
  urlAutorizacao,
} from "./oauth.ts";

process.env.CREDENCIAIS_KEY = randomBytes(32).toString("hex");

// -- a) PKCE: o challenge tem que ser verificavel pelo ML ------------------

test("challenge e o SHA-256 do verifier em base64url", () => {
  const { verifier, challenge } = gerarPkce();
  const esperado = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, esperado);
});

test("verifier respeita a faixa de 43-128 caracteres do RFC", () => {
  const { verifier } = gerarPkce();
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `veio com ${verifier.length}`);
  // base64url: sem `+`, `/` ou `=`, que quebrariam na query string.
  assert.match(verifier, /^[A-Za-z0-9\-_]+$/);
});

test("cada fluxo sorteia um verifier diferente", () => {
  assert.notEqual(gerarPkce().verifier, gerarPkce().verifier);
});

test("desafioDe recalcula o mesmo challenge a partir do verifier guardado", () => {
  const { verifier, challenge } = gerarPkce();
  assert.equal(desafioDe(verifier), challenge);
});

// -- b) a URL de autorizacao ----------------------------------------------

test("URL leva os parametros que o ML espera, e o host do Brasil", () => {
  const url = new URL(
    urlAutorizacao({
      clientId: "123",
      redirectUri: "https://mm.example/api/integracoes/oauth/mercado-livre/callback",
      estado: "estado-abc",
      challenge: "desafio-xyz",
    }),
  );

  assert.equal(url.origin + url.pathname, "https://auth.mercadolivre.com.br/authorization");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "123");
  assert.equal(url.searchParams.get("state"), "estado-abc");
  assert.equal(url.searchParams.get("code_challenge"), "desafio-xyz");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("o redirect_uri vai inteiro, sem parametro nosso grudado", () => {
  // O ML exige URL estatica e IDENTICA a cadastrada; qualquer acrescimo aqui
  // faz o fluxo falhar por divergencia.
  const redirectUri = "https://mm.example/api/integracoes/oauth/mercado-livre/callback";
  const url = new URL(
    urlAutorizacao({ clientId: "1", redirectUri, estado: "e", challenge: "c" }),
  );
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
});

// -- c) o estado: selar, abrir e conferir ---------------------------------

test("selar e abrir preserva o estado", () => {
  const estado = novoEstado();
  const aberto = abrirEstado(selarEstado(estado));
  assert.deepEqual(aberto, estado);
});

test("cookie ausente, corrompido ou de outra chave devolve null, sem lancar", () => {
  assert.equal(abrirEstado(undefined), null);
  assert.equal(abrirEstado("lixo"), null);
  assert.equal(abrirEstado("v1.a.b.c"), null);
});

test("state divergente e recusado", () => {
  const estado = novoEstado();
  assert.equal(estadoConfere(estado, "outro-valor-qualquer"), false);
  assert.equal(estadoConfere(estado, null), false);
  assert.equal(estadoConfere(estado, ""), false);
});

test("state correto e aceito", () => {
  const estado = novoEstado();
  assert.equal(estadoConfere(estado, estado.estado), true);
});

test("state vencido e recusado mesmo estando correto", () => {
  const nascimento = new Date("2026-08-10T12:00:00Z");
  const estado = novoEstado(nascimento);

  const dentroDoPrazo = new Date(nascimento.getTime() + VALIDADE_ESTADO_MS - 1000);
  assert.equal(estadoConfere(estado, estado.estado, dentroDoPrazo), true);

  const depois = new Date(nascimento.getTime() + VALIDADE_ESTADO_MS + 1000);
  assert.equal(estadoConfere(estado, estado.estado, depois), false);
});

test("o nome do cookie e estavel — mudar quebra fluxo em andamento", () => {
  assert.equal(COOKIE_ESTADO, "ml_oauth");
});
