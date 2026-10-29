/**
 * QUARENTENA do formato do ANUNCIO do Mercado Livre (RN-123): tudo o que a
 * importacao presume sobre `/users/{id}/items/search`, `/items/bulk` e
 * `/items/{id}/description` esta aqui, e em nenhum outro arquivo.
 *
 * ⚠️ ESCRITO A PARTIR DA DOCUMENTACAO (docs/ml-api-notas.md), nao de uma
 * resposta real. O `/items/bulk` em especial e o substituto recente do multiget
 * `/items?ids=` e a doc so descreve as diferencas (`status_code` no lugar de
 * `code`). Na primeira importacao real, confira este arquivo contra o que veio.
 *
 * Mesma politica do `pedido-ml.ts`: campo obrigatorio ausente faz LANCAR. Um
 * anuncio gravado com preco 0 ou estoque 0 inventados parece certo na tela e
 * engana quem for vincular. Campo opcional ausente vira `null`.
 *
 * Modulo PURO: nao chama rede nem banco.
 */
import type { FotoML } from "@/lib/db/schema/integracoes-ml-anuncios";

/** O que a importacao grava de um anuncio. */
export interface AnuncioML {
  idExterno: string;
  titulo: string;
  familyName: string | null;
  sku: string | null;
  campoVendedor: string | null;
  status: string;
  preco: number;
  moeda: string;
  qtdDisponivel: number;
  qtdVendida: number;
  categoriaId: string;
  tipoAnuncio: string;
  condicao: string | null;
  permalink: string | null;
  fotos: FotoML[];
  criadoNoMl: Date | null;
  atualizadoNoMl: Date | null;
  /** Para descartar anuncio de outra conta. */
  idVendedor: string | null;
}

export class AnuncioMLInvalidoError extends Error {
  constructor(motivo: string) {
    super(
      `Anuncio do Mercado Livre em formato inesperado: ${motivo}. ` +
        "O mapeamento vive em src/lib/integracoes/mercado-livre/item-ml.ts e foi escrito " +
        "a partir da documentacao — confira contra a resposta real.",
    );
    this.name = "AnuncioMLInvalidoError";
  }
}

type Json = Record<string, unknown>;

const objeto = (v: unknown): Json | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

const texto = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  // O ML manda id como numero em varios lugares.
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

/** Inteiro ou decimal nao negativo. */
const numero = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

const data = (v: unknown): Date | null => {
  const t = texto(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** `value_name` do atributo `id`, se o anuncio tiver. */
function atributo(raiz: Json, id: string): string | null {
  if (!Array.isArray(raiz.attributes)) return null;
  for (const a of raiz.attributes) {
    const attr = objeto(a);
    if (attr && attr.id === id) return texto(attr.value_name);
  }
  return null;
}

function obrigatorio<T>(valor: T | null, campo: string): T {
  if (valor === null) throw new AnuncioMLInvalidoError(`\`${campo}\` ausente ou invalido`);
  return valor;
}

/** Le o corpo de UM anuncio (o `body` de cada entrada do `/items/bulk`). */
export function lerAnuncioML(payload: unknown): AnuncioML {
  const raiz = objeto(payload);
  if (!raiz) throw new AnuncioMLInvalidoError("o corpo nao e um objeto JSON");

  const fotos: FotoML[] = [];
  if (Array.isArray(raiz.pictures)) {
    for (const p of raiz.pictures) {
      const foto = objeto(p);
      // `secure_url` (https) primeiro: a tela e servida em https e foto http
      // vira conteudo misto bloqueado pelo navegador.
      const url = foto ? (texto(foto.secure_url) ?? texto(foto.url)) : null;
      const id = foto ? texto(foto.id) : null;
      if (id && url) fotos.push({ id, url });
    }
  }

  return {
    idExterno: obrigatorio(texto(raiz.id), "id"),
    titulo: obrigatorio(texto(raiz.title), "title"),
    familyName: texto(raiz.family_name),
    sku: atributo(raiz, "SELLER_SKU"),
    campoVendedor: texto(raiz.seller_custom_field),
    status: obrigatorio(texto(raiz.status), "status"),
    preco: obrigatorio(numero(raiz.price), "price"),
    moeda: obrigatorio(texto(raiz.currency_id), "currency_id"),
    qtdDisponivel: obrigatorio(numero(raiz.available_quantity), "available_quantity"),
    qtdVendida: obrigatorio(numero(raiz.sold_quantity), "sold_quantity"),
    categoriaId: obrigatorio(texto(raiz.category_id), "category_id"),
    tipoAnuncio: obrigatorio(texto(raiz.listing_type_id), "listing_type_id"),
    condicao: texto(raiz.condition),
    permalink: texto(raiz.permalink),
    fotos,
    criadoNoMl: data(raiz.date_created),
    atualizadoNoMl: data(raiz.last_updated),
    idVendedor: texto(raiz.seller_id),
  };
}

/** Uma pagina do `search_type=scan`. */
export interface PaginaScan {
  ids: string[];
  /** Nulo quando o ML nao manda — fim da varredura. */
  scrollId: string | null;
}

export function lerPaginaScan(payload: unknown): PaginaScan {
  const raiz = objeto(payload);
  if (!raiz || !Array.isArray(raiz.results)) {
    throw new AnuncioMLInvalidoError("busca sem `results`");
  }
  const ids = raiz.results.map(texto);
  if (ids.some((id) => id === null)) {
    throw new AnuncioMLInvalidoError("`results` com id que nao e texto");
  }
  return { ids: ids as string[], scrollId: texto(raiz.scroll_id) };
}

/** Resultado do `/items/bulk`: o que leu e o que o ML recusou, por id. */
export interface RespostaBulk {
  corpos: unknown[];
  falhas: { id: string | null; codigo: number | null }[];
}

/**
 * Le o `/items/bulk?ids=`. Cada entrada traz o codigo HTTP daquele id e o corpo.
 *
 * Aceita `code` alem de `status_code`: e o nome do campo no multiget antigo, e
 * a doc lista essa troca como a diferenca entre os dois. Aceitar os dois custa
 * uma linha e evita uma importacao inteira falhar por um nome de campo.
 */
export function lerRespostaBulk(payload: unknown): RespostaBulk {
  if (!Array.isArray(payload)) throw new AnuncioMLInvalidoError("o bulk nao devolveu uma lista");

  const resposta: RespostaBulk = { corpos: [], falhas: [] };
  for (const e of payload) {
    const entrada = objeto(e);
    const codigo = entrada ? numero(entrada.status_code ?? entrada.code) : null;
    const corpo = entrada ? objeto(entrada.body) : null;
    if (codigo === 200 && corpo) {
      resposta.corpos.push(corpo);
    } else {
      resposta.falhas.push({ id: corpo ? texto(corpo.id) : null, codigo });
    }
  }
  return resposta;
}

/** Texto da descricao, ou `null` se o anuncio nao tiver. */
export function lerDescricao(payload: unknown): string | null {
  const raiz = objeto(payload);
  return raiz ? texto(raiz.plain_text) : null;
}
