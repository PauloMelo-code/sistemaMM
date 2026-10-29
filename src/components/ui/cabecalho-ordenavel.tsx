/**
 * Cabecalho de coluna clicavel para ordenar.
 *
 * Achado da auditoria: "Anuncios, Estoque e Pedidos — sem busca, ordenacao ou
 * acao por linha". Esta e a metade da ordenacao que mora na TELA; a outra
 * metade — a lista fechada de colunas que o banco aceita — mora em cada action,
 * de proposito (ver abaixo).
 *
 * ---------------------------------------------------------------------------
 * DECISOES QUE PARECEM DETALHE:
 *
 * - **A ordem vive na URL, nao em estado.** `/estoque?ordem=custo&dir=desc` e
 *   compartilhavel, sobrevive ao F5 e ao voltar do navegador. Estado em
 *   `useState` obrigaria "use client" numa tela que hoje e toda servidor.
 * - **`<Link>`, nao `<button>` com onClick.** Ordenar e navegar para outra
 *   vista da mesma lista: merece URL propria, abrir em nova aba e aparecer no
 *   historico. Botao dava nada disso.
 * - **`aria-sort` no `<th>`, nao no link.** O atributo pertence a CELULA de
 *   cabecalho pela especificacao; leitor de tela le "coluna Custo, ordenada
 *   decrescente" ao entrar na tabela.
 * - **O caret so aparece na coluna ativa.** Um indicador cinza em toda coluna
 *   vira ruido numa tabela de 8 colunas e some justamente quando importa.
 * ---------------------------------------------------------------------------
 *
 * ⚠️ A CHAVE NUNCA VIRA SQL AQUI. Ela viaja como texto na URL e a action a
 * resolve contra um mapa fechado de colunas. Se alguem um dia interpolar esta
 * string numa consulta, vira injecao — o mapa e a defesa, nao a origem.
 */
import Link from "next/link";

export type Direcao = "asc" | "desc";

interface Props {
  /** Texto visivel da coluna. */
  rotulo: string;
  /** Chave de ordenacao — tem de existir no mapa da action. */
  chave: string;
  /** Caminho da tela, ex.: `/estoque`. */
  base: string;
  /** Chave ordenada agora, se houver. */
  ordemAtual?: string;
  direcaoAtual?: Direcao;
  /**
   * Filtros a PRESERVAR ao trocar a ordem. Sem isto, ordenar zeraria o filtro
   * de segmento ou o mes escolhido — e a pessoa perderia o recorte no clique.
   */
  parametros?: Record<string, string | undefined>;
  /** Colunas de dinheiro sao alinhadas a direita; o caret acompanha. */
  direita?: boolean;
  className?: string;
}

export function CabecalhoOrdenavel({
  rotulo,
  chave,
  base,
  ordemAtual,
  direcaoAtual = "asc",
  parametros = {},
  direita = false,
  className = "",
}: Props) {
  const ativa = ordemAtual === chave;
  // Clicar na coluna ja ativa INVERTE; clicar numa nova comeca crescente.
  const proximaDirecao: Direcao = ativa && direcaoAtual === "asc" ? "desc" : "asc";

  const busca = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v) busca.set(k, v);
  busca.set("ordem", chave);
  busca.set("dir", proximaDirecao);

  return (
    <th
      scope="col"
      aria-sort={ativa ? (direcaoAtual === "asc" ? "ascending" : "descending") : "none"}
      className={`px-2 py-2.5 font-normal ${direita ? "text-right" : ""} ${className}`}
    >
      <Link
        href={`${base}?${busca.toString()}`}
        className={`inline-flex items-center gap-1 rounded-button px-1 py-0.5 transicao-cor hover:text-ink foco ${
          direita ? "flex-row-reverse" : ""
        } ${ativa ? "text-ink" : ""}`}
      >
        {rotulo}
        {/* `aria-hidden`: o estado ja foi dado por `aria-sort` no `<th>`. Repetir
            aqui faria o leitor de tela anunciar a ordenacao duas vezes. */}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`size-2.5 shrink-0 ${ativa ? "opacity-100" : "opacity-0"}`}
        >
          <path d={direcaoAtual === "asc" && ativa ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </Link>
    </th>
  );
}

/**
 * Resolve `?ordem=&dir=` contra a lista fechada de colunas de cada tela.
 *
 * Chave ausente ou desconhecida vira `undefined`, nunca uma coluna: quem decide
 * a ordem padrao e o `default` da action (Pedidos: venda mais recente; Anuncios:
 * mais visitas). Devolver uma coluna "padrao" aqui fazia esse ramo nunca rodar —
 * Pedidos abria em ordem de numero e Anuncios com os MENOS vistos no topo.
 */
export function lerOrdem<T extends string>(
  permitidas: readonly T[],
  ordem?: string,
  dir?: string,
): { ordem: T | undefined; direcao: Direcao } {
  const chave = permitidas.find((p) => p === ordem);
  return { ordem: chave, direcao: dir === "desc" ? "desc" : "asc" };
}
