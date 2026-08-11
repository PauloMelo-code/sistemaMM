/**
 * Fluxo OAuth de autorizacao do Mercado Livre — a parte que nao toca o banco.
 *
 * E por aqui que a PRIMEIRA credencial nasce: o Anderson abre a URL de
 * autorizacao, aprova na conta de vendedor da MM, e o ML devolve um `code` que
 * trocamos por access + refresh token.
 *
 * Endpoints conferidos na documentacao oficial em 2026-08-10:
 * - autorizacao (Brasil): https://auth.mercadolivre.com.br/authorization
 * - token: https://api.mercadolibre.com/oauth/token (form-urlencoded, no CORPO)
 *
 * ⚠️ O `redirect_uri` precisa ser **estatico e identico** ao cadastrado no
 * portal do ML. Nao acrescente parametro nenhum nele: o que se quer levar vai
 * no `state`, senao o ML recusa por divergencia de URL.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Extensao `.ts` explicita: `oauth.test.ts` importa ESTE arquivo, e o
// type-stripping do `node --test` so resolve relativo com extensao. Sem ela o
// teste morre em ERR_MODULE_NOT_FOUND antes da primeira assercao. O tsconfig ja
// tem `allowImportingTsExtensions`, entao o typecheck e o build seguem felizes.
import { cifrar, decifrar } from "../cofre.ts";

const URL_AUTORIZACAO = "https://auth.mercadolivre.com.br/authorization";

/** Validade do estado do fluxo. Curta: e o tempo de aprovar numa tela. */
export const VALIDADE_ESTADO_MS = 10 * 60 * 1000;

/** Nome do cookie que carrega o estado entre o inicio e a volta do ML. */
export const COOKIE_ESTADO = "ml_oauth";

export interface Pkce {
  /** Segredo que fica so do nosso lado ate a troca do code. */
  verifier: string;
  /** SHA-256 do verifier, em base64url — e o que viaja na URL publica. */
  challenge: string;
}

/**
 * Gera o par do PKCE.
 *
 * O `challenge` vai na URL (que passa pelo navegador, pelo historico e pelo log
 * do ML); o `verifier` fica no cookie cifrado. Quem interceptar o `code` na
 * volta nao consegue troca-lo por token sem o verifier — que e exatamente o
 * ataque que o PKCE existe para fechar.
 *
 * 32 bytes em base64url dao 43 caracteres, dentro da faixa de 43-128 do RFC.
 */
export function gerarPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: desafioDe(verifier) };
}

/**
 * O challenge de um verifier JA existente.
 *
 * Existe para quem guardou so o verifier (o cookie) poder recalcular o desafio
 * sem sortear outro par — derivar e barato, e guardar os dois seria duas fontes
 * para o mesmo fato.
 */
export function desafioDe(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface EstadoOauth {
  estado: string;
  verifier: string;
  /** Epoch ms. Depois disso o fluxo e recusado. */
  expiraEm: number;
}

/** Cria o estado do fluxo (valor anti-CSRF + verifier + prazo). */
export function novoEstado(agora: Date = new Date()): EstadoOauth {
  return {
    estado: randomBytes(32).toString("base64url"),
    verifier: gerarPkce().verifier,
    expiraEm: agora.getTime() + VALIDADE_ESTADO_MS,
  };
}

/** Empacota o estado para o cookie — cifrado, nao apenas assinado. */
export function selarEstado(estado: EstadoOauth): string {
  return cifrar(JSON.stringify(estado));
}

/** Abre o cookie. Devolve `null` para qualquer coisa que nao confira. */
export function abrirEstado(selado: string | undefined): EstadoOauth | null {
  if (!selado) return null;
  try {
    const dados = JSON.parse(decifrar(selado)) as EstadoOauth;
    if (typeof dados.estado !== "string" || typeof dados.verifier !== "string") return null;
    if (typeof dados.expiraEm !== "number") return null;
    return dados;
  } catch {
    // Cookie adulterado, cifrado com outra chave ou corrompido. Nao distinguimos
    // os casos de proposito: para quem esta atacando, todos sao "invalido".
    return null;
  }
}

/**
 * O `state` que voltou e o mesmo que mandamos, e ainda esta no prazo?
 *
 * Comparacao em tempo constante: o `state` e um segredo de sessao, e comparar
 * com `===` vaza, por tempo, quantos caracteres iniciais o atacante acertou.
 */
export function estadoConfere(
  guardado: EstadoOauth,
  recebido: string | null,
  agora: Date = new Date(),
): boolean {
  if (!recebido) return false;
  if (guardado.expiraEm <= agora.getTime()) return false;

  const a = Buffer.from(guardado.estado);
  const b = Buffer.from(recebido);
  // `timingSafeEqual` exige tamanhos iguais; tamanho diferente ja e divergencia.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A URL para onde o Anderson e mandado para aprovar o acesso. */
export function urlAutorizacao({
  clientId,
  redirectUri,
  estado,
  challenge,
}: {
  clientId: string;
  redirectUri: string;
  estado: string;
  challenge: string;
}): string {
  const parametros = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: estado,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${URL_AUTORIZACAO}?${parametros}`;
}

export interface RespostaToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  user_id?: number | string;
}

export class TrocaDeTokenError extends Error {
  constructor(status: number, corpo: string) {
    super(
      `O Mercado Livre recusou a troca de token (HTTP ${status}): ${corpo.slice(0, 200)}. ` +
        "Confira se o app esta registrado com PKCE ATIVO e se o redirect_uri e " +
        "identico ao cadastrado no portal — sao as duas causas mais comuns.",
    );
    this.name = "TrocaDeTokenError";
  }
}

/**
 * O POST de token, compartilhado pelos dois `grant_type`.
 *
 * Um lugar so porque os dois usos exigem os MESMOS cabecalhos e os parametros no
 * CORPO — nunca em query string, que vazaria o `client_secret` no log de
 * qualquer proxy no caminho.
 */
export async function postToken(
  parametros: Record<string, string>,
  timeoutMs: number,
): Promise<RespostaToken> {
  const base = process.env.ML_API_BASE ?? "https://api.mercadolibre.com";

  const resposta = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(parametros),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resposta.ok) {
    throw new TrocaDeTokenError(resposta.status, await resposta.text().catch(() => ""));
  }

  const dados = (await resposta.json()) as RespostaToken;
  if (!dados.access_token || !dados.refresh_token || !dados.expires_in) {
    throw new Error("Resposta de token do ML sem os campos esperados.");
  }
  return dados;
}

/** Troca o `code` da volta do navegador por access + refresh token. */
export async function trocarCodigoPorToken({
  codigo,
  verifier,
}: {
  codigo: string;
  verifier: string;
}): Promise<RespostaToken> {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI precisam estar definidas para " +
        "concluir a autorizacao (docs/known-issues.md 🔴).",
    );
  }

  return postToken(
    {
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: codigo,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    15_000,
  );
}
