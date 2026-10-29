/**
 * Passo 2 do OAuth: a volta do Mercado Livre.
 *
 * Este e o `redirect_uri` cadastrado no portal do ML. Ele precisa ser
 * **estatico e identico** ao registrado — por isso nao carrega segredo nem
 * parametro nosso na URL. Quem protege esta rota e o `state`.
 *
 * O QUE O `state` IMPEDE: sem conferir, alguem inicia um fluxo com a propria
 * conta do ML, induz o Anderson a abrir o link de volta, e o painel termina
 * conectado a conta do atacante — que passa a receber as perguntas e os pedidos
 * da MM. Nao e teoria: e o CSRF classico de OAuth, e o `state` existe so por
 * causa dele.
 */
import { NextResponse } from "next/server";

import {
  COOKIE_ESTADO,
  abrirEstado,
  estadoConfere,
  trocarCodigoPorToken,
} from "@/lib/integracoes/mercado-livre/oauth";
import { salvarCredencial } from "@/lib/integracoes/mercado-livre/token";

export const runtime = "nodejs";

/** Resposta em texto: quem chega aqui e uma pessoa no navegador, nao um robo. */
function pagina(titulo: string, detalhe: string, status: number) {
  return new NextResponse(`${titulo}\n\n${detalhe}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // O ML avisa recusa pela propria URL de retorno (ex.: o usuario clicou em
  // "cancelar"). Nao e erro nosso — nao vale poluir log com stack.
  const erroDoMl = url.searchParams.get("error");
  if (erroDoMl) {
    return pagina(
      "Autorizacao nao concluida",
      `O Mercado Livre respondeu: ${erroDoMl}. ${url.searchParams.get("error_description") ?? ""}`,
      400,
    );
  }

  const guardado = abrirEstado(request.headers.get("cookie")?.match(
    new RegExp(`${COOKIE_ESTADO}=([^;]+)`),
  )?.[1]);

  if (!guardado) {
    return pagina(
      "Fluxo expirado ou invalido",
      "O cookie de estado nao existe mais (passou de 10 minutos, ou o navegador e outro). " +
        "Comece de novo pelo botao Conectar na tela Integracoes.",
      400,
    );
  }

  if (!estadoConfere(guardado, url.searchParams.get("state"))) {
    // Nao dizemos QUAL parte falhou: para quem esta atacando, tudo e "invalido".
    console.error("[oauth-ml] state divergente ou expirado — recusando o retorno");
    return pagina(
      "Autorizacao recusada",
      "O parametro de seguranca nao confere. Comece de novo pelo botao Conectar na tela Integracoes.",
      400,
    );
  }

  const codigo = url.searchParams.get("code");
  if (!codigo) {
    return pagina("Retorno sem codigo", "O Mercado Livre nao enviou o parametro `code`.", 400);
  }

  try {
    const dados = await trocarCodigoPorToken({ codigo, verifier: guardado.verifier });
    await salvarCredencial(dados);

    const resposta = pagina(
      "Mercado Livre conectado",
      `Conta ${dados.user_id ?? "(sem id)"} autorizada. O token foi gravado cifrado e sera ` +
        "renovado sozinho. Volte para a tela Integracoes do painel.",
      200,
    );
    // O estado e de uso unico: some assim que serve.
    resposta.cookies.delete(COOKIE_ESTADO);
    return resposta;
  } catch (erro) {
    // A mensagem de `TrocaDeTokenError` ja explica as duas causas comuns (PKCE
    // desligado no app, redirect_uri divergente) — vale mostrar para quem esta
    // na tela, porque quem esta na tela e quem consegue corrigir.
    console.error("[oauth-ml] falha ao trocar o code por token", erro);
    return pagina(
      "Falha ao concluir a autorizacao",
      erro instanceof Error ? erro.message : String(erro),
      500,
    );
  }
}
