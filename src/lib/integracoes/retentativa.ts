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

/**
 * Falha que NAO adianta repetir.
 *
 * "Pedido de outro vendedor", "ainda nao pago", "peca ja vendida": nenhuma
 * dessas muda por tentar de novo daqui a pouco. Sem esta distincao, cada uma
 * queimaria as 5 tentativas e ainda ficaria na fila como se houvesse esperanca —
 * enchendo de ruido justamente a lista que deveria mostrar o que precisa de
 * gente.
 *
 * O worker trata isto como CONCLUIDO com ressalva: `processado_em` preenchido
 * (nos olhamos e decidimos que nao ha o que fazer) e o motivo gravado em `erro`.
 */
export class ErroPermanente extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroPermanente";
  }
}

/**
 * Procura um codigo de erro do Postgres na cadeia de `cause`.
 *
 * O drizzle EMBRULHA o erro do driver: `err.code` no objeto de cima e
 * `undefined`, e o `23505` fica em `err.cause.code`. Testar so o nivel de cima
 * faz a violacao de indice unico escapar como erro generico — foi exatamente o
 * que aconteceu na primeira prova do handler de venda, e o operador via
 * "Failed query: insert into pedidos" em vez de "peca ja vendida".
 *
 * Anda a cadeia inteira porque o numero de camadas nao e contrato de ninguem.
 */
export function codigoPostgres(erro: unknown): string | null {
  let atual: unknown = erro;
  for (let profundidade = 0; atual && profundidade < 10; profundidade++) {
    const codigo = (atual as { code?: unknown }).code;
    if (typeof codigo === "string") return codigo;
    atual = (atual as { cause?: unknown }).cause;
  }
  return null;
}
