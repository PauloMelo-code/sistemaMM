/**
 * O PORTAO UNICO do Mercado Livre. Ninguem chama `fetch` na API do ML fora
 * daqui — mesma disciplina do `pricing.ts` com dinheiro.
 *
 * A razao nao e estetica. O 429 do ML e **do app inteiro**, nao da chamada: se
 * cada pedaco do codigo tiver seu proprio `fetch`, um loop de varredura estoura
 * a cota e as outras partes descobrem uma por uma, cada uma esperando por conta
 * propria. Com um portao so, o 429 pausa TODAS as chamadas de uma vez.
 *
 * DUAS LANES. `urgente` e o que veio de webhook (venda, pergunta com SLA de 4h
 * correndo). `varredura` e trabalho de fundo (reputacao, visitas, reconciliacao).
 * O dano real do 429 nunca foi a chamada que falhou — e a pergunta urgente
 * ficar atras de uma varredura de 300 itens.
 */
import { mascarar } from "../cofre";
import { tokenDeAcesso } from "./token";
import {
  MAX_TENTATIVAS_HTTP,
  deveRetentar,
  esperaBackoff,
  esperaDoRetryAfter,
} from "./politica";

export type Lane = "urgente" | "varredura";

/** Timeout de uma chamada. Sem isso, um ML lento segura um worker para sempre. */
const TIMEOUT_MS = 15_000;

/** Teto da espera da varredura pela lane urgente — evita fome da varredura. */
const ESPERA_MAXIMA_LANE_MS = 5_000;

/**
 * Estado do portao. Modulo-escopo de proposito: e o que faz a pausa valer para
 * o processo inteiro em vez de por chamada.
 *
 * ⚠️ Vale por PROCESSO. Com varias instancias da aplicacao, cada uma tem o seu
 * portao e o 429 e aprendido por cada uma separadamente. Para coordenar entre
 * instancias seria preciso estado compartilhado (tabela ou Redis) — registrado
 * em known-issues, nao resolvido aqui.
 */
let pausadoAte = 0;
let urgentesEmVoo = 0;

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Aplica a pausa compartilhada e a prioridade de lane antes de sair na rede. */
async function esperarVez(lane: Lane): Promise<void> {
  if (lane === "varredura") {
    const limite = Date.now() + ESPERA_MAXIMA_LANE_MS;
    while (urgentesEmVoo > 0 && Date.now() < limite) {
      await dormir(50);
    }
  }

  const restante = pausadoAte - Date.now();
  if (restante > 0) await dormir(restante);
}

export interface OpcoesChamada {
  /** Padrao `varredura`: quem nao declarou urgencia nao atropela quem declarou. */
  lane?: Lane;
  metodo?: "GET" | "POST" | "PUT";
  corpo?: unknown;
}

export class ErroML extends Error {
  constructor(
    readonly status: number,
    readonly corpo: string,
    caminho: string,
  ) {
    super(`Mercado Livre respondeu ${status} em ${caminho}: ${corpo.slice(0, 200)}`);
    this.name = "ErroML";
  }
}

/**
 * Chama a API do ML e devolve o JSON.
 *
 * O token entra no cabecalho e **nunca** aparece em log ou mensagem de erro —
 * quando precisa ser citado, vai por `mascarar()`. Log de erro com token e
 * credencial vazada em texto puro no arquivo de log.
 */
export async function chamarML<T = unknown>(
  caminho: string,
  { lane = "varredura", metodo = "GET", corpo }: OpcoesChamada = {},
): Promise<T> {
  const base = process.env.ML_API_BASE ?? "https://api.mercadolibre.com";
  const url = `${base}${caminho}`;

  if (lane === "urgente") urgentesEmVoo += 1;
  try {
    let renovouTokenUmaVez = false;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_HTTP; tentativa++) {
      await esperarVez(lane);

      const token = await tokenDeAcesso();

      let resposta: Response;
      try {
        resposta = await fetch(url, {
          method: metodo,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(corpo === undefined ? {} : { "content-type": "application/json" }),
          },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (erro) {
        // Rede caiu ou estourou o timeout: transitorio, vale repetir.
        if (tentativa === MAX_TENTATIVAS_HTTP) throw erro;
        await dormir(esperaBackoff(tentativa));
        continue;
      }

      if (resposta.ok) return (await resposta.json()) as T;

      // 401: token vencido apesar da renovacao proativa. Uma unica retentativa,
      // porque 401 que persiste depois de renovar nao e token — e escopo ou app
      // revogado, e repetir so queima cota.
      if (resposta.status === 401 && !renovouTokenUmaVez) {
        renovouTokenUmaVez = true;
        console.warn(`[ml] 401 em ${caminho} com token ${mascarar(token)} — renovando e refazendo`);
        continue;
      }

      if (resposta.status === 429) {
        // Pausa o PORTAO, nao so esta chamada: e o app inteiro que levou 429.
        const espera = esperaDoRetryAfter(resposta.headers.get("retry-after"));
        pausadoAte = Math.max(pausadoAte, Date.now() + espera);
        console.warn(`[ml] 429 em ${caminho} — portao pausado por ${espera}ms`);
        if (tentativa === MAX_TENTATIVAS_HTTP) {
          throw new ErroML(429, await resposta.text().catch(() => ""), caminho);
        }
        continue;
      }

      const texto = await resposta.text().catch(() => "");
      if (!deveRetentar(resposta.status) || tentativa === MAX_TENTATIVAS_HTTP) {
        throw new ErroML(resposta.status, texto, caminho);
      }
      await dormir(esperaBackoff(tentativa));
    }

    // Inalcancavel: o laco sempre retorna ou lanca. Existe para o TypeScript.
    throw new Error(`[ml] laco de tentativas terminou sem resposta em ${caminho}`);
  } finally {
    if (lane === "urgente") urgentesEmVoo -= 1;
  }
}

/** Zera o portao. **Só para teste** — nao chamar em codigo de producao. */
export function reiniciarPortao(): void {
  pausadoAte = 0;
  urgentesEmVoo = 0;
}
