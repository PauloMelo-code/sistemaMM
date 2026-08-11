/**
 * Healthcheck — `GET /api/saude`.
 *
 * POR QUE EXISTE: o deploy terminava no start do processo e nada conferia se a
 * aplicacao respondia. App que sobe e morre em 2 segundos (falta de variavel,
 * porta ocupada, migracao pela metade) dava deploy VERDE, e quem descobria era
 * o Anderson tentando entrar — ou o Mercado Livre, que suspende as notificacoes
 * da aplicacao inteira depois de falhas seguidas.
 *
 * PUBLICA E SEM SEGREDO, de proposito: quem consulta e o Docker, o EasyPanel e
 * um robo de uptime, nenhum deles com cookie. Por isso ela nao pode revelar
 * nada — sem versao, sem nome de host, sem contagem de tabela. So "de pe" ou
 * "no chao".
 *
 * ⚠️ O `SELECT 1` NAO E DECORACAO. Sem tocar o banco, a rota responderia 200
 * com o Postgres fora do ar — e "saudavel" passaria a significar "o Node esta
 * vivo", que e justamente a informacao inutil. Toda tela deste painel e uma
 * consulta; app sem banco nao serve para nada.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

// Nunca cachear: healthcheck cacheado responde "de pe" sobre o passado.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    // O erro NAO vai no corpo: a mensagem do driver carrega host, porta e as
    // vezes usuario do banco, e esta rota e publica.
    return Response.json({ ok: false }, { status: 503 });
  }
}
