/**
 * Testes da matriz de permissoes — e da RN-107, que e a unica regra CRAVADA.
 *
 * Se um destes quebrar, a pergunta nao e "como ajusto o teste": e "quem mexeu no
 * sigilo de custo e por que". O operador ver custo nao e bug de UI — e quebra de
 * contrato com o cliente.
 *
 * Import com extensao `.ts` — mesma razao de `eventos.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { temPermissao, podeVerCusto, semCusto } from "./rbac.ts";

// -- a) RN-107: a regra que nao se negocia --------------------------------

test("RN-107: operador NAO ve custo, em nenhuma acao", () => {
  for (const acao of ["criar", "ler", "atualizar", "deletar"] as const) {
    assert.equal(
      temPermissao("operador", "itens_custo", acao),
      false,
      `operador nao pode "${acao}" em custo`,
    );
  }
  assert.equal(podeVerCusto("operador"), false);
});

test("RN-107 alcanca tudo que DERIVA de custo, nao so a coluna", () => {
  // Margem, lucro e preco alvo revelam o custo por aritmetica. Se o operador
  // pudesse abrir a calculadora ou o relatorio de margem, o sigilo seria teatro.
  assert.equal(temPermissao("operador", "calculadora", "ler"), false);
  assert.equal(temPermissao("operador", "relatorios_margem", "ler"), false);
  assert.equal(temPermissao("operador", "pedidos_valores", "ler"), false);
  assert.equal(temPermissao("operador", "lotes", "ler"), false, "lote carrega custo total");
});

test("administrador ve custo; consultoria le", () => {
  assert.equal(podeVerCusto("administrador"), true);
  assert.equal(podeVerCusto("consultoria"), true);
});

// -- b) o operador opera, e isso precisa continuar valendo -----------------

test("operador faz o dia a dia: itens, anuncios, perguntas, pedidos e site", () => {
  for (const recurso of ["itens", "anuncios", "perguntas", "pedidos", "site"] as const) {
    assert.equal(temPermissao("operador", recurso, "ler"), true, `${recurso}: deveria ler`);
    assert.equal(temPermissao("operador", recurso, "atualizar"), true, `${recurso}: deveria editar`);
  }
});

test("operador NAO deleta nada — exclusao e do administrador", () => {
  for (const recurso of ["itens", "anuncios", "perguntas", "pedidos", "site"] as const) {
    assert.equal(temPermissao("operador", recurso, "deletar"), false, `${recurso}: nao deleta`);
  }
});

// -- c) consultoria acompanha, nao opera ----------------------------------

test("consultoria so le, em todo recurso que alcanca", () => {
  const recursos = ["lotes", "itens", "anuncios", "perguntas", "pedidos", "site"] as const;
  for (const r of recursos) {
    assert.equal(temPermissao("consultoria", r, "ler"), true, `${r}: deveria ler`);
    for (const acao of ["criar", "atualizar", "deletar"] as const) {
      assert.equal(temPermissao("consultoria", r, acao), false, `${r}: nao pode "${acao}"`);
    }
  }
});

test("configuracoes sao so do administrador — nem a consultoria le", () => {
  assert.equal(temPermissao("administrador", "configuracoes", "atualizar"), true);
  assert.equal(temPermissao("consultoria", "configuracoes", "ler"), false);
  assert.equal(temPermissao("operador", "configuracoes", "ler"), false);
});

// -- d) ausencia = proibido ------------------------------------------------

test("recurso sem entrada para o papel devolve false, nunca true", () => {
  assert.equal(temPermissao("operador", "auditoria", "ler"), false);
  assert.equal(temPermissao("operador", "equipe", "ler"), false);
  assert.equal(temPermissao("operador", "integracoes", "ler"), false);
});

// -- e) o filtro de servidor: o campo nao pode CHEGAR ao cliente ----------

test("semCusto APAGA o campo — nao basta o TypeScript escondê-lo", () => {
  // `Omit` some em tempo de execucao: o React serializa o que estiver no
  // objeto, e quem abre o DevTools ve o payload. O dado tem que sumir de fato.
  const item = { id: "1", nome: "Autorrefrator", custo: "3300.00", preco_alvo: "7553.00" };
  const limpo = semCusto(item, ["custo", "preco_alvo"]);

  assert.equal("custo" in limpo, false, "a chave `custo` nao pode existir no objeto");
  assert.equal("preco_alvo" in limpo, false);
  assert.equal(JSON.stringify(limpo).includes("3300"), false, "o valor nao pode vazar no payload");
  assert.equal(limpo.nome, "Autorrefrator");
});

test("semCusto nao altera o objeto original", () => {
  const item = { id: "1", custo: "10.00" };
  semCusto(item, ["custo"]);
  assert.equal(item.custo, "10.00", "mutar a origem quebraria quem ainda precisa do custo");
});
