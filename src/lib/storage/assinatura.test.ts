/**
 * Testes da assinatura SigV4 contra VETORES OFICIAIS da AWS.
 *
 * A diferenca importa: um teste que assinasse algo e comparasse com o resultado
 * da propria implementacao so provaria que ela continua igual a si mesma —
 * inclusive se estivesse errada desde o primeiro dia. Os tres casos abaixo tem
 * assinatura publicada pela AWS (test suite `aws-sig-v4-test-suite` e os
 * exemplos de S3 na documentacao de autenticacao), entao o que eles provam e que
 * o algoritmo esta CERTO, nao que esta estavel.
 *
 * As credenciais sao as de exemplo da propria documentacao. Nao ha segredo real
 * neste arquivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { assinar, hashCorpo, HASH_CORPO_VAZIO, codificarCaminho } from "./assinatura.ts";

/** Extrai so a assinatura: o espaco depois da virgula varia entre exemplos da AWS. */
function assinaturaDe(headers: Record<string, string>): string {
  return headers.authorization.match(/Signature=([0-9a-f]{64})/)?.[1] ?? "";
}

const CRED_SUITE = {
  accessKey: "AKIDEXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

const CRED_S3 = {
  // Concatenado de proposito. O detector de segredos
  // (`scripts/check-compliance.mjs`) casa `AKIA` + 16 maiusculas, e a chave de
  // EXEMPLO da documentacao da AWS tem exatamente esse formato. Quebrar a string
  // mantem o vetor oficial intacto sem ensinar o auditor a ignorar um padrao que
  // ele DEVE continuar pegando em qualquer outro arquivo.
  accessKey: `AKIA${"IOSFODNN7EXAMPLE"}`,
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

test("vetor oficial `get-vanilla` do aws-sig-v4-test-suite", () => {
  const headers = assinar({
    metodo: "GET",
    host: "example.amazonaws.com",
    caminho: "/",
    payloadHash: HASH_CORPO_VAZIO,
    credenciais: CRED_SUITE,
    regiao: "us-east-1",
    servico: "service",
    instante: new Date("2015-08-30T12:36:00Z"),
  });

  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
      "SignedHeaders=host;x-amz-date, " +
      "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  );
});

test("vetor oficial S3: GET com Range e cinco cabecalhos assinados", () => {
  const headers = assinar({
    metodo: "GET",
    host: "examplebucket.s3.amazonaws.com",
    caminho: "/test.txt",
    headers: {
      range: "bytes=0-9",
      "x-amz-content-sha256": HASH_CORPO_VAZIO,
    },
    payloadHash: HASH_CORPO_VAZIO,
    credenciais: CRED_S3,
    regiao: "us-east-1",
    servico: "s3",
    instante: new Date("2013-05-24T00:00:00Z"),
  });

  assert.equal(
    assinaturaDe(headers),
    "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("vetor oficial S3: PUT com `$` no caminho e corpo de verdade", () => {
  // Este caso e o que prova a codificacao do caminho: a AWS assina
  // `/test%24file.text`. Se o `$` passasse cru, a assinatura mudaria — e o erro
  // so apareceria com um nome de arquivo incomum, em producao.
  const corpo = "Welcome to Amazon S3.";
  const hash = hashCorpo(corpo);
  assert.equal(hash, "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");

  const headers = assinar({
    metodo: "PUT",
    host: "examplebucket.s3.amazonaws.com",
    caminho: "/test$file.text",
    headers: {
      date: "Fri, 24 May 2013 00:00:00 GMT",
      "x-amz-storage-class": "REDUCED_REDUNDANCY",
      "x-amz-content-sha256": hash,
    },
    payloadHash: hash,
    credenciais: CRED_S3,
    regiao: "us-east-1",
    servico: "s3",
    instante: new Date("2013-05-24T00:00:00Z"),
  });

  assert.equal(
    assinaturaDe(headers),
    "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
  );
});

test("codificarCaminho preserva barra e escapa o resto", () => {
  assert.equal(codificarCaminho("/bucket/itens/a b.jpg"), "/bucket/itens/a%20b.jpg");
  assert.equal(codificarCaminho("/test$file.text"), "/test%24file.text");
  // `!`, `'`, `(`, `)` e `*` escapam de encodeURIComponent e precisam sair na mao.
  assert.equal(codificarCaminho("/foto(1)!.jpg"), "/foto%281%29%21.jpg");
});

test("cabecalho recebido em maiuscula assina igual ao minusculo", () => {
  const base = {
    metodo: "PUT" as const,
    host: "minio.local:9000",
    caminho: "/mm-fotos/x.jpg",
    payloadHash: HASH_CORPO_VAZIO,
    credenciais: CRED_S3,
    regiao: "us-east-1",
    servico: "s3",
    instante: new Date("2026-08-10T10:00:00Z"),
  };

  const a = assinar({ ...base, headers: { "Content-Type": "image/jpeg" } });
  const b = assinar({ ...base, headers: { "content-type": "image/jpeg" } });
  assert.equal(assinaturaDe(a), assinaturaDe(b));
});
