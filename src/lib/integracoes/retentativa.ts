/**
 * Politica de retentativa do worker — a parte PURA, sem banco.
 *
 * Separado de `worker.ts` pelo mesmo motivo que `envelope.ts` e separado de
 * `eventos.ts`: aquele arquivo importa `db`, e importar `db` instancia um Pool
 * do Postgres na avaliacao do modulo. Um teste destas funcoes passaria a exigir
 * banco no ar so para carregar o arquivo.
 */

/**
 * Quantas vezes um evento e tentado antes de ser deixado de lado.
 *
 * Esgotado NAO e deletado nem marcado como processado: fica pendente com `erro`
 * preenchido e `tentativas` no teto, fora da fila (a consulta do worker filtra
 * por `tentativas < MAX`). E o equivalente a uma DLQ sem tabela extra — e o que
 * a tela de Integracoes vai listar como "falhou, precisa de gente".
 */
export const MAX_TENTATIVAS = 5;

/**
 * O evento acabou de gastar a ultima tentativa?
 *
 * Recebe o valor JA INCREMENTADO pela reivindicacao — por isso a comparacao e
 * `>=` e nao `>`. Com o teto em 5, a quinta tentativa e a ultima: `esgotou(5)`
 * e verdadeiro, e o evento nao volta para a fila.
 */
export function esgotou(tentativas: number): boolean {
  return tentativas >= MAX_TENTATIVAS;
}

/**
 * Mensagem legivel de qualquer coisa que tenha sido lancada.
 *
 * Guarda o `stack` quando existe: o texto vai para a coluna `erro` e e o unico
 * material de diagnostico de uma falha que aconteceu de madrugada, sem ninguem
 * olhando. `String(erro)` sozinho num objeto vira "[object Object]", que nao
 * ajuda ninguem.
 */
export function descreverErro(erro: unknown): string {
  if (erro instanceof Error) return erro.stack ?? `${erro.name}: ${erro.message}`;
  return String(erro);
}
