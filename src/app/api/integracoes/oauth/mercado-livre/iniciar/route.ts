/**
 * Passo 1 do OAuth: manda o Anderson para a tela de autorizacao do ML.
 *
 * COMO USAR: abrir no navegador, uma vez, com o segredo na URL —
 *   https://SEU-DOMINIO/api/integracoes/oauth/mercado-livre/iniciar?t=$WEBHOOK_SECRET
 * Depois de aprovar na conta de vendedor da MM, o ML devolve para o `callback`,
 * que grava a credencial cifrada.
 *
 * POR QUE TEM SEGREDO AQUI: nao existe autenticacao no sistema
 * (docs/known-issues.md 🔴). Sem porteiro, qualquer um dispararia o fluxo e
 * conectaria a PROPRIA conta do ML ao painel — o indice unico so permite uma
 * credencial ativa por canal, entao a dele substituiria a da MM. Quando o login
 * existir, isto vira "so administrador" e o segredo sai.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  COOKIE_ESTADO,
  VALIDADE_ESTADO_MS,
  desafioDe,
  novoEstado,
  selarEstado,
  urlAutorizacao,
} from "@/lib/integracoes/mercado-livre/oauth";

export const runtime = "nodejs";

function segredoConfere(recebido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const segredoEsperado = process.env.WEBHOOK_SECRET;
  if (!segredoEsperado) {
    return NextResponse.json({ erro: "integracao nao configurada" }, { status: 503 });
  }

  const url = new URL(request.url);
  if (!segredoConfere(url.searchParams.get("t") ?? "", segredoEsperado)) {
    return NextResponse.json({ erro: "nao encontrado" }, { status: 404 });
  }

  const clientId = process.env.ML_CLIENT_ID;
  const redirectUri = process.env.ML_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        erro:
          "ML_CLIENT_ID e ML_REDIRECT_URI precisam estar definidas. O app ainda nao foi " +
          "registrado no portal de developers do ML (docs/known-issues.md 🔴).",
      },
      { status: 503 },
    );
  }

  const estado = novoEstado();

  const resposta = NextResponse.redirect(
    urlAutorizacao({
      clientId,
      redirectUri,
      estado: estado.estado,
      challenge: desafioDe(estado.verifier),
    }),
  );

  // O estado vai em cookie CIFRADO, nao em sessao de servidor: nao ha sessao
  // nesta base ainda, e cifrar reusa o cofre das credenciais sem tabela nova.
  resposta.cookies.set(COOKIE_ESTADO, selarEstado(estado), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // `lax` e obrigatorio aqui: com `strict` o navegador NAO manda o cookie na
    // volta do ML, porque a navegacao vem de outro site — e o fluxo morre sem
    // explicacao nenhuma.
    sameSite: "lax",
    path: "/api/integracoes/oauth",
    maxAge: VALIDADE_ESTADO_MS / 1000,
  });

  return resposta;
}
