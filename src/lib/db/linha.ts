/**
 * `db.execute<T>` exige que `T` seja indexavel — a linha vem do driver sem
 * garantia de formato. Este alias satisfaz a exigencia **no ponto da chamada**,
 * sem contaminar o tipo de dominio.
 *
 * POR QUE NAO PUXAR `[coluna: string]: unknown` PARA DENTRO DO TIPO EXPORTADO
 * (que foi a primeira solucao, e estava errada): o tipo com assinatura de indice
 * aceita QUALQUER propriedade. `totais.faturamneto` — com erro de digitacao —
 * compilaria e chegaria `undefined` na tela, formatado como "R$ 0". Numa tela de
 * dinheiro isso e um numero errado com cara de certo, que e o pior defeito
 * possivel aqui.
 *
 * Uso:
 *   const linhas = await db.execute<LinhaSql<TotaisPedidos>>(sql`...`);
 */
export type LinhaSql<T> = T & Record<string, unknown>;
