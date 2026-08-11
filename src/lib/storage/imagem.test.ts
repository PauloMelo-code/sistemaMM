/**
 * Testes do sniff de imagem.
 *
 * Os arquivos sao montados byte a byte aqui em vez de virem de `fixtures/`: o
 * que esta sendo testado E o cabecalho, entao escrever o cabecalho na mao deixa
 * visivel o que cada caso exercita. Um `.png` binario na pasta so mostraria
 * "passou" sem dizer por que.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { analisarImagem, BYTES_MAXIMO, LADO_MINIMO } from "./imagem.ts";

function png(largura: number, altura: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}

/** `segmentosAntes` simula EXIF/miniatura empurrando o SOF para longe do inicio. */
function jpeg(largura: number, altura: number, segmentosAntes = 0): Buffer {
  const partes: Buffer[] = [Buffer.from([0xff, 0xd8])];

  for (let i = 0; i < segmentosAntes; i++) {
    const carga = Buffer.alloc(30, 0x20);
    partes.push(Buffer.from([0xff, 0xe1]), Buffer.from([0x00, 0x20]), carga);
  }

  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2); // tamanho do segmento
  sof.writeUInt8(8, 4); // precisao
  sof.writeUInt16BE(altura, 5); // altura ANTES da largura — a troca e o erro classico
  sof.writeUInt16BE(largura, 7);
  partes.push(sof);

  return Buffer.concat(partes);
}

function webpBase(fourcc: string): Buffer {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(32, 4);
  b.write("WEBP", 8, "ascii");
  b.write(fourcc, 12, "ascii");
  return b;
}

function webpLossy(largura: number, altura: number): Buffer {
  const b = webpBase("VP8 ");
  Buffer.from([0x9d, 0x01, 0x2a]).copy(b, 23);
  b.writeUInt16LE(largura, 26);
  b.writeUInt16LE(altura, 28);
  return b;
}

function webpLossless(largura: number, altura: number): Buffer {
  const b = webpBase("VP8L");
  b.writeUInt8(0x2f, 20);
  // 14 bits de cada dimensao, guardados como (valor - 1).
  b.writeUInt32LE((largura - 1) | ((altura - 1) << 14), 21);
  return b;
}

function webpEstendido(largura: number, altura: number): Buffer {
  const b = webpBase("VP8X");
  b.writeUIntLE(largura - 1, 24, 3);
  b.writeUIntLE(altura - 1, 27, 3);
  return b;
}

test("PNG: le largura e altura do IHDR", () => {
  const r = analisarImagem(png(1200, 800));
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && { ...r }, {
    ok: true,
    mime: "image/png",
    extensao: "png",
    largura: 1200,
    altura: 800,
    bytes: 33,
  });
});

test("JPEG: acha o SOF mesmo com EXIF na frente", () => {
  // O caso real: foto de celular chega com EXIF e miniatura antes do SOF. Uma
  // implementacao que so olhasse posicao fixa devolveria lixo aqui.
  const r = analisarImagem(jpeg(1600, 1200, 3));
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.largura, 1600);
  assert.equal(r.ok && r.altura, 1200);
  assert.equal(r.ok && r.extensao, "jpg");
});

test("JPEG: nao troca largura por altura", () => {
  const r = analisarImagem(jpeg(900, 1600));
  assert.equal(r.ok && r.largura, 900);
  assert.equal(r.ok && r.altura, 1600);
});

test("WebP: as tres codificacoes sao lidas", () => {
  // Tratar so a lossy faria toda imagem com transparencia ou salva em lossless
  // ser recusada como corrompida — e a extensao e `.webp` nos tres casos.
  for (const [nome, arquivo] of [
    ["VP8 (lossy)", webpLossy(1024, 768)],
    ["VP8L (lossless)", webpLossless(1024, 768)],
    ["VP8X (estendido)", webpEstendido(1024, 768)],
  ] as const) {
    const r = analisarImagem(arquivo);
    assert.equal(r.ok, true, `${nome} deveria ser aceito`);
    assert.equal(r.ok && r.largura, 1024, nome);
    assert.equal(r.ok && r.altura, 768, nome);
    assert.equal(r.ok && r.mime, "image/webp", nome);
  }
});

test("arquivo que NAO e imagem e recusado, por mais que se chame foto.jpg", () => {
  // O ponto do modulo: o `content-type` e o nome do arquivo sao afirmacoes do
  // cliente. So o conteudo e fato.
  const r = analisarImagem(Buffer.from("%PDF-1.7\n%teste de documento\n"));
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.motivo : "", /conteudo/);
});

test("imagem pequena demais para o marketplace e recusada", () => {
  const r = analisarImagem(png(LADO_MINIMO - 1, 2000));
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.motivo : "", /499x2000/);
});

test("acima do teto de bytes e recusado antes de olhar o conteudo", () => {
  const gigante = Buffer.alloc(BYTES_MAXIMO + 1);
  png(1200, 800).copy(gigante, 0);
  const r = analisarImagem(gigante);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.motivo : "", /limite/);
});

test("arquivo vazio e cabecalho truncado nao derrubam a analise", () => {
  assert.equal(analisarImagem(Buffer.alloc(0)).ok, false);

  // JPEG que comeca certo e acaba no meio: nao pode lancar excecao nem travar.
  const truncado = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12, 0x00)]);
  const r = analisarImagem(truncado);
  assert.equal(r.ok, false);
});
