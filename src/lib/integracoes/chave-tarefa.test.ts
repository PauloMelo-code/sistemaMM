/**
 * Testes da chave de idempotencia do outbox (RN-116).
 *
 * `tarefas.ts` importa `db` e nao entra aqui; a funcao testada e reimportada
 * dele por caminho relativo com extensao — o `chaveTarefa` nao depende de banco.
 * Se um dia o arquivo crescer, ele se separa como `envelope.ts` fez.
 *
 * Por que este teste existe: a chave e o que decide se reprocessar um evento de
 * venda pausa o anuncio DE NOVO. Errar para o lado "colide sempre" faz a
 * segunda venda do mesmo item nunca pausar; errar para o lado "nunca colide"
 * faz a RN-104 pausar em duplicidade — que ela proibe por nome.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { chaveTarefa } from "./chave-tarefa.ts";

const base = {
  tipo: "pausar_anuncio" as const,
  referenciaId: "11111111-1111-1111-1111-111111111111",
  motivo: "pedido:aaaa",
};

test("mesma intencao gera a mesma chave — reprocessar o evento nao duplica", () => {
  assert.equal(chaveTarefa(base), chaveTarefa({ ...base }));
});

test("a chave NAO leva instante — senao toda reentrega viraria tarefa nova", () => {
  const chave = chaveTarefa(base);
  assert.ok(!/\d{13}/.test(chave), "nao pode ter timestamp embutido");
  assert.equal(chave, "pausar_anuncio:11111111-1111-1111-1111-111111111111:pedido:aaaa");
});

test("motivo diferente e tarefa diferente — venda de hoje x revenda daqui a meses", () => {
  // Sem o motivo na chave, "pausar o anuncio X" seria a mesma tarefa para
  // sempre: o item revendido no futuro nunca seria pausado de novo.
  assert.notEqual(chaveTarefa(base), chaveTarefa({ ...base, motivo: "pedido:bbbb" }));
});

test("alvo diferente e tarefa diferente", () => {
  assert.notEqual(
    chaveTarefa(base),
    chaveTarefa({ ...base, referenciaId: "22222222-2222-2222-2222-222222222222" }),
  );
});

test("tipo diferente e tarefa diferente — pausar nao e reativar", () => {
  assert.notEqual(chaveTarefa(base), chaveTarefa({ ...base, tipo: "reativar_anuncio" }));
});
