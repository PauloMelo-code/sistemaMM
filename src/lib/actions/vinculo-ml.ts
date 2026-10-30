"use server";

/**
 * Vinculo dos anuncios importados do ML com o Estoque (RN-124), e a copia das
 * fotos para o storage proprio.
 *
 * O vinculo e UMA transacao: lotes, itens, anuncios do canal, o `item_id` do
 * importado e das perguntas, e a trilha. Ou entra tudo, ou nada — metade de um
 * lote no Estoque com o custo rateado sobre a conta inteira seria custo errado.
 *
 * O plano e RECALCULADO aqui a partir do banco. A tela so manda o custo de cada
 * lote; quantidade, SKU e custo por item nunca vem do navegador.
 *
 * As fotos ficam FORA da transacao, em outra action, chamada em lotes pela
 * tela: copiar ~250 imagens e rede, e rede nao entra em transacao (o mesmo
 * principio do `worker.ts`).
 */
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { anuncios } from "@/lib/db/schema/anuncios";
import { integracoesMlAnuncios } from "@/lib/db/schema/integracoes-ml-anuncios";
import { itens } from "@/lib/db/schema/itens";
import { itensFotos } from "@/lib/db/schema/itens-fotos";
import { lotes } from "@/lib/db/schema/lotes";
import { perguntas } from "@/lib/db/schema/perguntas";
import { registrarAuditoria } from "@/lib/audit/logger";
import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao, type Papel } from "@/lib/auth/sessao";
import { adicionarFoto } from "@/lib/actions/fotos";
import { montarPlano } from "@/lib/integracoes/mercado-livre/vinculo";
import { codigoPostgres } from "@/lib/integracoes/retentativa";
import { loteSchema } from "@/lib/validators/lote";

import type { Resultado } from "./lotes-mutacoes";

/** Vincular cria lote, item com custo e anuncio de canal: as quatro permissoes. */
function podeVincular(papel: Papel): boolean {
  return (
    temPermissao(papel, "lotes", "criar") &&
    temPermissao(papel, "itens", "criar") &&
    temPermissao(papel, "itens_custo", "criar") &&
    temPermissao(papel, "integracoes", "atualizar")
  );
}

const entradaSchema = z.object({
  lotes: z.array(loteSchema.extend({ prefixo: z.string().trim().min(1) })).min(1),
});

export type EntradaVinculo = z.input<typeof entradaSchema>;

export async function vincularAnunciosML(
  entrada: EntradaVinculo,
): Promise<Resultado<{ lotes: number; itens: number }>> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  if (!podeVincular(sessao.papel)) {
    return { ok: false, erro: "Só administrador vincula anúncios ao Estoque." };
  }

  const validado = entradaSchema.safeParse(entrada);
  if (!validado.success) {
    return { ok: false, erro: validado.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const porPrefixo = new Map(validado.data.lotes.map((l) => [l.prefixo, l]));

  try {
    const r = await db.transaction(async (tx) => {
      // Trava as linhas: dois cliques (ou duas abas) nao podem vincular o mesmo
      // anuncio duas vezes.
      const importados = await tx
        .select()
        .from(integracoesMlAnuncios)
        .where(and(eq(integracoesMlAnuncios.is_deleted, false), isNull(integracoesMlAnuncios.item_id)))
        .for("update");

      if (importados.length === 0) return { erro: "Não há anúncio importado sem vínculo." } as const;

      const existentes = new Set(
        (await tx.select({ sku: itens.sku }).from(itens).where(eq(itens.is_deleted, false))).map((i) => i.sku),
      );

      const plano = montarPlano(
        importados.map((l) => ({
          idExterno: l.id_externo,
          titulo: l.titulo,
          sku: l.sku ?? l.campo_vendedor,
          status: l.status,
          preco: Number(l.preco),
          qtdDisponivel: l.qtd_disponivel,
          qtdVendida: l.qtd_vendida,
          criadoNoMl: l.criado_no_ml,
        })),
        new Map([...porPrefixo].map(([p, l]) => [p, l.custo_total])),
        existentes,
      );
      if (!plano.ok) return { erro: plano.erro } as const;

      const importadoPorId = new Map(importados.map((l) => [l.id_externo, l]));
      const loteIdPorPrefixo = new Map<string, string>();

      for (const prefixo of new Set(plano.itens.map((i) => i.prefixo))) {
        const dados = porPrefixo.get(prefixo)!;
        const [lote] = await tx
          .insert(lotes)
          .values({
            nome: dados.nome,
            segmento: dados.segmento,
            data_arremate: dados.data_arremate,
            custo_total: dados.custo_total,
            modified_by: sessao.usuarioId,
          })
          .returning();
        loteIdPorPrefixo.set(prefixo, lote.id);

        await registrarAuditoria(tx, {
          userId: sessao.usuarioId,
          acao: "criar",
          tabela: "lotes",
          registroId: lote.id,
          detalhes:
            `Criou o lote "${lote.nome}" (prefixo ${prefixo}) no vinculo com o Mercado Livre, ` +
            `custo total R$ ${lote.custo_total} rateado entre os itens (RN-124)`,
          dadosNovos: lote,
        });
      }

      for (const p of plano.itens) {
        const origem = importadoPorId.get(p.idExterno)!;
        const dadosLote = porPrefixo.get(p.prefixo)!;

        const [item] = await tx
          .insert(itens)
          .values({
            sku: p.sku,
            nome: p.nome.slice(0, 160),
            lote_id: loteIdPorPrefixo.get(p.prefixo)!,
            segmento: dadosLote.segmento,
            custo: p.custoUnitario,
            quantidade: p.quantidade,
            situacao: p.situacao,
            modified_by: sessao.usuarioId,
          })
          .returning();

        await tx.insert(anuncios).values({
          item_id: item.id,
          canal: "mercado_livre",
          id_externo: p.idExterno,
          preco: p.preco.toFixed(2),
          status: p.statusAnuncio,
          // Vendas ate a importacao ja estao fora da quantidade (RN-124).
          contado_ate: origem.sincronizado_em,
          modified_by: sessao.usuarioId,
        });

        await tx
          .update(integracoesMlAnuncios)
          .set({ item_id: item.id, updated_at: new Date(), modified_by: sessao.usuarioId })
          .where(eq(integracoesMlAnuncios.id, origem.id));

        await tx
          .update(perguntas)
          .set({ item_id: item.id, updated_at: new Date(), modified_by: sessao.usuarioId })
          .where(
            and(
              eq(perguntas.canal, "mercado_livre"),
              eq(perguntas.id_anuncio_externo, p.idExterno),
              isNull(perguntas.item_id),
              eq(perguntas.is_deleted, false),
            ),
          );

        await registrarAuditoria(tx, {
          userId: sessao.usuarioId,
          acao: "criar",
          tabela: "itens",
          registroId: item.id,
          detalhes:
            `Vinculou o anuncio ${p.idExterno} do Mercado Livre: item ${item.sku} — "${item.nome}", ` +
            `${p.quantidade} unidade(s), custo rateado R$ ${p.custoUnitario} por unidade`,
          dadosNovos: item,
        });
      }

      return { lotes: loteIdPorPrefixo.size, itens: plano.itens.length } as const;
    });

    if (r.erro !== undefined) return { ok: false, erro: r.erro };

    for (const caminho of ["/estoque", "/anuncios", "/lotes", "/perguntas", "/", "/integracoes/mercado-livre"]) {
      revalidatePath(caminho);
    }
    return { ok: true, dados: { lotes: r.lotes, itens: r.itens } };
  } catch (erro) {
    console.error("[vinculo-ml] falhou — nada foi gravado", erro);
    if (codigoPostgres(erro) === "23505") {
      return {
        ok: false,
        erro: "Algum anúncio do ML já existe em Anúncios (mesmo MLB). Nada foi gravado.",
      };
    }
    return { ok: false, erro: "O vínculo falhou e nada foi gravado. Tente de novo." };
  }
}

/** Quantos itens a copia de fotos processa por chamada. A tela chama em laco. */
const ITENS_POR_CHAMADA = 4;

export type ResultadoFotos = Resultado<{
  /** Ids dos anuncios tentados nesta chamada — a tela os manda de volta para pular. */
  tentados: string[];
  copiadas: number;
  recusadas: number;
  restantes: number;
}>;

/**
 * Copia as fotos do ML para o MinIO, para os itens vinculados que ainda nao tem
 * foto (RN-123/RN-124). `jaTentados` evita laco eterno com item cujas fotos o
 * storage recusa (pequenas demais, por exemplo).
 */
export async function copiarFotosML(jaTentados: string[]): Promise<ResultadoFotos> {
  const sessao = await lerSessao();
  if (!sessao) return { ok: false, erro: "Sessão expirada. Entre de novo." };
  if (!podeVincular(sessao.papel)) return { ok: false, erro: "Só administrador copia as fotos." };

  const pendentes = await db
    .select({
      idExterno: integracoesMlAnuncios.id_externo,
      itemId: integracoesMlAnuncios.item_id,
      titulo: integracoesMlAnuncios.titulo,
      fotos: integracoesMlAnuncios.fotos,
    })
    .from(integracoesMlAnuncios)
    .where(
      and(
        eq(integracoesMlAnuncios.is_deleted, false),
        sql`${integracoesMlAnuncios.item_id} IS NOT NULL`,
        jaTentados.length ? sql`NOT (${inArray(integracoesMlAnuncios.id_externo, jaTentados)})` : sql`true`,
        notExists(
          db
            .select({ um: sql`1` })
            .from(itensFotos)
            .where(
              and(eq(itensFotos.item_id, integracoesMlAnuncios.item_id), eq(itensFotos.is_deleted, false)),
            ),
        ),
      ),
    );

  const agora = pendentes.slice(0, ITENS_POR_CHAMADA);
  let copiadas = 0;
  let recusadas = 0;

  for (const p of agora) {
    for (const foto of p.fotos) {
      try {
        const resposta = await fetch(foto.url, { signal: AbortSignal.timeout(15_000) });
        if (!resposta.ok) {
          recusadas += 1;
          continue;
        }
        const r = await adicionarFoto({
          itemId: p.itemId!,
          dados: Buffer.from(await resposta.arrayBuffer()),
          alt: p.titulo,
        });
        if (r.ok) copiadas += 1;
        else recusadas += 1;
      } catch (erro) {
        console.warn(`[fotos-ml] ${p.idExterno}: falha ao copiar ${foto.url}`, erro);
        recusadas += 1;
      }
    }
  }

  revalidatePath("/estoque");
  return {
    ok: true,
    dados: {
      tentados: agora.map((p) => p.idExterno),
      copiadas,
      recusadas,
      restantes: pendentes.length - agora.length,
    },
  };
}
