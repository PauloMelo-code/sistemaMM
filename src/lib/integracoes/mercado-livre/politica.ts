/**
 * Politica de retentativa e de espera do cliente do ML — a parte PURA.
 *
 * Separada de `client.ts` pelo mesmo motivo de `envelope.ts` e `retentativa.ts`:
 * aquele arquivo chega no banco (via `token.ts`) e um teste destas decisoes
 * passaria a exigir Postgres no ar.
 */

/** Quantas vezes a MESMA chamada e refeita antes de desistir. */
export const MAX_TENTATIVAS_HTTP = 3;

/** Teto da espera por 429, para nao travar um worker por horas. */
export const ESPERA_MAXIMA_MS = 60_000;

/**
 * Espera padrao quando o ML manda 429 sem dizer quanto esperar.
 *
 * Numero conservador e NAO uma cota estimada: a analise e explicita em nao
 * cravar limite por chute. Com ~50 itens e 2 usuarios o trafego normal nem
 * encosta na cota — quem estoura e loop nosso, e ai esperar 5s e barato.
 */
export const ESPERA_PADRAO_429_MS = 5_000;

/**
 * Status que vale a pena repetir.
 *
 * 4xx **nao** entra, com duas excecoes: 429 (o ML esta pedindo para esperar) e
 * 401 (token vencido, que o cliente resolve renovando e refazendo uma vez).
 * Repetir um 400 ou um 404 e queimar cota para receber o mesmo erro — e foi
 * assim que a analise descreveu o jeito mais comum de estourar o limite.
 */
export function deveRetentar(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/**
 * Quanto esperar segundo o cabecalho `Retry-After`.
 *
 * O HTTP permite duas formas: segundos ("120") ou data ("Wed, 21 Oct 2026
 * 07:28:00 GMT"). Tratar so a primeira faz a segunda virar `NaN` e, sem guarda,
 * um `setTimeout(NaN)` dispara IMEDIATAMENTE — o retry cego que o 429 existe
 * para impedir.
 *
 * `agora` entra por parametro para o teste nao depender de relogio.
 */
export function esperaDoRetryAfter(cabecalho: string | null, agora: Date = new Date()): number {
  if (!cabecalho) return ESPERA_PADRAO_429_MS;

  const texto = cabecalho.trim();

  const segundos = Number(texto);
  if (Number.isFinite(segundos)) {
    // Negativo ou zero viram a espera padrao: "pode tentar agora" depois de um
    // 429 e contraditorio, e obedecer literalmente reabriria o loop.
    return segundos > 0 ? Math.min(segundos * 1000, ESPERA_MAXIMA_MS) : ESPERA_PADRAO_429_MS;
  }

  const data = Date.parse(texto);
  if (Number.isNaN(data)) return ESPERA_PADRAO_429_MS;

  const diferenca = data - agora.getTime();
  return diferenca > 0 ? Math.min(diferenca, ESPERA_MAXIMA_MS) : ESPERA_PADRAO_429_MS;
}

/**
 * Espera exponencial entre tentativas de erro transitorio (5xx, rede).
 * 1a: 500ms · 2a: 1s · 3a: 2s. Sem jitter porque ha um cliente so; com varios
 * processos batendo junto, jitter passaria a importar.
 */
export function esperaBackoff(tentativa: number): number {
  return Math.min(500 * 2 ** (tentativa - 1), ESPERA_MAXIMA_MS);
}
