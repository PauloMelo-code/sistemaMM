/**
 * Dispara UMA passada de reconciliacao e devolve o resumo.
 *
 *   curl -X POST "https://SEU-DOMINIO/api/integracoes/reconciliar?t=$WEBHOOK_SECRET"
 *
 * ROTA SEPARADA DO WORKER, de proposito: sao cadencias e custos diferentes. O
 * dreno e barato e quer rodar de minuto em minuto; a reconciliacao pagina a API
 * do canal e quer rodar a cada 15-30 min. Juntar as duas faria a cara rodar na
 * frequencia da barata — que e justamente como se estoura cota do ML sem
 * trafego real.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { atualizarEnviosPendentes } from "@/lib/integracoes/mercado-livre/atualizacao-envios";
import { reconciliarPedidosML } from "@/lib/integracoes/mercado-livre/reconciliacao";

export const runtime = "nodejs";

function segredoConfere(recebido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const segredoEsperado = process.env.WEBHOOK_SECRET;
  if (!segredoEsperado) {
    return NextResponse.json({ erro: "integracao nao configurada" }, { status: 503 });
  }

  const url = new URL(request.url);
  if (!segredoConfere(url.searchParams.get("t") ?? "", segredoEsperado)) {
    return NextResponse.json({ erro: "nao encontrado" }, { status: 404 });
  }

  // Status de envio dos pedidos em aberto. Independente da reconciliacao: uma
  // falha numa nao impede a outra, e os dois resultados voltam na resposta.
  const envios = await atualizarEnviosPendentes().catch((erro) => {
    console.error("[envios] falhou", erro);
    return { erro: erro instanceof Error ? erro.message : String(erro) };
  });

  try {
    return NextResponse.json({ ...(await reconciliarPedidosML()), envios }, { status: 200 });
  } catch (erro) {
    // O desfecho ja foi gravado em `integracoes_sincronizacoes` — inclusive o
    // erro — entao o alarme de obsolescencia enxerga a falha mesmo que ninguem
    // leia esta resposta. Que e o caso de um cron.
    console.error("[reconciliacao] falhou", erro);
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 },
    );
  }
}
