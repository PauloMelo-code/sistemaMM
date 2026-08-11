/**
 * Permissoes por papel — e a regra de sigilo de custo (RN-107).
 *
 * ⚠️ SO A RN-107 ESTA CRAVADA. A matriz de `docs/rbac.md` e proposta, ainda nao
 * validada com o Anderson — por isso ela vive aqui, num lugar so, em vez de
 * espalhada em `if` pelas telas: quando a validacao vier, muda uma tabela.
 *
 * A REGRA QUE NAO SE NEGOCIA: **operador nao ve custo**, e o filtro e de
 * SERVIDOR. Esconder por CSS ou por `display: none` nao conta — o campo nao pode
 * chegar ao cliente, porque quem abre o DevTools ve o payload do React.
 *
 * ⚠️ E o vazamento nao e so a coluna `custo`: margem, lucro, lance maximo e
 * "pode aceitar ate R$ X" **revelam o custo por aritmetica**. Trate como CLASSE
 * de dado ("derivado de custo"), nunca como lista de colunas — ver known-issues.
 *
 * Modulo PURO: nao le banco, nao le cookie. Recebe papel e responde — por isso
 * a matriz inteira e testavel sem Postgres.
 */
import type { Papel } from "./sessao";

/** Recursos do sistema, na granularidade da matriz do `docs/rbac.md`. */
export type Recurso =
  | "lotes"
  | "itens"
  | "itens_custo"
  | "anuncios"
  | "perguntas"
  | "pedidos"
  | "pedidos_valores"
  | "calculadora"
  | "relatorios_margem"
  | "equipe"
  | "configuracoes"
  | "auditoria"
  | "site"
  | "integracoes";

export type Acao = "criar" | "ler" | "atualizar" | "deletar";

/**
 * A matriz. Ausencia = proibido.
 *
 * `consultoria` (a Orbital) so le: acompanha e da suporte, nao opera.
 */
const MATRIZ: Record<Recurso, Partial<Record<Papel, Acao[]>>> = {
  lotes: { administrador: ["criar", "ler", "atualizar", "deletar"], consultoria: ["ler"] },
  itens: {
    administrador: ["criar", "ler", "atualizar", "deletar"],
    operador: ["criar", "ler", "atualizar"],
    consultoria: ["ler"],
  },
  // RN-107: o operador NAO aparece aqui, e e o ponto inteiro da regra.
  itens_custo: { administrador: ["criar", "ler", "atualizar", "deletar"], consultoria: ["ler"] },
  anuncios: {
    administrador: ["criar", "ler", "atualizar", "deletar"],
    operador: ["criar", "ler", "atualizar"],
    consultoria: ["ler"],
  },
  perguntas: {
    administrador: ["criar", "ler", "atualizar", "deletar"],
    operador: ["criar", "ler", "atualizar"],
    consultoria: ["ler"],
  },
  pedidos: {
    administrador: ["criar", "ler", "atualizar", "deletar"],
    operador: ["criar", "ler", "atualizar"],
    consultoria: ["ler"],
  },
  pedidos_valores: { administrador: ["criar", "ler", "atualizar", "deletar"], consultoria: ["ler"] },
  calculadora: { administrador: ["criar", "ler", "atualizar", "deletar"], consultoria: ["ler"] },
  relatorios_margem: { administrador: ["ler"], consultoria: ["ler"] },
  equipe: { administrador: ["criar", "ler", "atualizar", "deletar"], consultoria: ["ler"] },
  configuracoes: { administrador: ["criar", "ler", "atualizar", "deletar"] },
  auditoria: { administrador: ["ler"], consultoria: ["ler"] },
  site: {
    administrador: ["criar", "ler", "atualizar", "deletar"],
    operador: ["criar", "ler", "atualizar"],
    consultoria: ["ler"],
  },
  integracoes: { administrador: ["criar", "ler", "atualizar", "deletar"], consultoria: ["ler"] },
};

/** Este papel pode fazer esta acao neste recurso? */
export function temPermissao(papel: Papel, recurso: Recurso, acao: Acao): boolean {
  return MATRIZ[recurso]?.[papel]?.includes(acao) ?? false;
}

/**
 * Este papel pode ver dinheiro derivado de custo? (RN-107)
 *
 * Atalho com nome proprio de proposito: `temPermissao(p, "itens_custo", "ler")`
 * espalhado pelo codigo e facil de escrever errado — e errar aqui e furar o
 * sigilo. Uma funcao com o nome da regra e mais dificil de usar por engano.
 */
export function podeVerCusto(papel: Papel): boolean {
  return temPermissao(papel, "itens_custo", "ler");
}

/**
 * Remove os campos derivados de custo de um objeto, no SERVIDOR.
 *
 * Use ao montar o payload de qualquer tela que o operador acesse: o campo nao
 * pode nem existir no objeto enviado. `Omit` no TypeScript nao basta — tipo nao
 * apaga dado em tempo de execucao, e o React serializa o que estiver la.
 */
export function semCusto<T extends Record<string, unknown>, C extends keyof T>(
  registro: T,
  campos: readonly C[],
): Omit<T, C> {
  const copia = { ...registro };
  for (const campo of campos) delete copia[campo];
  return copia;
}
