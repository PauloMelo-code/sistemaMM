/**
 * Passo 1 do OAuth: manda o Anderson para a tela de autorizacao do ML.
 *
 * COMO USAR: botao "Conectar Mercado Livre" no card da tela Integracoes. Depois
 * de aprovar na conta de vendedor da MM, o ML devolve para o `callback`, que
 * grava a credencial cifrada.
 *
 * QUEM PODE: so administrador (`integracoes` + `atualizar`). Conectar SUBSTITUI
 * a conta do ML do painel inteiro — o indice unico so permite uma credencial
 * ativa por canal. Ate 2026-10-29 o porteiro era um segredo na query string, do
 * tempo em que nao havia login; segredo em URL vaza em log de acesso, e quem o
 * lesse trocaria a conta da MM pela propria. Agora vale a sessao.
 *
 * Esta rota fica FORA do `proxy.ts` (matcher exclui `/api/integracoes`), entao
 * a checagem abaixo e a unica — e e a de verdade (`lerSessao` confere no banco).
 */
import { NextResponse } from "next/server";

import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao } from "@/lib/auth/sessao";
import {
  COOKIE_ESTADO,
  VALIDADE_ESTADO_MS,
  desafioDe,
  novoEstado,
  selarEstado,
  urlAutorizacao,
} from "@/lib/integracoes/mercado-livre/oauth";

export const runtime = "nodejs";

export async function GET() {
  const sessao = await lerSessao();
  if (!sessao || !temPermissao(sessao.papel, "integracoes", "atualizar")) {
    return NextResponse.json(
      { erro: "Só administrador conecta a conta do Mercado Livre." },
      { status: 403 },
    );
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

  // O estado vai em cookie CIFRADO, nao em sessao de servidor: cifrar reusa o
  // cofre das credenciais sem tabela nova.
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
