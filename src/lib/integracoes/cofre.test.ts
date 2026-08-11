/**
 * Testes do cofre (AES-256-GCM) das credenciais de canal.
 *
 * A chave e injetada aqui pelo proprio teste — nao depende de `.env`, e nao ha
 * segredo real neste arquivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { cifrar, decifrar, mascarar } from "./cofre.ts";

const CHAVE_TESTE = randomBytes(32).toString("hex");
process.env.CREDENCIAIS_KEY = CHAVE_TESTE;

test("ida e volta preserva o token exatamente", () => {
  const token = "APP_USR-1234567890-081012-abcdef-123456789";
  assert.equal(decifrar(cifrar(token)), token);
});

test("acentos e unicode sobrevivem", () => {
  const texto = "acentuação · emoji 🔐 · ç";
  assert.equal(decifrar(cifrar(texto)), texto);
});

test("cifrar duas vezes o MESMO texto da resultados diferentes", () => {
  // IV novo a cada chamada. Se saissem iguais, o mesmo token seria reconhecivel
  // no dump — e reusar IV com a mesma chave quebra o GCM.
  const token = "APP_USR-mesmo-token";
  assert.notEqual(cifrar(token), cifrar(token));
});

test("texto adulterado NAO decifra em silencio — e o ponto do GCM", () => {
  const pacote = cifrar("APP_USR-original");
  const partes = pacote.split(".");
  // Vira um bit do texto cifrado.
  const corrompido = Buffer.from(partes[3], "base64url");
  corrompido[0] ^= 0x01;
  partes[3] = corrompido.toString("base64url");

  assert.throws(() => decifrar(partes.join(".")));
});

test("pacote em formato desconhecido levanta erro claro", () => {
  assert.throws(() => decifrar("texto-puro"), /formato desconhecido/);
  assert.throws(() => decifrar("v2.a.b.c"), /formato desconhecido/);
});

test("chave errada nao decifra", () => {
  const pacote = cifrar("APP_USR-original");
  const original = process.env.CREDENCIAIS_KEY;
  process.env.CREDENCIAIS_KEY = randomBytes(32).toString("hex");
  assert.throws(() => decifrar(pacote));
  process.env.CREDENCIAIS_KEY = original;
});

test("chave de tamanho errado falha fechada, com mensagem util", () => {
  const original = process.env.CREDENCIAIS_KEY;
  process.env.CREDENCIAIS_KEY = "curta-demais";
  assert.throws(() => cifrar("x"), /32 bytes/);
  process.env.CREDENCIAIS_KEY = original;
});

test("sem chave nenhuma, falha fechada", () => {
  const original = process.env.CREDENCIAIS_KEY;
  delete process.env.CREDENCIAIS_KEY;
  assert.throws(() => cifrar("x"), /CREDENCIAIS_KEY nao definida/);
  process.env.CREDENCIAIS_KEY = original;
});

test("mascarar mostra o suficiente para identificar, e nao o segredo", () => {
  const token = "APP_USR-1234567890-abcdef";
  const mascarado = mascarar(token);
  assert.match(mascarado, /^APP_/);
  assert.ok(!mascarado.includes("1234567890"), "nao pode vazar o miolo do token");
  assert.equal(mascarar("curto"), "***");
});
