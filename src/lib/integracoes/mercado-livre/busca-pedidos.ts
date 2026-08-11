/**
 * QUARENTENA da busca de pedidos do ML — parte PURA (sem rede, sem banco).
 *
 * ⚠️ O QUE ESTA CONFIRMADO na doc: `/orders/search` existe, exige pelo menos um
 * filtro, aceita `seller`, `sort` (`date_asc` / `date_desc`) e paginacao por
 * `offset`/`limit`.
 *
 * ⚠️ O QUE **NAO** ESTA CONFIRMADO: o nome do parametro de filtro por data. As
 * fontes que achei citam formatos de wrappers de terceiros, nao da doc oficial.
 *
 * POR ISSO O CORTE E NOSSO, NAO DO SERVIDOR: pedimos em ordem decrescente de
 * data e paramos de paginar ao alcancar pedido mais antigo que a marca d'agua.
 * Usa so o que esta confirmado e nao depende de adivinhacao. Custa algumas
 * paginas a mais — irrelevante no volume da MM. Quando o parametro for
 * confirmado contra a conta real, ele entra aqui e vira otimizacao; o resto do
 * codigo nao muda.
 */

/** Teto de paginas por passada. Impede varredura infinita e cota queimada. */
export const MAX_PAGINAS = 10;

/** Tamanho da pagina. */
export const TAMANHO_PAGINA = 50;

/**
 * A URL de uma pagina da busca.
 *
 * `sort=date_desc` NAO e preferencia: e o que faz o corte por marca d'agua
 * funcionar. Em ordem crescente, os pedidos novos viriam por ultimo e seria
 * preciso paginar tudo antes de achar qualquer coisa.
 */
export function urlBuscaPedidos({
  vendedor,
  pagina,
}: {
  vendedor: string;
  pagina: number;
}): string {
  const parametros = new URLSearchParams({
    seller: vendedor,
    sort: "date_desc",
    limit: String(TAMANHO_PAGINA),
    offset: String(pagina * TAMANHO_PAGINA),
  });
  return `/orders/search?${parametros}`;
}

export interface ResumoPedido {
  numero: string;
  vendidoEm: Date;
  status: string;
}

/**
 * Le a lista de uma pagina. Pedido em formato inesperado e DESCARTADO, nao
 * derruba a passada: a reconciliacao existe para achar o que falta, e abortar
 * tudo por causa de uma linha estranha e o oposto disso. O que for descartado
 * aparece na contagem.
 */
export function lerPaginaPedidos(payload: unknown): {
  pedidos: ResumoPedido[];
  descartados: number;
} {
  const raiz = payload as { results?: unknown } | null;
  const lista = Array.isArray(raiz?.results) ? raiz.results : [];

  const pedidos: ResumoPedido[] = [];
  let descartados = 0;

  for (const cru of lista) {
    const o = cru as Record<string, unknown> | null;
    const numero = typeof o?.id === "number" ? String(o.id) : typeof o?.id === "string" ? o.id : null;
    const status = typeof o?.status === "string" ? o.status : null;
    const dataCrua =
      typeof o?.date_closed === "string"
        ? o.date_closed
        : typeof o?.date_created === "string"
          ? o.date_created
          : null;

    if (!numero || !status || !dataCrua) {
      descartados += 1;
      continue;
    }
    const vendidoEm = new Date(dataCrua);
    if (Number.isNaN(vendidoEm.getTime())) {
      descartados += 1;
      continue;
    }

    pedidos.push({ numero, vendidoEm, status });
  }

  return { pedidos, descartados };
}

/**
 * A pagina alcancou a marca d'agua? (ou seja: para de paginar)
 *
 * Compara com o pedido MAIS ANTIGO da pagina. Como a ordem e decrescente, se
 * ate o mais antigo ainda e mais novo que a marca, existe mais coisa adiante.
 *
 * Sem marca d'agua (primeira execucao) nunca alcanca — o teto de paginas e quem
 * limita, de proposito: reconstruir o historico inteiro do zero nao e trabalho
 * de reconciliacao.
 */
export function alcancouMarcaDagua(pedidos: ResumoPedido[], marca: Date | null): boolean {
  if (!marca || pedidos.length === 0) return false;
  const maisAntigo = pedidos.reduce((a, b) => (a.vendidoEm <= b.vendidoEm ? a : b));
  return maisAntigo.vendidoEm <= marca;
}
