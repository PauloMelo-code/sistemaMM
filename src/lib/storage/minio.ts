/**
 * Cliente do MinIO — o storage das fotos de produto.
 *
 * Fala S3 puro (assinatura em `./assinatura.ts`), entao serve MinIO comunitario,
 * AIStor ou qualquer outro S3 sem trocar uma linha: muda so o `MINIO_ENDPOINT`.
 *
 * POR QUE DUAS URLS (`MINIO_ENDPOINT` e `MINIO_PUBLIC_URL`): no EasyPanel a
 * aplicacao alcanca o MinIO pela rede interna (`http://minio:9000`), que e mais
 * rapida e nao sai para a internet. Mas quem consome a foto e o NAVEGADOR do
 * visitante do site e o Mercado Livre, que baixa a imagem do link que a gente
 * informa — os dois precisam do dominio publico. Uma variavel so obrigaria a
 * escolher entre upload interno e link que funciona fora.
 *
 * POR QUE O BUCKET E DE LEITURA PUBLICA: o ML publica a foto BAIXANDO da URL
 * informada. URL assinada expira, e anuncio nao expira junto — sete dias depois
 * o anuncio fica com foto quebrada. O mesmo vale para o cache do site e para o
 * `next/image`. O que fica publico e foto de produto a venda; a ESCRITA continua
 * exigindo chave.
 */
import { randomUUID } from "node:crypto";

// Extensao `.ts` explicita (o resto do `src/` importa sem extensao): e o que
// permite `scripts/storage/prova-minio.mjs` carregar este modulo no Node puro,
// sem bundler. A prova so vale se exercitar ESTE arquivo, nao uma copia dele.
import {
  assinar,
  codificarCaminho,
  hashCorpo,
  HASH_CORPO_VAZIO,
  type Credenciais,
} from "./assinatura.ts";

/** Upload de ate 10 MB por uma rede lenta cabe folgado; alem disso e travamento. */
const TIMEOUT_ENVIO_MS = 60_000;
const TIMEOUT_PADRAO_MS = 15_000;

export interface ConfiguracaoStorage {
  endpoint: URL;
  /** Base publica, sem barra no fim. */
  basePublica: string;
  bucket: string;
  regiao: string;
  credenciais: Credenciais;
}

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `${nome} nao definida — o storage de fotos nao pode operar. ` +
        "Confira as variaveis MINIO_* no ambiente (ver .env.example).",
    );
  }
  return valor;
}

/**
 * Lida do ambiente a CADA chamada, e nao cacheada no modulo — mesmo motivo do
 * `cofre.ts`: trocar a variavel vale na proxima chamada, sem reiniciar.
 *
 * Falha FECHADA. Sem configuracao completa nada e enviado nem lido. O erro
 * oposto — assumir um padrao e seguir — gravaria foto num bucket errado e so
 * apareceria quando o cliente reclamasse do link quebrado.
 */
export function configuracaoStorage(): ConfiguracaoStorage {
  const endpoint = new URL(exigir("MINIO_ENDPOINT"));

  return {
    endpoint,
    // Sem `MINIO_PUBLIC_URL` o endpoint serve de base: e o caso do dev local,
    // onde os dois sao o mesmo `localhost:9000`. Em producao sao diferentes.
    basePublica: (process.env.MINIO_PUBLIC_URL || endpoint.origin).replace(/\/+$/, ""),
    bucket: exigir("MINIO_BUCKET"),
    // `us-east-1` e o padrao do MinIO quando nao ha regiao configurada.
    regiao: process.env.MINIO_REGION || "us-east-1",
    credenciais: {
      accessKey: exigir("MINIO_ACCESS_KEY"),
      secretKey: exigir("MINIO_SECRET_KEY"),
    },
  };
}

/**
 * Caminho do objeto dentro do bucket.
 *
 * GERADO NO SERVIDOR, sempre. O nome que o cliente enviou nunca vira caminho:
 * seria caminho controlado por quem faz upload, com `../` e colisao de nome de
 * brinde. O item no prefixo mantem as fotos de uma peca juntas, o que torna
 * possivel varrer ou limpar por item depois.
 */
export function gerarChave(itemId: string, extensao: string): string {
  return `itens/${itemId}/${randomUUID()}.${extensao}`;
}

/** O link que vai para o site publico e para o Mercado Livre. */
export function urlPublica(chave: string, config = configuracaoStorage()): string {
  return `${config.basePublica}/${config.bucket}${codificarCaminho(`/${chave}`)}`;
}

interface Requisicao {
  metodo: string;
  chave: string;
  corpo?: Buffer;
  mime?: string;
  timeoutMs: number;
  config: ConfiguracaoStorage;
}

async function requisitar({ metodo, chave, corpo, mime, timeoutMs, config }: Requisicao) {
  const caminho = `/${config.bucket}/${chave}`;
  const payloadHash = corpo ? hashCorpo(corpo) : HASH_CORPO_VAZIO;

  // `content-type` entra na assinatura: assim o tipo declarado no upload nao
  // pode ser trocado no caminho sem invalidar a requisicao inteira.
  const headers = assinar({
    metodo,
    host: config.endpoint.host,
    caminho,
    headers: { "x-amz-content-sha256": payloadHash, ...(mime ? { "content-type": mime } : {}) },
    payloadHash,
    credenciais: config.credenciais,
    regiao: config.regiao,
    servico: "s3",
    instante: new Date(),
  });

  // `host` sai daqui: o fetch monta o cabecalho a partir da URL, com o mesmo
  // valor que foi assinado. Mandar os dois e pedir para um proxy escolher.
  delete headers.host;

  return fetch(`${config.endpoint.origin}${codificarCaminho(caminho)}`, {
    method: metodo,
    headers,
    // `Buffer` nao satisfaz o `BodyInit` da lib DOM (que o Next usa); a view
    // equivalente satisfaz. Nao ha conversao de conteudo, sao os mesmos bytes.
    body: corpo ? new Uint8Array(corpo) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Detalha o erro sem despejar um XML inteiro no log. */
async function falha(operacao: string, chave: string, resposta: Response): Promise<Error> {
  const corpo = await resposta.text().catch(() => "");
  return new Error(
    `MinIO recusou ${operacao} de "${chave}": HTTP ${resposta.status}. ${corpo.slice(0, 300)}`,
  );
}

/**
 * Grava o objeto. Levanta excecao se o MinIO recusar — quem chama NAO pode
 * gravar a linha no banco achando que a foto subiu.
 *
 * A ordem e enviar primeiro e gravar depois, e nunca dentro de transacao
 * (invariante 4): chamada externa presa numa transacao segura lock de banco e
 * envenena o pool. O preco dessa ordem e que uma falha DEPOIS do envio deixa um
 * objeto sem linha — invisivel e ocupando disco. E o lado certo do erro: linha
 * sem objeto seria foto quebrada na tela do cliente.
 *
 * ponytail: objeto orfao so incomoda com volume; uma varredura comparando
 * bucket x tabela resolve quando (e se) o disco reclamar.
 */
export async function enviarObjeto(
  chave: string,
  corpo: Buffer,
  mime: string,
  config = configuracaoStorage(),
): Promise<string> {
  const resposta = await requisitar({
    metodo: "PUT",
    chave,
    corpo,
    mime,
    timeoutMs: TIMEOUT_ENVIO_MS,
    config,
  });

  if (!resposta.ok) throw await falha("upload", chave, resposta);
  return urlPublica(chave, config);
}

/**
 * Remove o objeto de verdade. NAO e o caminho da exclusao de foto no painel —
 * la o delete e logico e o objeto FICA, para desfazer engano. Existe para
 * limpeza deliberada e para o script de prova.
 */
export async function removerObjeto(
  chave: string,
  config = configuracaoStorage(),
): Promise<void> {
  const resposta = await requisitar({
    metodo: "DELETE",
    chave,
    timeoutMs: TIMEOUT_PADRAO_MS,
    config,
  });

  // 404 e sucesso: o objetivo era nao existir mais.
  if (!resposta.ok && resposta.status !== 404) throw await falha("remocao", chave, resposta);
}
