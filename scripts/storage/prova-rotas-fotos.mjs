/**
 * Prova das ROTAS de foto contra o servidor rodando de verdade.
 *
 * Uso (com `npm run dev` no ar, banco e MinIO de pe):
 *   node scripts/storage/prova-rotas-fotos.mjs
 *
 * POR QUE EXISTE: `npm test` cobre so modulos puros, e as provas em
 * `scripts/db/*.sql` cobrem so o banco. Entre os dois fica a camada de ACAO —
 * transacao, ordem de leitura e escrita, promocao de capa — e ali nao havia
 * nada pegando erro.
 *
 * Nao e teoria: o caso 9 nasceu de um defeito real. `removerFoto` lia o
 * `principal` pelo RETURNING do proprio UPDATE, que no Postgres devolve a linha
 * DEPOIS da alteracao — entao a capa excluida se declarava "nao era capa" e
 * nenhuma substituta assumia. Typecheck, lint e as 27 provas de banco passavam
 * limpos com o defeito no lugar.
 *
 * Idempotente: trabalha sempre nos mesmos dois itens de teste (SKU `MM-PROVA-*`)
 * e limpa as fotos da rodada anterior por exclusao LOGICA, como manda a casa.
 *
 * Esperado: 12 passaram, 0 falharam.
 */
import { deflateSync } from "node:zlib";

import pg from "pg";

import { removerObjeto } from "../../src/lib/storage/minio.ts";

const BASE = process.env.PROVA_BASE_URL || "http://localhost:3000";
const API = `${BASE}/api/fotos`;
const USUARIO_SISTEMA = "00000000-0000-0000-0000-000000000001";

process.env.MINIO_ENDPOINT ||= "http://localhost:9000";
process.env.MINIO_ACCESS_KEY ||= "dev";
process.env.MINIO_SECRET_KEY ||= "devdevdev";
process.env.MINIO_BUCKET ||= "mm-fotos";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || "postgres://dev:dev@localhost:5436/mmsolucoes_dev",
});

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

// ------------------------------------------------------------------- imagens
const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = TABELA_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (tipo, dados) => {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const soma = Buffer.alloc(4);
  soma.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, soma]);
};

function png(lado) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const linha = Buffer.concat([
    Buffer.from([0]),
    Buffer.concat(Array.from({ length: lado }, () => Buffer.from([62, 142, 85]))),
  ]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: lado }, () => linha)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------------- helpers
async function enviar(itemId, dados, nome, alt) {
  const form = new FormData();
  form.set("item_id", itemId);
  form.set("arquivo", new Blob([dados], { type: "image/png" }), nome);
  if (alt) form.set("alt", alt);

  const resposta = await fetch(API, { method: "POST", body: form });
  return { status: resposta.status, corpo: await resposta.json() };
}

const listar = async (itemId) => (await (await fetch(`${API}?item_id=${itemId}`)).json()).fotos;

async function patch(url, corpo) {
  const resposta = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: resposta.status, corpo: await resposta.json() };
}

async function capasAtivas(itemId) {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE principal) AS capas, count(*) AS ativas
       FROM itens_fotos WHERE item_id = $1 AND is_deleted = false`,
    [itemId],
  );
  return { capas: Number(rows[0].capas), ativas: Number(rows[0].ativas) };
}

/**
 * Item de teste estavel. `ON CONFLICT` repete o predicado INTEIRO do indice
 * parcial — sem isso o Postgres nao consegue inferi-lo e levanta `42P10`
 * (a armadilha esta em docs/architecture.md §4).
 */
async function itemDeProva(sku, nome) {
  const { rows: lote } = await pool.query(
    `WITH existente AS (SELECT id FROM lotes WHERE nome = 'Lote de prova (rotas)' AND is_deleted = false LIMIT 1),
          novo AS (
            INSERT INTO lotes (nome, segmento, data_arremate, custo_total, modified_by)
            SELECT 'Lote de prova (rotas)', 'oftalmologia', '2026-01-01', 0, $1
            WHERE NOT EXISTS (SELECT 1 FROM existente)
            RETURNING id)
     SELECT id FROM existente UNION ALL SELECT id FROM novo`,
    [USUARIO_SISTEMA],
  );

  const { rows } = await pool.query(
    `INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
     VALUES ($1, $2, $3, 'oftalmologia', 100.00, $4)
     ON CONFLICT (sku) WHERE is_deleted = false
     DO UPDATE SET nome = EXCLUDED.nome, updated_at = now()
     RETURNING id`,
    [sku, nome, lote[0].id, USUARIO_SISTEMA],
  );
  return rows[0].id;
}

/** Zera a rodada anterior: exclusao LOGICA na tabela, objeto fora do bucket. */
async function limpar(itemId) {
  const { rows } = await pool.query(
    `UPDATE itens_fotos SET is_deleted = true, deleted_at = now(), principal = false,
            updated_at = now()
      WHERE item_id = $1 AND is_deleted = false RETURNING objeto`,
    [itemId],
  );
  for (const { objeto } of rows) await removerObjeto(objeto).catch(() => {});
  await pool.query(`UPDATE itens SET exibir_no_site = false, updated_at = now() WHERE id = $1`, [
    itemId,
  ]);
}

// ---------------------------------------------------------------------- prova
console.log(`Servidor: ${BASE}`);
console.log("-----------------------------------------");

const item = await itemDeProva("MM-PROVA-ROTAS", "Item de prova (rotas)");
const itemCorrida = await itemDeProva("MM-PROVA-CORRIDA", "Item de prova (corrida)");
await limpar(item);
await limpar(itemCorrida);

// 1) RN-109: sem foto nao vai para o site
const semFoto = await patch(API, { item_id: item, exibir_no_site: true });
checar(
  semFoto.status === 400 && /RN-109/.test(semFoto.corpo.erro ?? ""),
  `1) item sem foto recusado no toggle do site (${semFoto.status})`,
);

// 2) o conteudo manda, nao o nome nem o content-type
const texto = await enviar(item, Buffer.from("isto aqui e texto puro"), "foto.png");
checar(texto.status === 400, `2) arquivo que nao e imagem recusado (${texto.status})`);

// 3) tamanho minimo do marketplace
const pequena = await enviar(item, png(300), "pequena.png");
checar(
  pequena.status === 400 && /500px/.test(pequena.corpo.erro ?? ""),
  `3) imagem menor que 500px recusada (${pequena.status})`,
);

// 4) primeira foto vira capa sozinha
const primeira = await enviar(item, png(800), "foto1.png", "Vista frontal");
checar(
  primeira.status === 201 && primeira.corpo.foto.principal === true &&
    primeira.corpo.foto.ordem === 0 && primeira.corpo.foto.largura === 800,
  `4) primeira foto entra como capa, ordem 0, 800px (${primeira.status})`,
);

// 5) a segunda NAO rouba a capa
const segunda = await enviar(item, png(900), "foto2.png");
checar(
  segunda.status === 201 && segunda.corpo.foto.principal === false && segunda.corpo.foto.ordem === 1,
  `5) segunda foto entra como comum, ordem 1 (${segunda.status})`,
);

// 6) o link publico e o que o ML e o navegador consomem — sem credencial
const publica = await fetch(primeira.corpo.foto.url);
checar(
  publica.status === 200 && publica.headers.get("content-type") === "image/png",
  `6) URL publica abre sem credencial como image/png (${publica.status})`,
);

// 7) com foto, o toggle passa
const comFoto = await patch(API, { item_id: item, exibir_no_site: true });
checar(comFoto.status === 200, `7) item com foto pode ir para o site (${comFoto.status})`);

// 8) trocar a capa nao deixa duas
await patch(`${API}/${segunda.corpo.foto.id}`, { principal: true });
const aposTroca = await capasAtivas(item);
const listaTroca = await listar(item);
checar(
  aposTroca.capas === 1 && listaTroca[0].id === segunda.corpo.foto.id,
  `8) capa trocada, exatamente 1 capa e ela vem primeiro na lista (capas=${aposTroca.capas})`,
);

// 9) O CASO DO DEFEITO: excluir a capa promove a proxima
const exclusao = await fetch(`${API}/${segunda.corpo.foto.id}`, { method: "DELETE" });
const corpoExclusao = await exclusao.json();
const aposExclusao = await capasAtivas(item);
checar(
  corpoExclusao.novaCapa === primeira.corpo.foto.id && aposExclusao.capas === 1,
  `9) excluir a capa promove a proxima (novaCapa=${corpoExclusao.novaCapa}, capas=${aposExclusao.capas})`,
);

// 10) drag-and-drop: quatro uploads simultaneos, uma capa so
const paralelos = await Promise.all([800, 820, 840, 860].map((l) => enviar(itemCorrida, png(l), "p.png")));
const aposCorrida = await capasAtivas(itemCorrida);
checar(
  paralelos.every((r) => r.status === 201) && aposCorrida.ativas === 4 && aposCorrida.capas === 1,
  `10) 4 uploads simultaneos: ${aposCorrida.ativas} fotos, ${aposCorrida.capas} capa`,
);

// 11) reordenar
const antes = await listar(itemCorrida);
const invertida = [...antes].reverse().map((f) => f.id);
await patch(API, { item_id: itemCorrida, ordem: invertida });
const depois = await listar(itemCorrida);
checar(
  depois.filter((f) => !f.principal).map((f) => f.id).join() ===
    invertida.filter((id) => id !== depois.find((f) => f.principal)?.id).join(),
  "11) reordenacao respeita a ordem enviada",
);

// 12) id malformado nao chega ao banco
const idRuim = await fetch(`${API}?item_id=nao-e-uuid`);
checar(idRuim.status === 400, `12) item_id malformado recusado na borda (${idRuim.status})`);

await limpar(item);
await limpar(itemCorrida);
await pool.end();

console.log("-----------------------------------------");
console.log(`RESULTADO: ${ok} passaram, ${falhou} falharam`);
process.exitCode = falhou > 0 ? 1 : 0;
