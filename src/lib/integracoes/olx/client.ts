/**
 * Portao unico da OLX — mesma disciplina do cliente do ML: ninguem chama a API
 * deles fora daqui.
 *
 * A API DA OLX TEM OUTRA FORMA, e as diferencas mudam o codigo:
 *
 *  - **Nao existe "pausar".** As operacoes sao `insert` e `delete`, so isso. A
 *    doc e explicita: o anuncio permanece publicado a menos que uma delecao seja
 *    enviada. Tirar do ar = APAGAR, e reanunciar depois e um `insert` novo, que
 *    perde id, posicao e visibilidade acumulada.
 *  - **E importacao em lote**, nao um recurso por chamada:
 *    `PUT /autoupload/import` com `{ access_token, ad_list: [...] }`.
 *  - **O token vai no CORPO**, nao no cabecalho `Authorization`.
 *  - **E assincrona.** A resposta traz `token` e `statusCode` (0 = aceito) — a
 *    publicacao (ou remocao) de fato acontece depois, com moderacao. "Aceito"
 *    nao e "ja saiu do ar".
 *
 * Endpoints conferidos na documentacao oficial em 2026-08-10
 * (developers.olx.com.br/anuncio/api/import.html).
 */
import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db";
import { integracoesCredenciais } from "@/lib/db/schema/integracoes-credenciais";

import { decifrar } from "../cofre";
import { ErroPermanente } from "../retentativa";

const BASE_PADRAO = "https://apps.olx.com.br";

/** Timeout de uma importacao. Lote pequeno, mas e um terceiro. */
const TIMEOUT_MS = 20_000;

export type OperacaoOlx = "insert" | "delete";

export interface AnuncioOlx {
  /** Id do anuncio no NOSSO controle (o `id` que a OLX associa ao nosso). */
  id: string;
  operation: OperacaoOlx;
}

export interface RespostaImportacao {
  token?: string;
  statusCode?: number;
  statusMessage?: string;
  errors?: unknown[];
}

export class ErroOlx extends Error {
  constructor(
    readonly statusHttp: number,
    readonly statusCode: number | undefined,
    detalhe: string,
  ) {
    super(`OLX recusou a importacao (HTTP ${statusHttp}, statusCode ${statusCode}): ${detalhe}`);
    this.name = "ErroOlx";
  }
}

/** O token da OLX, decifrado. Permanente quando nao ha credencial: falta setup. */
async function tokenOlx(): Promise<string> {
  const [credencial] = await db
    .select()
    .from(integracoesCredenciais)
    .where(
      and(eq(integracoesCredenciais.canal, "olx"), eq(integracoesCredenciais.is_deleted, false)),
    );

  if (!credencial) {
    throw new ErroPermanente(
      "Nao ha credencial da OLX. O app precisa ser autorizado com escopo `autoupload` na conta " +
        "da MM — e nem esta confirmado que a conta tem acesso a API (docs/known-issues.md 🔴).",
    );
  }
  return decifrar(credencial.access_token);
}

/**
 * Envia um lote de operacoes.
 *
 * `statusCode` diferente de 0 e recusa da OLX, mesmo com HTTP 200 — por isso a
 * checagem nao para no status HTTP. Tratar 200 como sucesso aqui faria a tarefa
 * ser marcada como feita enquanto o anuncio segue no ar.
 */
export async function importarOlx(adList: AnuncioOlx[]): Promise<RespostaImportacao> {
  const base = process.env.OLX_API_BASE ?? BASE_PADRAO;

  const resposta = await fetch(`${base}/autoupload/import`, {
    method: "PUT",
    headers: { "content-type": "application/json", accept: "application/json" },
    // O token vai no CORPO — e a forma da API deles, nao esquecimento.
    body: JSON.stringify({ access_token: await tokenOlx(), ad_list: adList }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const texto = await resposta.text().catch(() => "");
  let dados: RespostaImportacao = {};
  try {
    dados = texto ? (JSON.parse(texto) as RespostaImportacao) : {};
  } catch {
    throw new ErroOlx(resposta.status, undefined, `resposta ilegivel: ${texto.slice(0, 200)}`);
  }

  if (!resposta.ok || (dados.statusCode !== undefined && dados.statusCode !== 0)) {
    throw new ErroOlx(
      resposta.status,
      dados.statusCode,
      dados.statusMessage ?? texto.slice(0, 200),
    );
  }

  return dados;
}
