/**
 * Dispara UMA drenagem da fila de eventos e devolve o resumo.
 *
 * POR QUE UMA ROTA, E NAO UM DAEMON: onde o worker roda ainda e ADR aberto
 * (fila em Postgres x BullMQ/Redis, e em qual maquina — decisao do Lucas). Uma
 * rota que drena um lote nao responde essa pergunta no lugar dele: da para
 * chamar por cron, por curl, por agendador de plataforma. Um `setInterval` ou
 * um BullMQ aqui dentro ja teriam escolhido.
 *
 *   curl -X POST "https://SEU-DOMINIO/api/integracoes/worker?t=$WEBHOOK_SECRET"
 *
 * Enquanto nao houver credencial de canal, a resposta e sempre
 * `{ reivindicados: 0, aguardandoHandler: N }` — ninguem sabe processar nada
 * ainda, e os eventos ficam guardados. Isso e o esperado, nao uma falha.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { drenarEventos, LOTE_PADRAO } from "@/lib/integracoes/worker";

// `node:crypto` e o driver `pg` nao rodam no runtime edge.
export const runtime = "nodejs";

/**
 * Mesmo segredo do webhook, de proposito: sao a mesma superficie (endpoints de
 * integracao chamados por maquina) e um segundo segredo dobraria o que rotacionar
 * sem dobrar a protecao. Se um dia a rotina de rotacao separar as duas coisas,
 * ai sim vale um segredo proprio.
 */
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const segredoEsperado = process.env.WEBHOOK_SECRET;

  // Falha FECHADA, igual ao webhook: sem segredo configurado nao atende ninguem.
  if (!segredoEsperado) {
    console.error("[worker] WEBHOOK_SECRET nao configurada — recusando disparo");
    return NextResponse.json({ erro: "worker nao configurado" }, { status: 503 });
  }

  const url = new URL(request.url);
  if (!segredoConfere(url.searchParams.get("t") ?? "", segredoEsperado)) {
    // 404, nao 401: para quem varre a internet, a rota nao existe.
    return NextResponse.json({ erro: "nao encontrado" }, { status: 404 });
  }

  // `limite` invalido (texto, zero, negativo) cai no padrao em vez de virar erro
  // ou, pior, um `LIMIT NaN` — quem chama isto e cron, e cron nao le mensagem
  // de erro. Teto de 200 para uma chamada nao segurar a conexao indefinidamente.
  const pedido = Number(url.searchParams.get("limite"));
  const limite = Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, 200) : LOTE_PADRAO;

  try {
    const resumo = await drenarEventos({ limite });
    return NextResponse.json(resumo, { status: 200 });
  } catch (erro) {
    // Falha AQUI e falha de infraestrutura (banco fora, pool esgotado) — falha
    // de handler individual ja foi tratada dentro da drenagem e nao chega aqui.
    console.error("[worker] falha ao drenar a fila", erro);
    return NextResponse.json({ erro: "falha ao drenar" }, { status: 500 });
  }
}
