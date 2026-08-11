/**
 * Porta de entrada das notificacoes dos canais (RN-117).
 *
 * Faz exatamente tres coisas: valida a origem, grava UMA linha e responde 200.
 * Nao busca nada na API do canal, nao mexe em estoque, nao pausa anuncio. Esse
 * trabalho e do worker, depois, fora do request — porque o marketplace espera a
 * resposta em fracao de segundo e reentrega se demorar.
 *
 * O CORPO DO POST NAO E FONTE DE VERDADE. Esta URL e publica: qualquer um pode
 * postar "vendi o item X". O corpo so diz QUAL recurso olhar; o dado real vem de
 * um GET na API do canal com o nosso token — que ainda nao existe, porque nao ha
 * credencial (docs/known-issues.md 🔴). Ate la o evento fica gravado e
 * `processado_em` continua nulo. Nada e deduzido do que chegou.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { canalEnum } from "@/lib/db/schema/anuncios";
import { registrarEvento, TAMANHO_MAXIMO_CORPO } from "@/lib/integracoes/eventos";
import type { Canal } from "@/lib/pricing";

// `node:crypto` e o driver `pg` nao rodam no runtime edge.
export const runtime = "nodejs";

/**
 * O segredo viaja na query string (`?t=...`) porque e o unico canal que NOS
 * controlamos: o Mercado Livre nao assina notificacao e nao deixa configurar
 * cabecalho — so a URL de callback.
 *
 * CUSTO ASSUMIDO: segredo em URL aparece no log de acesso do nginx e em
 * qualquer proxy no caminho. Mitigacao: e rotacionavel (troca o `.env` e a URL
 * no portal do canal), e a defesa real nao depende dele — mesmo com o segredo
 * na mao, o corpo continua nao sendo fonte de verdade. Em producao, somar
 * allowlist de IP no nginx (registrado em known-issues).
 *
 * Quando algum canal aceitar cabecalho, ler dali de preferencia — e trocar este
 * comentario, nao acrescentar um segundo mecanismo "por garantia".
 */
const PARAM_SEGREDO = "t";

/** Comparacao em tempo constante, sem vazar o tamanho do segredo pelo digest. */
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

function ehCanal(valor: string): valor is Canal {
  return (canalEnum.enumValues as readonly string[]).includes(valor);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ canal: string }> },
) {
  const segredoEsperado = process.env.WEBHOOK_SECRET;

  // Falha FECHADA: sem segredo configurado o endpoint nao atende ninguem. O erro
  // oposto — abrir quando falta configuracao — deixaria a porta escancarada
  // exatamente no ambiente mal configurado.
  if (!segredoEsperado) {
    console.error("[webhook] WEBHOOK_SECRET nao configurada — recusando notificacao");
    return NextResponse.json({ erro: "webhook nao configurado" }, { status: 503 });
  }

  const recebido = new URL(request.url).searchParams.get(PARAM_SEGREDO) ?? "";
  if (!segredoConfere(recebido, segredoEsperado)) {
    // 404, nao 401: para quem varre a internet, a rota simplesmente nao existe.
    return NextResponse.json({ erro: "nao encontrado" }, { status: 404 });
  }

  const { canal } = await params;
  if (!ehCanal(canal)) {
    return NextResponse.json({ erro: "canal desconhecido" }, { status: 404 });
  }

  // `content-length` e dica, nao garantia — o teto real e conferido no texto
  // lido. Checar o cabecalho antes so evita ler um corpo grande a toa.
  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (declarado > TAMANHO_MAXIMO_CORPO) {
    return NextResponse.json({ erro: "corpo grande demais" }, { status: 413 });
  }

  const corpoCru = await request.text();
  if (Buffer.byteLength(corpoCru, "utf8") > TAMANHO_MAXIMO_CORPO) {
    return NextResponse.json({ erro: "corpo grande demais" }, { status: 413 });
  }

  try {
    const { novo, chave } = await registrarEvento({ canal, corpoCru });

    // Reentrega tambem responde 200: para o canal, "recebi" — e nada mais
    // executa deste lado. Devolver erro aqui provocaria nova reentrega em cima
    // de um evento que ja esta gravado.
    if (!novo) {
      console.info(`[webhook] ${canal}: reentrega ignorada (${chave.slice(0, 12)})`);
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (erro) {
    // Aqui o 500 e CORRETO, e a unica excecao ao "sempre 200": se nao
    // conseguimos gravar, responder 200 jogaria a notificacao fora em silencio.
    // O canal reentregar e o comportamento desejado — perder venda, nao.
    console.error(`[webhook] ${canal}: falha ao gravar evento`, erro);
    return NextResponse.json({ erro: "falha ao registrar" }, { status: 500 });
  }
}
