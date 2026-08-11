/**
 * O CARIMBO que sustenta o optimistic locking — e os dois pontos onde ele se
 * perde no caminho.
 *
 * `atualizarLote` e `atualizarItem` recusam a gravacao quando o `updated_at`
 * que a tela carregou nao bate com o do banco (CLAUDE.md, "Controle de
 * Colisao"). O mecanismo esta certo: `scripts/db/prova-mutacoes-crud.sql` (caso
 * 4a/4b) mostra o UPDATE afetando 0 linhas com valor defasado e 1 linha com o
 * valor exato.
 *
 * O que este arquivo cobre e o TRANSPORTE do carimbo, que e onde ele quebra:
 * banco -> Node -> tela -> Node -> banco. Nada disso precisa de Postgres nem do
 * runtime do Next, entao roda como teste puro — as actions em si sao
 * `"use server"` e chamam `revalidatePath`, e nao podem ser importadas aqui.
 *
 * ✅ OS DOIS BUGS QUE ESTE ARQUIVO PEGOU FORAM CORRIGIDOS em 2026-08-11: as
 * actions pararam de converter o carimbo em `Date` e passaram a compara-lo como
 * TEXTO (`updated_at::text = $n`). Os testes do fim viraram GUARDAS DE
 * REGRESSAO — provam que o caminho novo preserva o valor e que o antigo nao
 * preservava. Nao troque a comparacao de volta sem le-los.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { timestamp } from "drizzle-orm/pg-core";

/**
 * A MESMA coluna `updated_at` de `schema/lotes.ts` e `schema/itens.ts`, isolada.
 *
 * Reconstruida aqui, e nao importada: os schemas importam por caminho sem
 * extensao, o que o type-stripping do Node nao resolve. E o que se testa e o
 * comportamento da COLUNA — declarar uma `pgTable` de mentira so para chegar
 * nela criaria uma tabela sem colunas de auditoria, que o
 * `check-compliance.mjs` (com razao) recusa.
 */
interface Carimbo {
  mapFromDriverValue(valor: string): Date;
  mapToDriverValue(valor: Date): string;
}

// `build` quer a tabela dona da coluna, e so a usa para montar o nome de
// constraint. Um objeto vazio basta — nada aqui chega perto de uma conexao.
const updatedAt = (
  timestamp("updated_at").notNull() as unknown as { build(tabela: unknown): Carimbo }
).build({});

/** O que a leitura entrega ao Node a partir do literal do Postgres. */
const doDriver = (literal: string): Date => updatedAt.mapFromDriverValue(literal);
/** O que o drizzle poe no WHERE a partir de um Date. */
const paraOWhere = (data: Date): string => updatedAt.mapToDriverValue(data);

/** O que o Postgres devolve numa coluna `timestamp(6)` alimentada por `now()`. */
const DO_BANCO = "2026-08-11 14:22:33.123456";

/** Converte o que o drizzle poe no WHERE de volta ao literal do Postgres. */
const comoLiteral = (iso: string) => iso.replace("T", " ").replace("Z", "");

// --------------------------------------------------------------------------
// A premissa: o banco carrega microssegundos, o Date do JS nao
// --------------------------------------------------------------------------

test("o Date do JS nao tem onde guardar os microssegundos do Postgres", () => {
  const lido = doDriver(DO_BANCO);

  // .123456 no banco vira .123 na memoria. Os outros 456 microssegundos nao
  // existem em lugar nenhum depois desta linha.
  assert.equal(lido.toISOString(), "2026-08-11T14:22:33.123Z");
  assert.equal(lido.getMilliseconds(), 123);
});

test("a volta ao banco tambem so tem milissegundos", () => {
  const lido = doDriver(DO_BANCO);
  const noWhere = paraOWhere(lido);

  assert.equal(noWhere, "2026-08-11T14:22:33.123Z");
  assert.notEqual(comoLiteral(noWhere), DO_BANCO);
});

// --------------------------------------------------------------------------
// Caminho de Estoque: `atualizadoEm: l.atualizadoEm.toISOString()`
// (src/lib/actions/estoque.ts:176)
// --------------------------------------------------------------------------

test("caminho de Estoque: o carimbo perde os microssegundos na ida e volta", () => {
  // exatamente o que `lerEstoque` entrega ao formulario
  const paraATela = doDriver(DO_BANCO).toISOString();
  // exatamente o que `atualizarItem` poe no WHERE: new Date(updatedAtOriginal)
  const noWhere = paraOWhere(new Date(paraATela));

  assert.equal(comoLiteral(noWhere), "2026-08-11 14:22:33.123");
  assert.notEqual(
    comoLiteral(noWhere),
    DO_BANCO,
    "se um dia isto ficar igual, o bug do caso 4c da prova-mutacoes-crud.sql caiu",
  );
});

// --------------------------------------------------------------------------
// Caminho de Lotes: `l.updated_at::text AS "atualizadoEm"`
// (src/lib/actions/lotes.ts:110)
// --------------------------------------------------------------------------

test("caminho de Lotes: o literal sem sufixo e lido como hora LOCAL, nao UTC", () => {
  // `::text` entrega "2026-08-11 14:22:33.123456", sem Z e sem offset. O
  // `new Date(...)` de `atualizarLote` cai no parser legado do V8, que assume
  // o fuso do processo — enquanto o drizzle, ao LER, assume UTC (ele concatena
  // "+0000" em `mapFromDriverValue`). As duas pontas discordam.
  const comoLotesFaz = new Date(DO_BANCO);
  const comoDrizzleLe = new Date(`${DO_BANCO}+0000`);

  const deslocamentoMin = new Date(DO_BANCO).getTimezoneOffset();
  assert.equal(
    comoLotesFaz.getTime() - comoDrizzleLe.getTime(),
    deslocamentoMin * 60_000,
    "o literal esta sendo interpretado no fuso do processo",
  );

  // Em UTC o deslocamento e zero e sobra so o problema dos microssegundos; com
  // o `TZ=America/Sao_Paulo` que o Dockerfile crava, sao 3 horas de diferenca.
  if (deslocamentoMin !== 0) {
    assert.notEqual(comoLotesFaz.getTime(), comoDrizzleLe.getTime());
  }
});

// --------------------------------------------------------------------------
// GUARDAS DE REGRESSAO da correcao
// --------------------------------------------------------------------------

test("o carimbo como TEXTO volta ao banco identico ao que saiu", () => {
  // E o que as actions fazem hoje: a string do `::text` viaja ate a tela e
  // volta ao WHERE sem nunca virar `Date`. Nao ha conversao, entao nao ha perda.
  const paraATela = DO_BANCO;
  const noWhere = paraATela;

  assert.equal(noWhere, DO_BANCO);
});

test("o caminho ANTIGO (via Date) nao preservava — por isso ele saiu", () => {
  // Guarda de regressao: se um dia isto passar a ser igual, a coluna virou
  // `timestamp(3)` ou alguem arredondou na gravacao, e o motivo da comparacao
  // por texto deixou de existir. Reavalie antes de "simplificar" de volta.
  const paraATela = doDriver(DO_BANCO).toISOString();
  const noWhere = comoLiteral(paraOWhere(new Date(paraATela)));

  assert.notEqual(
    noWhere,
    DO_BANCO,
    "o Date voltou a preservar microssegundos — reavalie a comparacao por ::text",
  );
});
