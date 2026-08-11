/**
 * Testes do modulo de dinheiro (RN-100, RN-101, RN-102).
 *
 * Sem framework: `node:test` + `node:assert/strict`, nenhuma dependencia nova.
 * Rodar: `npm test`  (ou `node --test src/lib/pricing.test.ts`)
 *
 * Estes testes existem para FALHAR se alguem alterar a formula. Se um deles
 * quebrar, a pergunta certa nao e "como ajusto o teste" — e "quem mexeu no
 * calculo de preco e por que".
 *
 * O import e `./pricing.ts` COM extensao de proposito: o `node --test` do
 * `npm test` roda TS por type-stripping e so resolve com a extensao explicita
 * (`./pricing` e `./pricing.js` dao ERR_MODULE_NOT_FOUND). Em troca, o
 * `tsc --noEmit` reclama (TS5097) enquanto o tsconfig nao tiver
 * `"allowImportingTsExtensions": true`. Nao troque o import para "consertar" o
 * typecheck — isso quebra `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calcularPreco,
  lanceMaximo,
  formatarBRL,
  TAXA_CANAL,
  COMISSAO,
  D_MINIMO,
  SEM_VALOR,
  type Canal,
} from "./pricing.ts";

/** Centavo: tolerancia de ponto flutuante para comparacao de dinheiro. */
const TOL = 1e-9;

const canais: Canal[] = ["mercado_livre", "olx", "whatsapp"];

// -- a) o preco bate com a formula da RN-100 nos 3 canais -------------------

test("preco sugerido bate com base / (1 - taxa - comissao - margem) nos 3 canais", () => {
  const custo = 1200;
  const freteEntrada = 180;
  const freteSaida = 320; // envio ao comprador pago pela MM
  const margem = 0.25;
  const base = custo + freteEntrada + freteSaida;

  for (const canal of canais) {
    const esperado = base / (1 - TAXA_CANAL[canal] - COMISSAO - margem);
    const r = calcularPreco({ custo, freteEntrada, freteSaida, margem, canal });

    assert.equal(r.disponivel, true, `${canal}: deveria ser calculavel`);
    assert.ok(Math.abs(r.preco! - esperado) < TOL, `${canal}: preco fora da formula`);
    assert.ok(Math.abs(r.lucro! - esperado * margem) < TOL, `${canal}: lucro fora da formula`);
  }
});

test("taxas por canal sao as da RN-102 (ML 14%, OLX 5%, direta 0%) e comissao 4%", () => {
  assert.equal(TAXA_CANAL.mercado_livre, 0.14);
  assert.equal(TAXA_CANAL.olx, 0.05);
  assert.equal(TAXA_CANAL.whatsapp, 0);
  assert.equal(COMISSAO, 0.04);
});

test("frete entra na base: preco sobe exatamente frete/d", () => {
  const margem = 0.3;
  const d = 1 - TAXA_CANAL.olx - COMISSAO - margem;

  const semFrete = calcularPreco({ custo: 1000, freteEntrada: 0, freteSaida: 0, margem, canal: "olx" });
  const comFrete = calcularPreco({ custo: 1000, freteEntrada: 200, freteSaida: 0, margem, canal: "olx" });

  assert.ok(semFrete.disponivel && comFrete.disponivel);
  assert.ok(Math.abs(comFrete.preco - semFrete.preco - 200 / d) < TOL);
});

// -- a.1) O FRETE DE SAIDA — o custo que o sistema esquecia -----------------

test("frete de SAIDA entra na base igual ao de entrada (nao pode ser ignorado)", () => {
  const margem = 0.35;
  const canal = "mercado_livre" as const;
  const d = 1 - TAXA_CANAL[canal] - COMISSAO - margem;

  // Mesmo total de frete, distribuido de formas diferentes: o preco tem que ser
  // IDENTICO. Se alguem ignorar `freteSaida`, estes tres deixam de bater.
  const soEntrada = calcularPreco({ custo: 3300, freteEntrada: 680, freteSaida: 0, margem, canal });
  const soSaida = calcularPreco({ custo: 3300, freteEntrada: 0, freteSaida: 680, margem, canal });
  const dividido = calcularPreco({ custo: 3300, freteEntrada: 180, freteSaida: 500, margem, canal });

  assert.ok(soEntrada.disponivel && soSaida.disponivel && dividido.disponivel);
  assert.ok(Math.abs(soEntrada.preco - soSaida.preco) < TOL, "saida tem que pesar igual a entrada");
  assert.ok(Math.abs(soEntrada.preco - dividido.preco) < TOL, "o que importa e a soma dos fretes");

  // E o frete de saida move o preco na proporcao certa: freteSaida/d.
  const semNada = calcularPreco({ custo: 3300, freteEntrada: 0, freteSaida: 0, margem, canal });
  assert.ok(semNada.disponivel);
  assert.ok(Math.abs(soSaida.preco - semNada.preco - 680 / d) < TOL);
});

test("ignorar o frete de saida infla o LANCE MAXIMO — o erro caro do leilao", () => {
  const margem = 0.35;
  const canal = "mercado_livre" as const;
  const preco = 7500;
  const freteEntrada = 180;
  const freteSaida = 620; // autorrefrator ~40kg, Maringa -> Norte

  const certo = lanceMaximo({ preco, freteEntrada, freteSaida, margem, canal });
  const ignorandoSaida = lanceMaximo({ preco, freteEntrada, freteSaida: 0, margem, canal });

  assert.ok(certo !== null && ignorandoSaida !== null);
  // Quem esquece o frete de saida acha que pode dar um lance MAIOR do que pode.
  assert.ok(ignorandoSaida > certo, "esquecer o frete de saida infla o lance");
  assert.ok(
    Math.abs(ignorandoSaida - certo - freteSaida) < TOL,
    "a diferenca e exatamente o frete de saida — reais a mais no lance",
  );
});

// -- b) a identidade da RN-101 — o teste que protege a regra ----------------

// NOTA DE COBERTURA: este teste prova que o lucro REPORTADO e o liquido
// realmente apurado. Ele NAO trava sozinho a reescrita da formula — pela
// propria RN-101 as duas expressoes sao algebricamente iguais, entao ele
// continuaria verde. Quem trava a regressao da formula e o primeiro teste
// (preco bate com base/d) somado ao de duplo desconto, logo abaixo.
test("RN-101: o lucro reportado E o liquido apurado (preco - base - taxa - comissao)", () => {
  const casos = [
    { custo: 1200, freteEntrada: 180, freteSaida: 0, margem: 0.25, canal: "mercado_livre" as const },
    { custo: 8500, freteEntrada: 0, freteSaida: 0, margem: 0.4, canal: "olx" as const },
    { custo: 300, freteEntrada: 55, freteSaida: 0, margem: 0.1, canal: "whatsapp" as const },
    { custo: 47000, freteEntrada: 1200, freteSaida: 0, margem: 0.35, canal: "mercado_livre" as const },
    { custo: 0, freteEntrada: 90, freteSaida: 0, margem: 0.2, canal: "olx" as const },
  ];

  for (const { custo, freteEntrada, freteSaida, margem, canal } of casos) {
    const r = calcularPreco({ custo, freteEntrada, freteSaida, margem, canal });
    assert.ok(r.disponivel, `${canal}/${margem}: deveria ser calculavel`);

    const base = custo + freteEntrada + freteSaida;
    const lucroLiquido = r.preco - base - r.preco * TAXA_CANAL[canal] - r.preco * COMISSAO;

    // Se este assert falhar, alguem quebrou a RN-100 ou "corrigiu" a RN-101.
    assert.ok(
      Math.abs(lucroLiquido - r.lucro) < TOL * Math.max(1, r.preco),
      `${canal}/${margem}: lucro (${r.lucro}) != liquido apurado (${lucroLiquido})`,
    );
  }
});

test("RN-101: descontar custo e taxas DE NOVO do lucro da numero errado", () => {
  const custo = 1000;
  const freteEntrada = 100;
  const freteSaida = 250;
  const margem = 0.3;
  const r = calcularPreco({ custo, freteEntrada, freteSaida, margem, canal: "mercado_livre" });
  assert.ok(r.disponivel);

  // A "correcao" que a RN-101 proibe: pegar o lucro (que ja e liquido) e
  // descontar custo, fretes e taxas outra vez.
  const duploDesconto =
    r.lucro - (custo + freteEntrada + freteSaida) - r.preco * (TAXA_CANAL.mercado_livre + COMISSAO);

  assert.ok(r.lucro > 0, "o lucro correto e positivo");
  assert.ok(duploDesconto < 0, "o duplo desconto mostra prejuizo onde ha lucro");
  assert.ok(r.lucro - duploDesconto > 1, "os dois numeros nao podem coincidir");
});

// -- c) margem alta demais: indisponivel, sem NaN e sem excecao -------------

test("margem alta demais (d <= 0.05) devolve indisponivel, nao NaN nem excecao", () => {
  // ML: 1 - 0.14 - 0.04 - 0.83 = -0.01  → d negativo
  const negativo = calcularPreco({ custo: 1000, freteEntrada: 0, freteSaida: 0, margem: 0.83, canal: "mercado_livre" });
  assert.equal(negativo.disponivel, false);
  assert.equal(negativo.preco, null);
  assert.equal(negativo.lucro, null);

  // Direta: d no piso (1 - 0 - 0.04 - 0.91 = 0.05, a menos do erro de ponto
  // flutuante) → ainda indisponivel, porque o corte e `d <= D_MINIMO`.
  const noPiso = calcularPreco({ custo: 1000, freteEntrada: 0, freteSaida: 0, margem: 0.91, canal: "whatsapp" });
  assert.ok(Math.abs(1 - TAXA_CANAL.whatsapp - COMISSAO - 0.91 - D_MINIMO) < TOL);
  assert.equal(noPiso.disponivel, false);

  // Um fio acima do piso volta a ser calculavel — o corte e em d, nao arbitrario.
  const acimaDoPiso = calcularPreco({ custo: 1000, freteEntrada: 0, freteSaida: 0, margem: 0.9, canal: "whatsapp" });
  assert.equal(acimaDoPiso.disponivel, true);
  assert.ok(Number.isFinite(acimaDoPiso.preco!));
});

test("entrada invalida (NaN, negativa, margem >= 1) devolve indisponivel", () => {
  const invalidas = [
    { custo: Number.NaN, freteEntrada: 0, freteSaida: 0, margem: 0.2, canal: "olx" as const },
    { custo: 1000, freteEntrada: Number.NaN, freteSaida: 0, margem: 0.2, canal: "olx" as const },
    { custo: 1000, freteEntrada: 0, freteSaida: 0, margem: Number.NaN, canal: "olx" as const },
    { custo: -1, freteEntrada: 0, freteSaida: 0, margem: 0.2, canal: "olx" as const },
    { custo: 1000, freteEntrada: 0, freteSaida: 0, margem: 1, canal: "whatsapp" as const },
    // Margem NEGATIVA e o caso que so a guarda `m >= 0` pega: d = 1 - t - c + |m|
    // fica ACIMA de 1, escapa do piso D_MINIMO e sairia como preco ABAIXO do
    // custo com lucro negativo marcado `disponivel: true`. Sem este caso, apagar
    // `m >= 0` de `margemValida` nao quebra teste nenhum.
    { custo: 1000, freteEntrada: 0, freteSaida: 0, margem: -0.2, canal: "mercado_livre" as const },
    { custo: Number.POSITIVE_INFINITY, freteEntrada: 0, freteSaida: 0, margem: 0.2, canal: "olx" as const },
  ];

  for (const caso of invalidas) {
    const r = calcularPreco(caso);
    assert.equal(r.disponivel, false, `${JSON.stringify(caso)} deveria ser indisponivel`);
    assert.equal(r.preco, null);
  }
});

test("canal desconhecido nao vira NaN — sai indisponivel", () => {
  // Canal fora de TAXA_CANAL chega por caminho sem tipo: payload de webhook,
  // JSON de action, cast. A taxa vem undefined e d vira NaN. Sem a guarda
  // `!(d > D_MINIMO)`, NaN sairia como preco "disponivel" na tela de dinheiro.
  // (O tipo Canal usa os MESMOS literais do enum do banco, entao "whatsapp" e
  // valido; o fantasma aqui e um canal que nao existe em lado nenhum.)
  const fantasma = "site" as unknown as Canal;

  const r = calcularPreco({ custo: 1000, freteEntrada: 0, freteSaida: 0, margem: 0.3, canal: fantasma });
  assert.equal(r.disponivel, false);
  assert.equal(r.preco, null);
  assert.equal(lanceMaximo({ preco: 5000, freteEntrada: 0, freteSaida: 0, margem: 0.3, canal: fantasma }), null);
});

// -- d) leitura inversa: lance maximo realimentado reproduz o preco ---------

test("lance maximo realimentado em calcularPreco reproduz o preco de venda", () => {
  const freteEntrada = 150;
  const freteSaida = 480; // equipamento pesado: o envio pesa no lance
  const margem = 0.28;
  const preco = 9800;

  for (const canal of canais) {
    const custo = lanceMaximo({ preco, freteEntrada, freteSaida, margem, canal });
    assert.ok(custo !== null, `${canal}: deveria haver lance viavel`);

    const volta = calcularPreco({ custo, freteEntrada, freteSaida, margem, canal });
    assert.ok(volta.disponivel, `${canal}: ida e volta deveria ser calculavel`);
    assert.ok(
      Math.abs(volta.preco - preco) < TOL * preco,
      `${canal}: ida e volta nao fecha (${volta.preco} != ${preco})`,
    );
  }
});

test("lance maximo cai quando a margem exigida sobe", () => {
  const comum = { preco: 5000, freteEntrada: 100, freteSaida: 0, canal: "mercado_livre" as const };
  const folgado = lanceMaximo({ ...comum, margem: 0.15 });
  const apertado = lanceMaximo({ ...comum, margem: 0.35 });

  assert.ok(folgado !== null && apertado !== null);
  assert.ok(apertado < folgado, "margem maior tem que exigir lance menor");
});

test("lance maximo indisponivel: d no piso, ou preco que nem cobre o frete", () => {
  assert.equal(lanceMaximo({ preco: 5000, freteEntrada: 0, freteSaida: 0, margem: 0.91, canal: "whatsapp" }), null);
  // preco * d = 100 * 0.82 = 82 < frete 500 → nao ha lance viavel
  assert.equal(lanceMaximo({ preco: 100, freteEntrada: 500, freteSaida: 0, margem: 0.1, canal: "mercado_livre" }), null);
  assert.equal(lanceMaximo({ preco: Number.NaN, freteEntrada: 0, freteSaida: 0, margem: 0.2, canal: "olx" }), null);
});

// -- formatador (contrato com a UI) ----------------------------------------

test("formatarBRL: pt-BR sem centavos, e '—' quando nao ha valor", () => {
  assert.match(formatarBRL(12345.67), /^R\$\s?12\.346$/);
  assert.equal(formatarBRL(null), SEM_VALOR);
  assert.equal(formatarBRL(Number.NaN), SEM_VALOR);

  // Zero negativo nao pode virar "-R$ 0" — seria prejuizo exibido onde nao ha
  // valor nenhum. `-0` chega por JSON.parse("-0") / parseFloat("-0").
  assert.equal(formatarBRL(-0), formatarBRL(0));
  assert.ok(!formatarBRL(-0).includes("-"), "zero negativo nao pode exibir sinal");

  // O caminho que a UI realmente usa: resultado indisponivel vira "—".
  const r = calcularPreco({ custo: 1000, freteEntrada: 0, freteSaida: 0, margem: 0.95, canal: "mercado_livre" });
  assert.equal(formatarBRL(r.preco), SEM_VALOR);
});

test("soma custo+frete que estoura para Infinity sai indisponivel, nao Infinity", () => {
  // Cada parcela e finita e passa em valorValido; a SOMA e que estoura. Sem a
  // guarda de Number.isFinite no resultado, o contrato "disponivel => numero
  // valido" seria mentira e quem somasse/gravasse esse preco propagaria o lixo.
  const r = calcularPreco({
    custo: Number.MAX_VALUE,
    freteEntrada: Number.MAX_VALUE, freteSaida: 0,
    margem: 0.3,
    canal: "mercado_livre",
  });
  assert.equal(r.disponivel, false);
  assert.equal(r.preco, null);
  assert.equal(r.lucro, null);
});
