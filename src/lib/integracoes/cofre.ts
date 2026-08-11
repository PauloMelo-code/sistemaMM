/**
 * Cifragem em repouso das credenciais de canal — AES-256-GCM da stdlib.
 *
 * O QUE ISTO PROTEGE: um dump de banco que vaze (backup mal guardado, acesso de
 * leitura amplo demais, `pg_dump` num lugar errado) entrega texto inutil em vez
 * do token que publica, despublica e responde em nome do cliente.
 *
 * O QUE ISTO **NAO** PROTEGE, e precisa estar claro: quem tiver a
 * `CREDENCIAIS_KEY` decifra tudo. Se a chave vazar junto com o dump, a cifragem
 * nao serviu de nada. Ela vale porque chave e banco vivem em lugares diferentes
 * — variavel de ambiente da aplicacao x arquivo de backup.
 *
 * GCM e nao CBC porque GCM e autenticado: adulterar o texto cifrado faz o
 * `decifrar` levantar excecao em vez de devolver lixo silenciosamente.
 *
 * Modulo PURO em relacao ao banco: nao importa `db`, nao sabe o que esta
 * cifrando. So texto entra e texto sai.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Prefixo de versao no pacote. Existe para permitir trocar algoritmo ou girar
 * chave depois sem adivinhar o formato do que ja esta gravado: o `decifrar`
 * olha o prefixo e sabe como ler.
 */
const VERSAO = "v1";

/** GCM padrao: 12 bytes de IV, 16 de tag. */
const TAMANHO_IV = 12;
const TAMANHO_CHAVE = 32; // AES-256

/**
 * A chave, lida do ambiente a cada uso (e nao cacheada no modulo) para que
 * trocar a variavel valha na proxima chamada, sem reiniciar o processo.
 *
 * Falha FECHADA: sem chave valida, nada e cifrado nem decifrado. O erro
 * proposital nao inclui o valor da variavel — mensagem de erro vai para log.
 */
function chave(): Buffer {
  const bruta = process.env.CREDENCIAIS_KEY;
  if (!bruta) {
    throw new Error(
      "CREDENCIAIS_KEY nao definida — credencial de canal nao pode ser lida nem gravada. " +
        'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  // Aceita hex (64 chars) ou base64. Qualquer outro tamanho e erro de
  // configuracao, nao entrada do usuario — melhor estourar do que cifrar com
  // uma chave curta derivada por acidente.
  const buffer = /^[0-9a-fA-F]{64}$/.test(bruta)
    ? Buffer.from(bruta, "hex")
    : Buffer.from(bruta, "base64");

  if (buffer.length !== TAMANHO_CHAVE) {
    throw new Error(
      `CREDENCIAIS_KEY precisa ter ${TAMANHO_CHAVE} bytes (64 hex ou base64 equivalente); ` +
        `veio com ${buffer.length}.`,
    );
  }
  return buffer;
}

/**
 * Devolve `v1.<iv>.<tag>.<cifrado>`, tudo em base64url.
 *
 * IV novo a cada chamada: reusar IV com a mesma chave em GCM quebra a
 * confidencialidade — nao e detalhe de estilo.
 */
export function cifrar(texto: string): string {
  const iv = randomBytes(TAMANHO_IV);
  const cipher = createCipheriv("aes-256-gcm", chave(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSAO,
    iv.toString("base64url"),
    tag.toString("base64url"),
    cifrado.toString("base64url"),
  ].join(".");
}

/** Levanta excecao se o pacote foi adulterado, truncado ou cifrado com outra chave. */
export function decifrar(pacote: string): string {
  const partes = pacote.split(".");
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new Error("Credencial em formato desconhecido — chave trocada ou dado corrompido.");
  }

  const [, ivB64, tagB64, cifradoB64] = partes;
  const decipher = createDecipheriv("aes-256-gcm", chave(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

  // `final()` e quem verifica a tag: se nao bater, lanca aqui.
  return Buffer.concat([
    decipher.update(Buffer.from(cifradoB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Versao segura para log e mensagem de erro: mostra o suficiente para
 * identificar QUAL token, sem revelar o token.
 */
export function mascarar(segredo: string): string {
  if (segredo.length <= 8) return "***";
  return `${segredo.slice(0, 4)}…${segredo.slice(-4)} (${segredo.length} chars)`;
}
