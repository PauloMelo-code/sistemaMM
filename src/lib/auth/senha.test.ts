/**
 * Testes do hash de senha (scrypt).
 *
 * Sao lentos de proposito — o custo do KDF E a protecao. Se alguem baixar `N`
 * "porque o teste demora", o ataque de forca bruta fica igualmente mais barato.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { gerarHash, conferirSenha, validarSenha, TAMANHO_MINIMO_SENHA } from "./senha.ts";

test("a senha correta confere", async () => {
  const hash = await gerarHash("uma senha longa o suficiente");
  assert.equal(await conferirSenha("uma senha longa o suficiente", hash), true);
});

test("senha errada nao confere", async () => {
  const hash = await gerarHash("uma senha longa o suficiente");
  assert.equal(await conferirSenha("uma senha longa o suficientE", hash), false);
  assert.equal(await conferirSenha("", hash), false);
});

test("a MESMA senha gera hashes diferentes — salt por senha", async () => {
  // Sem salt proprio, duas pessoas com a mesma senha teriam o mesmo hash e uma
  // tabela pre-calculada quebraria as duas de uma vez.
  const a = await gerarHash("senha compartilhada 123");
  const b = await gerarHash("senha compartilhada 123");
  assert.notEqual(a, b);
  assert.equal(await conferirSenha("senha compartilhada 123", a), true);
  assert.equal(await conferirSenha("senha compartilhada 123", b), true);
});

test("o hash nao contem a senha em lugar nenhum", async () => {
  const hash = await gerarHash("bicicleta-vermelha-1987");
  assert.equal(hash.includes("bicicleta"), false);
  assert.equal(hash.includes("1987"), false);
});

test("acentos e unicode funcionam", async () => {
  const senha = "coração·2026·ç";
  assert.equal(await conferirSenha(senha, await gerarHash(senha)), true);
});

test("hash corrompido ou de outro formato devolve false, nunca lanca", async () => {
  // Login que explode por dado estranho no banco entrega ao atacante a
  // informacao de que aquele usuario existe.
  for (const hash of ["", "lixo", "scrypt-n15.a.b", "bcrypt$2a$10$abc", "scrypt-n99.a.b"]) {
    assert.equal(await conferirSenha("qualquer coisa", hash), false, `hash: "${hash}"`);
  }
});

test("hash adulterado nao confere", async () => {
  const hash = await gerarHash("senha original longa");
  const partes = hash.split(".");
  const bytes = Buffer.from(partes[2], "base64url");
  bytes[0] ^= 0x01;
  partes[2] = bytes.toString("base64url");
  assert.equal(await conferirSenha("senha original longa", partes.join(".")), false);
});

test("comprimento minimo e a unica regra — e ela existe", () => {
  assert.match(validarSenha("curta") ?? "", /12 caracteres/);
  assert.equal(validarSenha("a".repeat(TAMANHO_MINIMO_SENHA)), null);
  // Sem exigencia de simbolo/maiuscula: empurra para `Senha@123` e post-it.
  assert.equal(validarSenha("todas minusculas sem numero"), null);
});
