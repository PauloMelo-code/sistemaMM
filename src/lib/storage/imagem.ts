/**
 * Identifica o formato e as dimensoes de uma imagem lendo os BYTES dela.
 *
 * POR QUE NAO CONFIAR NO `content-type` DO UPLOAD: quem envia escolhe o
 * cabecalho e escolhe o nome do arquivo. Os dois sao afirmacoes do cliente, nao
 * fatos. Um `.exe` renomeado para `.jpg` com `content-type: image/jpeg` passa
 * por qualquer validacao que olhe so isso — e vai parar num bucket de leitura
 * publica, servido pelo nosso dominio. O unico dado que nao mente e o conteudo.
 *
 * POR QUE LER LARGURA E ALTURA: o Mercado Livre degrada (e em alguns casos
 * recusa) imagem pequena, e a foto e o que vende equipamento usado. Barrar no
 * upload da mensagem util na hora; descobrir depois significa anuncio publicado
 * com foto ruim. As dimensoes tambem vao para o banco, para o site publico
 * reservar o espaco do `<img>` e nao pular o layout quando a foto carrega.
 *
 * Modulo PURO: so Buffer entra e resultado sai. Nao le ambiente, nao toca rede.
 *
 * Nao decodifica a imagem — le so o cabecalho de cada formato. Decodificar
 * exigiria dependencia (sharp) e daria o mesmo numero.
 */

/** Teto por arquivo. O ML aceita ate 10 MB por imagem; acompanhar esse limite. */
export const BYTES_MAXIMO = 10 * 1024 * 1024;

/**
 * Menor lado aceito, em pixels. O ML pede no minimo 500 e recomenda 1200 para a
 * foto ficar com zoom. 500 e o piso do que da para publicar sem vergonha.
 */
export const LADO_MINIMO = 500;

/** Tres formatos, e so tres: sao os que ML, OLX e navegador aceitam sem conversao. */
const EXTENSAO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type Analise =
  | { ok: true; mime: string; extensao: string; largura: number; altura: number; bytes: number }
  | { ok: false; motivo: string };

interface Dimensoes {
  largura: number;
  altura: number;
}

function ehPng(b: Buffer): boolean {
  return b.length > 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function ehJpeg(b: Buffer): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function ehWebp(b: Buffer): boolean {
  return (
    b.length > 30 &&
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

/** IHDR e obrigatoriamente o primeiro chunk: largura e altura em posicao fixa. */
function dimensoesPng(b: Buffer): Dimensoes {
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}

/**
 * JPEG nao tem posicao fixa: e uma lista de segmentos, e o tamanho mora no SOF,
 * que pode vir depois de EXIF, miniatura e perfil de cor. Entao percorre.
 */
function dimensoesJpeg(b: Buffer): Dimensoes | null {
  let i = 2; // pula o SOI (FF D8)

  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null; // fora de sincronia: arquivo truncado ou corrompido
    const marcador = b[i + 1];

    // Marcadores sem payload (preenchimento e reinicio) — avanca um byte.
    if (marcador === 0xff) {
      i += 1;
      continue;
    }
    // SOS (inicio dos dados) ou EOI: daqui para frente nao ha mais cabecalho.
    if (marcador === 0xda || marcador === 0xd9) return null;

    // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC), que nao sao frame headers.
    const ehSof =
      marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;

    if (ehSof) {
      // [tamanho:2][precisao:1][altura:2][largura:2] — altura ANTES da largura.
      return { largura: b.readUInt16BE(i + 7), altura: b.readUInt16BE(i + 5) };
    }

    const tamanho = b.readUInt16BE(i + 2);
    if (tamanho < 2) return null; // tamanho invalido: nao da para avancar sem travar
    i += 2 + tamanho;
  }
  return null;
}

/**
 * WebP tem TRES codificacoes com cabecalhos diferentes, e a extensao e o mesmo
 * `.webp` nas tres. Tratar so a lossy (o caso comum) faria toda imagem salva em
 * lossless ou com transparencia ser recusada como "corrompida".
 */
function dimensoesWebp(b: Buffer): Dimensoes | null {
  const formato = b.subarray(12, 16).toString("ascii");

  if (formato === "VP8 ") {
    // Lossy: 14 bits uteis de cada dimensao, os 2 de cima sao escala.
    return { largura: b.readUInt16LE(26) & 0x3fff, altura: b.readUInt16LE(28) & 0x3fff };
  }
  if (formato === "VP8L") {
    // Lossless: 14 bits de largura e 14 de altura empacotados, guardados como (valor - 1).
    const bits = b.readUInt32LE(21);
    return { largura: (bits & 0x3fff) + 1, altura: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (formato === "VP8X") {
    // Estendido (transparencia, animacao): 24 bits por dimensao, tambem (valor - 1).
    return { largura: b.readUIntLE(24, 3) + 1, altura: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/**
 * Analisa o arquivo recebido. Devolve uniao discriminada em vez de lancar
 * excecao: entrada ruim aqui e caso ESPERADO (o operador arrastou o PDF errado),
 * nao falha de programa — e a rota precisa transformar `motivo` em mensagem.
 */
export function analisarImagem(dados: Buffer): Analise {
  if (dados.length === 0) return { ok: false, motivo: "Arquivo vazio." };

  if (dados.length > BYTES_MAXIMO) {
    const mb = (dados.length / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      motivo: `Imagem de ${mb} MB — o limite e ${BYTES_MAXIMO / 1024 / 1024} MB.`,
    };
  }

  let mime: string;
  let dimensoes: Dimensoes | null;

  if (ehPng(dados)) {
    mime = "image/png";
    dimensoes = dimensoesPng(dados);
  } else if (ehJpeg(dados)) {
    mime = "image/jpeg";
    dimensoes = dimensoesJpeg(dados);
  } else if (ehWebp(dados)) {
    mime = "image/webp";
    dimensoes = dimensoesWebp(dados);
  } else {
    return {
      ok: false,
      motivo: "Arquivo nao e uma imagem JPEG, PNG ou WebP (conferido pelo conteudo).",
    };
  }

  if (!dimensoes || dimensoes.largura <= 0 || dimensoes.altura <= 0) {
    return { ok: false, motivo: "Imagem corrompida: nao foi possivel ler as dimensoes." };
  }

  const menorLado = Math.min(dimensoes.largura, dimensoes.altura);
  if (menorLado < LADO_MINIMO) {
    return {
      ok: false,
      motivo:
        `Imagem de ${dimensoes.largura}x${dimensoes.altura}px — o menor lado precisa ter ` +
        `pelo menos ${LADO_MINIMO}px para publicar no marketplace.`,
    };
  }

  return {
    ok: true,
    mime,
    extensao: EXTENSAO[mime],
    largura: dimensoes.largura,
    altura: dimensoes.altura,
    bytes: dados.length,
  };
}
