/**
 * Testes da escala de urgencia do SLA (RN-105, RN-105.1).
 *
 * Sem framework: `node:test` + `node:assert/strict`. Rodar: `npm test`.
 *
 * O caso que da nome a este arquivo e o ultimo teste: no prototipo, a pergunta
 * de 55min era pintada mais calma que a de 3h20. Se alguem mexer nos limites e
 * a inversao voltar, e ali que aparece.
 *
 * Import com extensao `.ts` de proposito — mesma razao explicada em
 * `pricing.test.ts`. Nao "conserte" para `./sla`, isso quebra o `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classificarSla,
  formatarDuracao,
  textoPrazo,
  ORDEM_ESTADO,
  META_SLA_HORAS,
  LIMITE_ATENCAO,
  LIMITE_URGENTE,
  type EstadoSla,
} from "./sla.ts";

const H = 3600;
const pendente = (segundosRestantes: number) => ({ segundosRestantes, respondida: false });

// -- a) os limites da RN-105.1, com a meta de 4h -----------------------------

test("com meta de 4h a escala e >2h neutro, 1-2h atencao, <1h urgente", () => {
  assert.equal(classificarSla(pendente(3.5 * H)), "neutro");
  assert.equal(classificarSla(pendente(2.5 * H)), "neutro");
  assert.equal(classificarSla(pendente(1.5 * H)), "atencao");
  assert.equal(classificarSla(pendente(0.5 * H)), "urgente");
});

test("as fronteiras pertencem ao estado mais calmo (limite e piso, nao teto)", () => {
  // Exatamente 50% da meta ainda e neutro; um segundo abaixo vira atencao.
  assert.equal(classificarSla(pendente(LIMITE_ATENCAO * META_SLA_HORAS * H)), "neutro");
  assert.equal(classificarSla(pendente(LIMITE_ATENCAO * META_SLA_HORAS * H - 1)), "atencao");
  // Idem em 25%.
  assert.equal(classificarSla(pendente(LIMITE_URGENTE * META_SLA_HORAS * H)), "atencao");
  assert.equal(classificarSla(pendente(LIMITE_URGENTE * META_SLA_HORAS * H - 1)), "urgente");
});

test("prazo estourado e vencido, e o zero ja conta como vencido", () => {
  assert.equal(classificarSla(pendente(0)), "vencido");
  assert.equal(classificarSla(pendente(-1)), "vencido");
  assert.equal(classificarSla(pendente(-3 * H)), "vencido");
});

// -- b) a escala acompanha a meta (RN-105: 4h e configuravel) ---------------

test("mudar a meta move os limites junto — a escala e relativa, nao horas cravadas", () => {
  // Com meta de 2h, 1h restante e exatamente 50%: ainda neutro.
  assert.equal(classificarSla(pendente(1 * H), 2), "neutro");
  // A mesma 1h com meta de 8h e 12,5%: urgente. Hora igual, urgencia diferente.
  assert.equal(classificarSla(pendente(1 * H), 8), "urgente");
});

// -- c) entrada quebrada nao pode virar pill calma ---------------------------

test("prazo invalido cai em urgente, nunca em neutro", () => {
  assert.equal(classificarSla(pendente(Number.NaN)), "urgente");
  assert.equal(classificarSla(pendente(Number.POSITIVE_INFINITY)), "urgente");
  assert.equal(classificarSla(pendente(2 * H), 0), "urgente"); // meta invalida
  assert.equal(classificarSla(pendente(2 * H), Number.NaN), "urgente");
});

test("respondida vence o prazo — inclusive quando respondida com atraso", () => {
  assert.equal(classificarSla({ segundosRestantes: -5 * H, respondida: true }), "respondida");
  assert.equal(classificarSla({ segundosRestantes: 3 * H, respondida: true }), "respondida");
});

// -- d) texto que vai para a pill -------------------------------------------

test("duracao trunca para o minuto e nunca arredonda prazo para cima", () => {
  assert.equal(formatarDuracao(3 * H + 20 * 60 + 45), "3h 20min");
  assert.equal(formatarDuracao(55 * 60), "55min");
  assert.equal(formatarDuracao(2 * H), "2h");
  assert.equal(formatarDuracao(30), "agora");
});

test("vencida troca a frase inteira", () => {
  assert.equal(textoPrazo(3 * H + 20 * 60), "3h 20min restantes");
  assert.equal(textoPrazo(-12 * 60), "vencida ha 12min");
  assert.equal(textoPrazo(Number.NaN), "prazo indefinido");
});

// -- e) o defeito original do prototipo, travado -----------------------------

test("a mais urgente nunca fica mais calma que a menos urgente (bug do prototipo)", () => {
  // Os tres cards do prototipo, na ordem em que apareciam na tela.
  const prototipo = [3 * H + 20 * 60, 2 * H, 55 * 60].map((s) => classificarSla(pendente(s)));

  // No prototipo saiam: vermelho, ambar, ambar — 3h20 gritando mais que 55min.
  // A regra certa e monotonica: menos tempo restante nunca e menos urgente.
  for (let i = 1; i < prototipo.length; i++) {
    assert.ok(
      ORDEM_ESTADO[prototipo[i]] <= ORDEM_ESTADO[prototipo[i - 1]],
      `${prototipo[i - 1]} -> ${prototipo[i]}: urgencia caiu com o tempo diminuindo`,
    );
  }

  // E, concretamente, a de 55min tem que ser a unica vermelha das tres. A de 2h
  // cai em `neutro` porque 2h de uma meta de 4h e exatamente 50% — a fronteira
  // pertence ao estado mais calmo (ver o teste de fronteiras acima).
  assert.deepEqual(prototipo, ["neutro", "neutro", "urgente"] satisfies EstadoSla[]);
});
