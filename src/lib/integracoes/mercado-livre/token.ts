/**
 * Token do Mercado Livre: leitura, validade e troca segura.
 *
 * O PROBLEMA QUE MANDA NESTE ARQUIVO: **o refresh token do ML e de uso unico.**
 * Cada troca invalida o refresh anterior e devolve um novo. Se dois processos
 * trocarem ao mesmo tempo com o mesmo refresh, o ML aceita o primeiro e recusa
 * o segundo — e, dependendo da ordem de escrita, o perdedor grava lixo por cima
 * do token bom. **Nao ha conserto por codigo**: alguem precisa abrir o navegador
 * e reautorizar o app na conta de vendedor da MM.
 *
 * Por isso a troca acontece sob `pg_advisory_xact_lock`: quem pega o lock
 * renova; quem perde espera e le o token novo (single-flight sem Redis).
 *
 * ⚠️ ESTE E O UNICO LUGAR DA BASE ONDE CHAMADA HTTP ACONTECE DENTRO DE UMA
 * TRANSACAO, e e proposital. O advisory lock e de transacao — sem transacao nao
 * ha exclusao mutua. O custo (uma transacao aberta durante uma requisicao) e
 * aceito porque a troca e rara (~6h), curta e tem timeout duro; a alternativa e
 * perder a integracao inteira. **Nao use isto como precedente**: qualquer outra
 * chamada externa fica fora de transacao (ver `worker.ts`).
 *
 * Endpoints conferidos na documentacao oficial em 2026-08-10:
 * POST https://api.mercadolibre.com/oauth/token, corpo `form-urlencoded`
 * (nao query string), `accept: application/json`.
 */
import { sql, eq, and } from "drizzle-orm";

import { db } from "@/lib/db";
import { integracoesCredenciais } from "@/lib/db/schema/integracoes-credenciais";

import { cifrar, decifrar } from "../cofre";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";
import { postToken, TrocaDeTokenError, type RespostaToken } from "./oauth";

/**
 * Margem antes do vencimento em que ja renovamos.
 *
 * Renovar so no 401 transforma expiracao em erro de rotina e faz toda chamada
 * pagar uma ida perdida. Com ~6h de vida, 20% e ~1h de folga — tempo de sobra
 * para o ML estar instavel e ainda assim renovarmos antes de faltar token.
 */
export const MARGEM_RENOVACAO = 0.2;

/** Timeout da troca. Curto: e uma transacao aberta esperando terceiro. */
const TIMEOUT_TOKEN_MS = 10_000;

/** Chave do advisory lock. Constante — precisa ser a MESMA em todo processo. */
const LOCK_REFRESH = sql`hashtext('ml_refresh')`;

export class SemCredencialError extends Error {
  constructor() {
    super(
      "Nenhuma credencial ativa do Mercado Livre. O app precisa ser autorizado na conta " +
        "de vendedor da MM (docs/known-issues.md 🔴).",
    );
    this.name = "SemCredencialError";
  }
}

export class ReautorizacaoNecessariaError extends Error {
  constructor(motivo: string) {
    super(
      `O Mercado Livre recusou a renovacao (${motivo}). Nao ha conserto automatico: ` +
        "o Anderson precisa reautorizar o app no navegador.",
    );
    this.name = "ReautorizacaoNecessariaError";
  }
}

/** Vence dentro da margem (ou ja venceu)? */
export function precisaRenovar(expiraEm: Date, agora: Date, vidaSegundos = 6 * 3600): boolean {
  const margemMs = vidaSegundos * MARGEM_RENOVACAO * 1000;
  return expiraEm.getTime() - agora.getTime() <= margemMs;
}

/**
 * A renovacao. Usa o mesmo POST de token do fluxo de autorizacao (`oauth.ts`) —
 * os dois `grant_type` exigem os mesmos cabecalhos e parametros no corpo, e
 * duplicar isso seria duas versoes da mesma regra para divergirem depois.
 */
export async function trocarRefreshToken(refreshToken: string): Promise<RespostaToken> {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new SemCredencialError();
  }

  try {
    return await postToken(
      {
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      },
      TIMEOUT_TOKEN_MS,
    );
  } catch (erro) {
    // 400/401 aqui e `invalid_grant`: o refresh ja foi consumido, revogado ou e
    // de outro app. Nao adianta repetir — este e o caso que exige gente.
    if (erro instanceof TrocaDeTokenError && /HTTP (400|401)/.test(erro.message)) {
      throw new ReautorizacaoNecessariaError(erro.message);
    }
    throw erro;
  }
}

/**
 * Grava (ou substitui) a credencial do canal a partir da resposta do ML.
 *
 * Usada pelo callback do OAuth. Substituir e o comportamento certo: o indice
 * unico so permite UMA credencial ativa por canal, e reautorizar significa
 * justamente "esqueca a anterior". A antiga sai por exclusao logica, entao a
 * troca fica na trilha em vez de sumir.
 */
export async function salvarCredencial(dados: RespostaToken): Promise<void> {
  const agora = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(integracoesCredenciais)
      .set({
        is_deleted: true,
        deleted_at: agora,
        updated_at: agora,
        modified_by: USUARIO_SISTEMA_ID,
      })
      .where(
        and(
          eq(integracoesCredenciais.canal, "mercado_livre"),
          eq(integracoesCredenciais.is_deleted, false),
        ),
      );

    await tx.insert(integracoesCredenciais).values({
      canal: "mercado_livre",
      conta_externa_id: dados.user_id ? String(dados.user_id) : null,
      access_token: cifrar(dados.access_token),
      refresh_token: cifrar(dados.refresh_token),
      expira_em: new Date(agora.getTime() + dados.expires_in * 1000),
      escopo: dados.scope ?? null,
      renovado_em: agora,
      modified_by: USUARIO_SISTEMA_ID,
    });
  });
}

/**
 * O access token pronto para uso, renovando se estiver perto de vencer.
 *
 * A dupla checagem dentro do lock nao e paranoia: quem esperou o lock quase
 * sempre esta esperando exatamente a renovacao que o outro acabou de fazer.
 * Sem reler, o segundo processo trocaria de novo — com o refresh que o primeiro
 * ja invalidou — e quebraria a integracao pelo caminho que o lock existe para
 * evitar.
 */
export async function tokenDeAcesso(): Promise<string> {
  const [atual] = await db
    .select()
    .from(integracoesCredenciais)
    .where(
      and(
        eq(integracoesCredenciais.canal, "mercado_livre"),
        eq(integracoesCredenciais.is_deleted, false),
      ),
    );

  if (!atual) throw new SemCredencialError();
  if (!precisaRenovar(atual.expira_em, new Date())) return decifrar(atual.access_token);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_REFRESH})`);

    const [dentroDoLock] = await tx
      .select()
      .from(integracoesCredenciais)
      .where(
        and(
          eq(integracoesCredenciais.canal, "mercado_livre"),
          eq(integracoesCredenciais.is_deleted, false),
        ),
      );

    if (!dentroDoLock) throw new SemCredencialError();

    // Outro processo renovou enquanto esperavamos: usa o dele e nao gasta o
    // refresh de novo.
    if (!precisaRenovar(dentroDoLock.expira_em, new Date())) {
      return decifrar(dentroDoLock.access_token);
    }

    const novo = await trocarRefreshToken(decifrar(dentroDoLock.refresh_token));
    const agora = new Date();

    await tx
      .update(integracoesCredenciais)
      .set({
        access_token: cifrar(novo.access_token),
        refresh_token: cifrar(novo.refresh_token),
        expira_em: new Date(agora.getTime() + novo.expires_in * 1000),
        escopo: novo.scope ?? dentroDoLock.escopo,
        conta_externa_id: novo.user_id ? String(novo.user_id) : dentroDoLock.conta_externa_id,
        renovado_em: agora,
        updated_at: agora,
        modified_by: USUARIO_SISTEMA_ID,
      })
      .where(eq(integracoesCredenciais.id, dentroDoLock.id));

    return novo.access_token;
  });
}
