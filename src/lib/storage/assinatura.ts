/**
 * Assinatura AWS Signature Version 4 — o que autentica cada requisicao ao MinIO.
 *
 * POR QUE ESCRITO A MAO E NAO `@aws-sdk/client-s3`: o SDK resolve credential
 * providers, retry, streaming, XML e mais uma duzia de coisas que este projeto
 * nao usa; sao ~100 pacotes transitivos para o que aqui e uma cadeia de HMAC.
 * O pacote `minio` custa menos, mas ainda e dependencia para 70 linhas de
 * `node:crypto`. O algoritmo abaixo e publico, estavel desde 2012 e travado por
 * um vetor OFICIAL da AWS no teste ao lado — nao por um snapshot do proprio
 * codigo, que so provaria que ele continua fazendo o que ja fazia.
 *
 * Modulo PURO: nao le ambiente, nao abre conexao, nao sabe o que e um bucket.
 * Entra descricao de requisicao, sai cabecalho. E por isso que tem teste.
 *
 * Serve tanto o MinIO/AIStor quanto qualquer outro S3 — a assinatura e a mesma.
 */
import { createHash, createHmac } from "node:crypto";

const ALGORITMO = "AWS4-HMAC-SHA256";

export interface Credenciais {
  accessKey: string;
  secretKey: string;
}

export interface EntradaAssinatura {
  metodo: string;
  /** Com porta quando nao for a padrao: `minio.exemplo.com` ou `localhost:9000`. */
  host: string;
  /**
   * Caminho CRU, sem percent-encoding: `/mm-fotos/itens/abc/foto.jpg`.
   *
   * Cru de proposito. Se recebesse `URL`, o `pathname` ja viria codificado pela
   * plataforma e a codificacao canonica aplicaria por cima — um espaco viraria
   * `%2520` e a assinatura falharia com `SignatureDoesNotMatch`, sem dizer por
   * que. Recebendo cru, o MESMO codificador produz a URL enviada e a string
   * assinada; as duas nao tem como divergir.
   */
  caminho: string;
  query?: Record<string, string>;
  /** `host` e `x-amz-date` sao acrescentados aqui; nao passe nenhum dos dois. */
  headers?: Record<string, string>;
  /** hex(sha256(corpo)) ou a constante `UNSIGNED-PAYLOAD`. */
  payloadHash: string;
  credenciais: Credenciais;
  regiao: string;
  /** `s3` para objeto. Parametrizado porque o vetor oficial da AWS usa `service`. */
  servico: string;
  instante: Date;
}

/** sha256 de corpo vazio — o valor para GET e DELETE. */
export const HASH_CORPO_VAZIO =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function hashCorpo(corpo: Uint8Array | string): string {
  return createHash("sha256").update(corpo).digest("hex");
}

/**
 * Percent-encoding do RFC 3986, que e mais estrito que o `encodeURIComponent`:
 * `!`, `'`, `(`, `)` e `*` tambem precisam sair. Deixar um deles passar quebra a
 * assinatura de qualquer chave que contenha o caractere.
 */
function codificar(valor: string): string {
  return encodeURIComponent(valor).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Codifica cada segmento e preserva as barras — a barra e estrutura, nao dado. */
export function codificarCaminho(caminho: string): string {
  return caminho.split("/").map(codificar).join("/");
}

/** `20150830T123600Z` */
function instanteAmz(data: Date): string {
  return `${data.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

function canonizarQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((chave) => `${codificar(chave)}=${codificar(query[chave])}`)
    .join("&");
}

function chaveDeAssinatura(
  secretKey: string,
  dia: string,
  regiao: string,
  servico: string,
): Buffer {
  const kData = createHmac("sha256", `AWS4${secretKey}`).update(dia).digest();
  const kRegiao = createHmac("sha256", kData).update(regiao).digest();
  const kServico = createHmac("sha256", kRegiao).update(servico).digest();
  return createHmac("sha256", kServico).update("aws4_request").digest();
}

/**
 * Devolve os cabecalhos prontos para o `fetch` — os recebidos, mais `host`,
 * `x-amz-date` e `authorization`.
 *
 * Assina TODOS os cabecalhos recebidos. Quem chama decide o que entra: o que
 * estiver aqui nao pode ser trocado no caminho sem invalidar a assinatura, e o
 * que nao estiver, pode. Por isso o `content-type` entra em `enviarObjeto`.
 */
export function assinar(entrada: EntradaAssinatura): Record<string, string> {
  const amzDate = instanteAmz(entrada.instante);
  const dia = amzDate.slice(0, 8);
  const escopo = `${dia}/${entrada.regiao}/${entrada.servico}/aws4_request`;

  // Nome de cabecalho e case-insensitive no HTTP, mas a forma canonica exige
  // minusculo. Normalizar aqui evita que `Content-Type` e `content-type` gerem
  // assinaturas diferentes para a mesma requisicao.
  const headers: Record<string, string> = { host: entrada.host, "x-amz-date": amzDate };
  for (const [nome, valor] of Object.entries(entrada.headers ?? {})) {
    headers[nome.toLowerCase()] = valor;
  }

  const nomesAssinados = Object.keys(headers).sort();
  const headersCanonicos = nomesAssinados.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const listaAssinados = nomesAssinados.join(";");

  const requisicaoCanonica = [
    entrada.metodo.toUpperCase(),
    codificarCaminho(entrada.caminho),
    canonizarQuery(entrada.query ?? {}),
    headersCanonicos,
    listaAssinados,
    entrada.payloadHash,
  ].join("\n");

  const stringParaAssinar = [
    ALGORITMO,
    amzDate,
    escopo,
    createHash("sha256").update(requisicaoCanonica).digest("hex"),
  ].join("\n");

  const assinatura = createHmac(
    "sha256",
    chaveDeAssinatura(entrada.credenciais.secretKey, dia, entrada.regiao, entrada.servico),
  )
    .update(stringParaAssinar)
    .digest("hex");

  return {
    ...headers,
    authorization:
      `${ALGORITMO} Credential=${entrada.credenciais.accessKey}/${escopo}, ` +
      `SignedHeaders=${listaAssinados}, Signature=${assinatura}`,
  };
}
