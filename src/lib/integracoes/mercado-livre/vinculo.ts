/**
 * Plano do vinculo anuncio do ML -> item do Estoque (RN-124).
 *
 * Modulo PURO: recebe os anuncios importados e o custo de cada lote, devolve o
 * que vai ser criado. Quem grava e a action; aqui so mora a decisao, para ela
 * ser testavel sem banco e para a tela mostrar a MESMA previa que sera gravada.
 */
import { ratearCustoDoLote } from "../../pricing.ts";

export interface AnuncioParaVinculo {
  idExterno: string;
  titulo: string;
  /** `SELLER_SKU`, ou o `seller_custom_field` quando so ele existir. */
  sku: string | null;
  /** Status como o ML devolve: active, paused, closed, inactive... */
  status: string;
  preco: number;
  qtdDisponivel: number;
  qtdVendida: number;
  criadoNoMl: Date | null;
}

export type SituacaoNova = "anunciado" | "pausado" | "vendido";
export type StatusAnuncioNovo = "no_ar" | "pausado";

export interface ItemPlanejado {
  idExterno: string;
  prefixo: string;
  sku: string;
  nome: string;
  quantidade: number;
  custoUnitario: string;
  situacao: SituacaoNova;
  statusAnuncio: StatusAnuncioNovo;
  preco: number;
}

/** O lote de um SKU: o texto antes do primeiro `-`. Sem SKU, `SEM-SKU`. */
export function prefixoDoSku(sku: string | null): string {
  const base = sku?.trim().split("-")[0]?.trim().toUpperCase();
  return base ? base : "SEM-SKU";
}

/** Ordem estavel: por id do anuncio. E o que decide quem fica com o SKU original. */
const porId = (a: AnuncioParaVinculo, b: AnuncioParaVinculo) => a.idExterno.localeCompare(b.idExterno);

/** Anuncios agrupados por lote, cada grupo ja na ordem estavel. */
export function agruparPorLote(anuncios: AnuncioParaVinculo[]): Map<string, AnuncioParaVinculo[]> {
  const grupos = new Map<string, AnuncioParaVinculo[]>();
  for (const a of [...anuncios].sort(porId)) {
    const prefixo = prefixoDoSku(a.sku);
    grupos.set(prefixo, [...(grupos.get(prefixo) ?? []), a]);
  }
  return grupos;
}

export interface ResumoLote {
  prefixo: string;
  anuncios: number;
  unidadesDisponiveis: number;
  unidadesVendidas: number;
  /** `YYYY-MM-DD` do anuncio mais antigo — a sugestao de data de arremate. */
  dataSugerida: string | null;
}

/** O que a tela mostra antes de pedir o custo de cada lote. */
export function resumirLotes(anuncios: AnuncioParaVinculo[]): ResumoLote[] {
  return [...agruparPorLote(anuncios)].map(([prefixo, grupo]) => {
    const datas = grupo.flatMap((a) => (a.criadoNoMl ? [a.criadoNoMl.getTime()] : []));
    return {
      prefixo,
      anuncios: grupo.length,
      unidadesDisponiveis: grupo.reduce((s, a) => s + a.qtdDisponivel, 0),
      unidadesVendidas: grupo.reduce((s, a) => s + a.qtdVendida, 0),
      dataSugerida: datas.length ? new Date(Math.min(...datas)).toISOString().slice(0, 10) : null,
    };
  });
}

/** Sufixo do n-esimo repetido: 1 -> B, 2 -> C ... 25 -> Z, depois numero. */
function sufixo(n: number): string {
  return n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
}

/**
 * O SKU final de cada anuncio. O primeiro (na ordem do id) fica com o SKU; os
 * seguintes, e quem colidir com SKU que ja existe no Estoque, ganham `-B`,
 * `-C`... Sem SKU: `ML-<id>`.
 */
export function definirSkus(
  anuncios: AnuncioParaVinculo[],
  existentes: ReadonlySet<string>,
): Map<string, string> {
  const usados = new Set(existentes);
  const resultado = new Map<string, string>();

  for (const a of [...anuncios].sort(porId)) {
    const base = (a.sku?.trim() || `ML-${a.idExterno}`).toUpperCase().replace(/\s+/g, "-");
    let sku = base;
    for (let n = 1; usados.has(sku); n++) sku = `${base}-${sufixo(n)}`;
    usados.add(sku);
    resultado.set(a.idExterno, sku);
  }
  return resultado;
}

export function situacaoDoItem(status: string, disponivel: number): SituacaoNova {
  if (disponivel === 0) return "vendido";
  return status === "active" ? "anunciado" : "pausado";
}

export function statusDoAnuncio(status: string): StatusAnuncioNovo {
  return status === "active" ? "no_ar" : "pausado";
}

/**
 * O plano completo. `custos` e o custo total de cada lote, por prefixo.
 * Devolve erro (e nao plano parcial) se faltar custo de algum lote ou o rateio
 * recusar: item sem custo nao existe (RN-121).
 */
export function montarPlano(
  anuncios: AnuncioParaVinculo[],
  custos: ReadonlyMap<string, string>,
  skusExistentes: ReadonlySet<string>,
): { ok: true; itens: ItemPlanejado[] } | { ok: false; erro: string } {
  const skus = definirSkus(anuncios, skusExistentes);
  const itens: ItemPlanejado[] = [];

  for (const [prefixo, grupo] of agruparPorLote(anuncios)) {
    const custo = custos.get(prefixo);
    if (!custo) return { ok: false, erro: `Falta o custo total do lote ${prefixo}.` };

    const unitarios = ratearCustoDoLote(
      custo,
      grupo.map((a) => ({ preco: a.preco, unidades: a.qtdDisponivel + a.qtdVendida })),
    );
    if (!unitarios) return { ok: false, erro: `Nao foi possivel ratear o custo do lote ${prefixo}.` };

    grupo.forEach((a, i) => {
      itens.push({
        idExterno: a.idExterno,
        prefixo,
        sku: skus.get(a.idExterno)!,
        nome: a.titulo,
        quantidade: a.qtdDisponivel,
        custoUnitario: unitarios[i],
        situacao: situacaoDoItem(a.status, a.qtdDisponivel),
        statusAnuncio: statusDoAnuncio(a.status),
        preco: a.preco,
      });
    });
  }

  return { ok: true, itens };
}
