/**
 * Testes do mapeamento da pergunta do ML. O ponto que mais importa: o prazo do
 * SLA sai da hora em que o COMPRADOR perguntou, nunca da hora da importacao.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { META_SLA_HORAS } from "../../sla.ts";
import {
  idDaPergunta,
  lerPaginaPerguntas,
  lerPerguntaML,
  perguntaEncerradaNoML,
  PerguntaMLInvalidaError,
} from "./pergunta-ml.ts";

const pendente = () => ({
  id: 13456789012,
  item_id: "MLB7586103928",
  seller_id: 3606841202,
  status: "UNANSWERED",
  text: "Vem com licença ativa?",
  date_created: "2026-10-29T10:00:00.000-03:00",
  answer: null,
});

test("pendente: prazo = pergunta + meta do SLA", () => {
  const p = lerPerguntaML(pendente());
  assert.ok(p);
  assert.equal(p.idExterno, "13456789012");
  assert.equal(p.idAnuncio, "MLB7586103928");
  assert.equal(p.status, "pendente");
  assert.equal(p.prazoSla.getTime() - p.feitaEm.getTime(), META_SLA_HORAS * 3600 * 1000);
  assert.equal(p.resposta, null);
});

test("respondida traz texto e hora da resposta", () => {
  const p = lerPerguntaML({
    ...pendente(),
    status: "ANSWERED",
    answer: { text: "Sim, 5 funções.", status: "ACTIVE", date_created: "2026-10-29T11:00:00.000-03:00" },
  });
  assert.ok(p);
  assert.equal(p.status, "respondida");
  assert.equal(p.resposta, "Sim, 5 funções.");
  assert.equal(p.respondidaEm?.toISOString(), "2026-10-29T14:00:00.000Z");
});

test("status que nao pede acao fica de fora", () => {
  for (const status of ["CLOSED_UNANSWERED", "BANNED", "DELETED", "UNDER_REVIEW"]) {
    assert.equal(lerPerguntaML({ ...pendente(), status }), null);
  }
});

test("encerrada no ML: excluida, banida, fechada; em revisao nao (e passageiro)", () => {
  for (const status of ["DELETED", "BANNED", "CLOSED_UNANSWERED", "DISABLED"]) {
    assert.equal(perguntaEncerradaNoML({ ...pendente(), status }), true, status);
  }
  for (const status of ["UNANSWERED", "ANSWERED", "UNDER_REVIEW"]) {
    assert.equal(perguntaEncerradaNoML({ ...pendente(), status }), false, status);
  }
  assert.equal(idDaPergunta(pendente()), "13456789012");
});

test("sem data recusa — prazo de SLA nao se inventa", () => {
  assert.throws(() => lerPerguntaML({ ...pendente(), date_created: undefined }), PerguntaMLInvalidaError);
  assert.throws(() => lerPerguntaML({ ...pendente(), item_id: null }), PerguntaMLInvalidaError);
});

test("pagina sem `questions` recusa", () => {
  assert.equal(lerPaginaPerguntas({ questions: [{}], total: 7 }).total, 7);
  assert.throws(() => lerPaginaPerguntas({}), PerguntaMLInvalidaError);
});
