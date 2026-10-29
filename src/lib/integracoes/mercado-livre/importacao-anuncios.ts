/**
 * Importacao dos anuncios da conta do Mercado Livre (RN-123).
 *
 * SO LEITURA: todas as chamadas daqui sao GET. Nada e pausado, editado ou
 * encerrado na conta. O que vem do ML vai para `integracoes_ml_anuncios`, fora
 * do Estoque — anuncio so vira item no vinculo (etapa 2), com lote e custo.
 *
 * O caminho, conferido na doc oficial (docs/ml-api-notas.md §4):
 *   1. `/users/{id}/items/search?search_type=scan` — todos os ids, paginando por
 *      `scroll_id` (expira em 5 min; nao mistura com offset).
 *   2. `/items/bulk?ids=` em grupos de 20 — o substituto do `/items?ids=`, que
 *      a doc da como descontinuado desde 25/10/2026.
 *   3. `/items/{id}/description` — um por anuncio.
 *
 * GRAVA TUDO NO FIM, numa transacao so. Se o ML cair na pagina 3, nada e
 * gravado: uma importacao pela metade deixaria a tela mostrando metade da conta
 * como se fosse a conta inteira.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { integracoesMlAnuncios } from "@/lib/db/schema/integracoes-ml-anuncios";
import { registrarAuditoria } from "@/lib/audit/logger";

import { chamarML, ErroML } from "./client";
import {
  lerAnuncioML,
  lerDescricao,
  lerPaginaScan,
  lerRespostaBulk,
  type AnuncioML,
} from "./item-ml";

/** O teto do `/items/bulk`, pela doc do multiget (docs/ml-api-notas.md §4). */
const POR_BULK = 20;

/**
 * Teto de paginas do scan (100 ids cada). A conta tem ~100 anuncios; o teto so
 * existe para um `scroll_id` que nunca termine nao virar laco eterno.
 */
const MAX_PAGINAS_SCAN = 50;

export interface ResumoImportacao {
  /** Ids que a busca da conta devolveu. */
  encontrados: number;
  novos: number;
  atualizados: number;
  /** Ids que o ML recusou no bulk ou que vieram em formato inesperado. */
  falhas: { id: string | null; motivo: string }[];
  /** Anuncios de outro vendedor que vieram na busca. Deve ser sempre zero. */
  deOutraConta: number;
}

/** Todos os ids de anuncio da conta, em qualquer status. */
async function idsDaConta(vendedor: string): Promise<string[]> {
  const ids: string[] = [];
  let scrollId: string | null = null;

  for (let pagina = 0; pagina < MAX_PAGINAS_SCAN; pagina++) {
    const busca = new URLSearchParams({ search_type: "scan", limit: "100" });
    if (scrollId) busca.set("scroll_id", scrollId);

    const resposta = lerPaginaScan(
      await chamarML(`/users/${vendedor}/items/search?${busca}`),
    );
    if (resposta.ids.length === 0) return ids;

    ids.push(...resposta.ids);
    scrollId = resposta.scrollId;
    if (!scrollId) return ids;
  }

  throw new Error(
    `A busca de anuncios passou de ${MAX_PAGINAS_SCAN} paginas sem terminar. ` +
      "Nada foi gravado — confira o scroll_id da resposta do ML.",
  );
}

/** Descricao em texto puro. 404 = anuncio sem descricao, que e normal. */
async function descricaoDe(id: string): Promise<string | null> {
  try {
    return lerDescricao(await chamarML(`/items/${id}/description`));
  } catch (erro) {
    if (erro instanceof ErroML && erro.status === 404) return null;
    throw erro;
  }
}

/** Busca no ML tudo o que vai ser gravado. Nao toca o banco. */
async function lerDoML(resumo: ResumoImportacao) {
  const { id } = await chamarML<{ id: number | string }>("/users/me");
  const vendedor = String(id);

  const ids = [...new Set(await idsDaConta(vendedor))];
  resumo.encontrados = ids.length;

  const lidos: { anuncio: AnuncioML; descricao: string | null }[] = [];

  for (let i = 0; i < ids.length; i += POR_BULK) {
    const grupo = ids.slice(i, i + POR_BULK);
    const bulk = lerRespostaBulk(await chamarML(`/items/bulk?ids=${grupo.join(",")}`));

    for (const f of bulk.falhas) {
      resumo.falhas.push({ id: f.id, motivo: `ML respondeu ${f.codigo ?? "sem codigo"}` });
    }

    for (const corpo of bulk.corpos) {
      let anuncio: AnuncioML;
      try {
        anuncio = lerAnuncioML(corpo);
      } catch (erro) {
        // Um anuncio estranho nao derruba os outros: vira falha listada na tela.
        const idCru = (corpo as { id?: unknown })?.id;
        resumo.falhas.push({
          id: typeof idCru === "string" ? idCru : null,
          motivo: erro instanceof Error ? erro.message : String(erro),
        });
        continue;
      }
      if (anuncio.idVendedor && anuncio.idVendedor !== vendedor) {
        resumo.deOutraConta += 1;
        continue;
      }
      lidos.push({ anuncio, descricao: await descricaoDe(anuncio.idExterno) });
    }
  }

  return lidos;
}

/**
 * Importa os anuncios da conta conectada.
 *
 * `usuarioId` e quem clicou — vai para `modified_by` e para a trilha. Lanca se o
 * ML falhar; nesse caso nada foi gravado.
 */
export async function importarAnunciosML(usuarioId: string): Promise<ResumoImportacao> {
  const resumo: ResumoImportacao = {
    encontrados: 0,
    novos: 0,
    atualizados: 0,
    falhas: [],
    deOutraConta: 0,
  };

  const lidos = await lerDoML(resumo);
  const agora = new Date();

  await db.transaction(async (tx) => {
    const existentes = new Set(
      lidos.length === 0
        ? []
        : (
            await tx
              .select({ id: integracoesMlAnuncios.id_externo })
              .from(integracoesMlAnuncios)
              .where(
                and(
                  inArray(
                    integracoesMlAnuncios.id_externo,
                    lidos.map((l) => l.anuncio.idExterno),
                  ),
                  eq(integracoesMlAnuncios.is_deleted, false),
                ),
              )
          ).map((l) => l.id),
    );

    for (const { anuncio: a, descricao } of lidos) {
      const dados = {
        titulo: a.titulo,
        family_name: a.familyName,
        sku: a.sku,
        campo_vendedor: a.campoVendedor,
        status: a.status,
        preco: a.preco.toFixed(2),
        moeda: a.moeda,
        qtd_disponivel: a.qtdDisponivel,
        qtd_vendida: a.qtdVendida,
        categoria_id: a.categoriaId,
        tipo_anuncio: a.tipoAnuncio,
        condicao: a.condicao,
        permalink: a.permalink,
        fotos: a.fotos,
        descricao,
        criado_no_ml: a.criadoNoMl,
        atualizado_no_ml: a.atualizadoNoMl,
        sincronizado_em: agora,
        updated_at: agora,
        modified_by: usuarioId,
      };

      // `item_id` fica FORA do `set`: reimportar nunca desfaz um vinculo.
      const [linha] = await tx
        .insert(integracoesMlAnuncios)
        .values({ id_externo: a.idExterno, ...dados })
        .onConflictDoUpdate({
          target: integracoesMlAnuncios.id_externo,
          targetWhere: sql`${integracoesMlAnuncios.is_deleted} = false`,
          set: dados,
        })
        .returning({ id: integracoesMlAnuncios.id });

      const novo = !existentes.has(a.idExterno);
      if (novo) resumo.novos += 1;
      else resumo.atualizados += 1;

      await registrarAuditoria(tx, {
        userId: usuarioId,
        acao: novo ? "criar" : "atualizar",
        tabela: "integracoes_ml_anuncios",
        registroId: linha.id,
        detalhes:
          `${novo ? "Importou" : "Reimportou"} do Mercado Livre o anuncio ${a.idExterno} ` +
          `("${a.titulo}"): ${a.status}, R$ ${a.preco.toFixed(2)}, ` +
          `${a.qtdDisponivel} disponivel(is), ${a.qtdVendida} vendido(s)`,
      });
    }
  });

  return resumo;
}
