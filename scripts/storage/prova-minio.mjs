/**
 * Prova de que o storage de fotos funciona ponta a ponta contra um MinIO de
 * verdade.
 *
 * Uso: docker compose up -d minio && node scripts/storage/prova-minio.mjs
 *
 * POR QUE ESTE SCRIPT EXISTE, se ja ha teste unitario: os testes provam a
 * ASSINATURA contra os vetores da AWS, mas nao provam que o MinIO ACEITA a
 * requisicao que a gente monta. Erro de URI canonica, de cabecalho fora da
 * assinatura ou de politica do bucket so aparece quando um servidor de verdade
 * responde `SignatureDoesNotMatch` — e nenhum teste de mesa pega isso.
 *
 * Mesmo espirito de `scripts/db/*.sql`: exercita o comportamento real e limpa o
 * que criou. Roda contra o MinIO LOCAL; nao aponte para producao.
 *
 * Esperado: 7 passaram, 0 falharam.
 */
import { deflateSync } from "node:zlib";

import { assinar, hashCorpo } from "../../src/lib/storage/assinatura.ts";
import { analisarImagem } from "../../src/lib/storage/imagem.ts";
import {
  configuracaoStorage,
  enviarObjeto,
  gerarChave,
  removerObjeto,
  urlPublica,
} from "../../src/lib/storage/minio.ts";

// Padroes do `docker-compose.yml`. Deixa o script rodavel sem preparar `.env`,
// que e o que faz alguem de fato rodar a prova.
const PADROES = {
  MINIO_ENDPOINT: "http://localhost:9000",
  MINIO_ACCESS_KEY: "dev",
  MINIO_SECRET_KEY: "devdevdev",
  MINIO_BUCKET: "mm-fotos",
};
for (const [chave, valor] of Object.entries(PADROES)) {
  process.env[chave] ||= valor;
}

let ok = 0;
let falhou = 0;

function checar(condicao, mensagem) {
  if (condicao) {
    console.log(`OK  ${mensagem}`);
    ok += 1;
  } else {
    console.log(`FALHOU ${mensagem}`);
    falhou += 1;
  }
}

// ---------------------------------------------------------------- PNG de teste
const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = TABELA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/**
 * PNG de VERDADE, nao um cabecalho falso: quem vai buscar esta URL e o navegador
 * do visitante e o Mercado Livre. Um arquivo que so parece PNG passaria por
 * todas as verificacoes daqui e falharia justamente onde importa.
 */
function pngSolido(lado, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 2; // truecolor RGB

  const linha = Buffer.concat([
    Buffer.from([0]), // filtro "none"
    Buffer.concat(Array.from({ length: lado }, () => Buffer.from([r, g, b]))),
  ]);
  const bruto = Buffer.concat(Array.from({ length: lado }, () => linha));

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(bruto)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------- operacoes de bucket (admin)
// Ficam AQUI e nao em `src/lib/storage/`: a aplicacao nunca cria bucket nem
// mexe em politica em tempo de execucao. Isso e preparo de ambiente, feito uma
// vez pelo console do MinIO (ou por este script, no local).
async function requisicaoAdmin(metodo, caminho, query, corpo) {
  const config = configuracaoStorage();
  const payloadHash = corpo ? hashCorpo(corpo) : hashCorpo("");

  const headers = assinar({
    metodo,
    host: config.endpoint.host,
    caminho,
    query,
    headers: { "x-amz-content-sha256": payloadHash },
    payloadHash,
    credenciais: config.credenciais,
    regiao: config.regiao,
    servico: "s3",
    instante: new Date(),
  });
  delete headers.host;

  const parametros = new URLSearchParams(query ?? {}).toString();
  return fetch(
    `${config.endpoint.origin}${caminho}${parametros ? `?${parametros}` : ""}`,
    { method: metodo, headers, body: corpo },
  );
}

async function criarBucket(bucket) {
  const resposta = await requisicaoAdmin("PUT", `/${bucket}`);
  // 409 = ja existe e e nosso. Rodar a prova duas vezes nao pode falhar.
  if (!resposta.ok && resposta.status !== 409) {
    throw new Error(`nao consegui criar o bucket: HTTP ${resposta.status} ${await resposta.text()}`);
  }
}

/** A mesma politica que `mc anonymous set download` aplica. */
async function liberarLeituraPublica(bucket) {
  const politica = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });

  const resposta = await requisicaoAdmin("PUT", `/${bucket}`, { policy: "" }, Buffer.from(politica));
  if (!resposta.ok) {
    throw new Error(`nao consegui aplicar a politica: HTTP ${resposta.status} ${await resposta.text()}`);
  }
}

// ------------------------------------------------------------------------ prova
const config = configuracaoStorage();
console.log(`MinIO: ${config.endpoint.origin} · bucket "${config.bucket}"`);
console.log("-----------------------------------------");

await criarBucket(config.bucket);
await liberarLeituraPublica(config.bucket);

const foto = pngSolido(600, [31, 168, 85]);
const itemId = "00000000-0000-0000-0000-0000000000aa";
const chave = gerarChave(itemId, "png");

// 1) o validador aceita um PNG real
const analise = analisarImagem(foto);
checar(
  analise.ok && analise.largura === 600 && analise.altura === 600 && analise.mime === "image/png",
  `1) PNG real de 600x600 aceito pelo validador (${analise.ok ? `${foto.length} bytes` : analise.motivo})`,
);

// 2) upload assinado e aceito pelo MinIO
// Se a URI canonica estiver errada, e AQUI que aparece: `SignatureDoesNotMatch`.
const url = await enviarObjeto(chave, foto, "image/png");
checar(url === urlPublica(chave), `2) upload aceito e URL publica montada (${url})`);

// 3) a URL abre SEM credencial — e o que o ML e o navegador fazem
const publica = await fetch(url);
checar(publica.status === 200, `3) leitura anonima devolve 200 (veio ${publica.status})`);

// 4) volta o arquivo identico, com o tipo certo
const baixado = Buffer.from(await publica.arrayBuffer());
checar(
  publica.headers.get("content-type") === "image/png" && baixado.equals(foto),
  "4) bytes voltam identicos e com content-type image/png",
);

// 5) escrita continua exigindo chave — leitura publica nao pode virar tudo publico
const semCredencial = await fetch(url, { method: "PUT", body: Buffer.from("invasao") });
checar(
  semCredencial.status === 403 || semCredencial.status === 401,
  `5) PUT anonimo recusado (veio ${semCredencial.status})`,
);

// 6) chave errada nao passa — prova que a assinatura e VERIFICADA, nao ignorada
const secretOriginal = process.env.MINIO_SECRET_KEY;
process.env.MINIO_SECRET_KEY = "chave-errada-de-proposito";
let recusou = false;
try {
  await enviarObjeto(gerarChave(itemId, "png"), foto, "image/png");
} catch {
  recusou = true;
}
process.env.MINIO_SECRET_KEY = secretOriginal;
checar(recusou, "6) upload com chave errada e recusado");

// 7) remocao limpa mesmo
await removerObjeto(chave);
const depois = await fetch(url);
checar(depois.status === 404, `7) objeto removido devolve 404 (veio ${depois.status})`);

console.log("-----------------------------------------");
console.log(`RESULTADO: ${ok} passaram, ${falhou} falharam`);

// `exitCode` em vez de `process.exit()`: sair na marra com conexoes do fetch
// ainda fechando dispara um assert do libuv no Windows. Assim o Node encerra
// sozinho quando termina de limpar, e o codigo de saida continua servindo ao CI.
process.exitCode = falhou > 0 ? 1 : 0;
