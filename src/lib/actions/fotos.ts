/**
 * Fotos dos itens — upload, ordem, capa e exclusao (RN-109).
 *
 * Divisao de responsabilidade deste arquivo: os BYTES vao para o MinIO
 * (`src/lib/storage/`), a LINHA vai para o banco, e a ordem entre as duas coisas
 * importa. Enviar primeiro e gravar depois deixa, no pior caso, um objeto sem
 * linha — invisivel e barato. O contrario deixaria linha sem objeto, que e foto
 * quebrada na tela do cliente.
 *
 * Erro ESPERADO (arquivo errado, item inexistente, limite atingido) volta como
 * `{ ok: false, motivo }`, no estilo do `pricing.ts`: nao e falha de programa, e
 * a rota precisa do texto para mostrar. Excecao fica para o que e infraestrutura
 * (banco fora, MinIO recusando).
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { itens } from "@/lib/db/schema/itens";
import { itensFotos } from "@/lib/db/schema/itens-fotos";
import { USUARIO_SISTEMA_ID } from "@/lib/integracoes/usuario-sistema";
import { analisarImagem } from "@/lib/storage/imagem";
import { enviarObjeto, gerarChave, urlPublica } from "@/lib/storage/minio";

/**
 * O handoff mostra capa + 3 miniaturas. O teto e folgado de proposito — ele
 * existe para impedir que um script encha o bucket, nao para limitar quem
 * trabalha. Nao ha sessao ainda (docs/known-issues.md 🔴), entao este numero e
 * hoje a unica coisa entre a rota e um upload em loop.
 */
export const MAXIMO_FOTOS_POR_ITEM = 12;

/**
 * Quem assina a escrita.
 *
 * Enquanto nao existir autenticacao, e o usuario de sistema — o mesmo do webhook.
 * Isso SUJA a trilha: nao da para distinguir o que o Anderson subiu do que o robo
 * gravou, que e justamente o que o usuario de sistema deveria permitir separar.
 * E consciente e temporario. Quando a sessao existir, muda AQUI, num lugar so.
 */
function autorEdicao(): string {
  return USUARIO_SISTEMA_ID;
}

export interface Foto {
  id: string;
  url: string;
  alt: string | null;
  principal: boolean;
  ordem: number;
  largura: number;
  altura: number;
}

export type Resultado<T> = { ok: true; dados: T } | { ok: false; motivo: string };

/** `23505` — o codigo do Postgres para violacao de indice unico. */
function ehViolacaoUnica(erro: unknown): boolean {
  return typeof erro === "object" && erro !== null && "code" in erro && erro.code === "23505";
}

/** Galeria de um item, na ordem de exibicao. Capa sempre primeiro. */
export async function listarFotos(itemId: string): Promise<Foto[]> {
  const linhas = await db
    .select({
      id: itensFotos.id,
      objeto: itensFotos.objeto,
      alt: itensFotos.alt,
      principal: itensFotos.principal,
      ordem: itensFotos.ordem,
      largura: itensFotos.largura,
      altura: itensFotos.altura,
    })
    .from(itensFotos)
    .where(and(eq(itensFotos.item_id, itemId), eq(itensFotos.is_deleted, false)))
    // `principal DESC` antes da ordem: a capa e a capa, esteja em que posicao
    // estiver. Ordenar so por `ordem` faria a capa sumir do topo depois de um
    // reordenamento.
    .orderBy(sql`${itensFotos.principal} DESC`, asc(itensFotos.ordem), asc(itensFotos.created_at));

  return linhas.map((l) => ({
    id: l.id,
    url: urlPublica(l.objeto),
    alt: l.alt,
    principal: l.principal,
    ordem: l.ordem,
    largura: l.largura,
    altura: l.altura,
  }));
}

export interface EntradaFoto {
  itemId: string;
  /** O arquivo como chegou. O conteudo e a unica fonte de verdade sobre o tipo. */
  dados: Buffer;
  alt?: string | null;
}

/**
 * Envia a imagem e registra a linha.
 *
 * `ordem` e `principal` sao calculados por SUBQUERY dentro do proprio INSERT, e
 * nao lidos antes num SELECT: arrastar quatro arquivos de uma vez dispara quatro
 * uploads simultaneos, e quatro `SELECT max(ordem)` leriam o mesmo valor. Com a
 * subquery quem resolve o empate da capa e o indice unico — e o perdedor entra
 * como foto comum em vez de estourar erro cru na tela.
 */
export async function adicionarFoto({ itemId, dados, alt }: EntradaFoto): Promise<Resultado<Foto>> {
  const analise = analisarImagem(dados);
  if (!analise.ok) return { ok: false, motivo: analise.motivo };

  const [item] = await db
    .select({ id: itens.id })
    .from(itens)
    .where(and(eq(itens.id, itemId), eq(itens.is_deleted, false)))
    .limit(1);

  if (!item) return { ok: false, motivo: "Item nao encontrado." };

  const [contagem] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(itensFotos)
    .where(and(eq(itensFotos.item_id, itemId), eq(itensFotos.is_deleted, false)));

  if ((contagem?.total ?? 0) >= MAXIMO_FOTOS_POR_ITEM) {
    return {
      ok: false,
      motivo: `Este item ja tem ${MAXIMO_FOTOS_POR_ITEM} fotos. Exclua uma antes de subir outra.`,
    };
  }

  const chave = gerarChave(itemId, analise.extensao);

  // Chamada externa ANTES do banco e FORA de transacao (invariante 4): uma
  // chamada de rede presa numa transacao segura lock e envenena o pool.
  const url = await enviarObjeto(chave, dados, analise.mime);

  const valores = {
    item_id: itemId,
    objeto: chave,
    mime: analise.mime,
    bytes: analise.bytes,
    largura: analise.largura,
    altura: analise.altura,
    alt: alt ?? null,
    ordem: sql<number>`(
      SELECT COALESCE(MAX(f.ordem) + 1, 0) FROM itens_fotos f
      WHERE f.item_id = ${itemId} AND f.is_deleted = false
    )`,
    modified_by: autorEdicao(),
  };

  // A primeira foto de um item vira capa sozinha — o site e o anuncio precisam
  // de uma, e ninguem deveria ter que lembrar de marcar.
  const viraCapa = sql<boolean>`NOT EXISTS (
    SELECT 1 FROM itens_fotos f
    WHERE f.item_id = ${itemId} AND f.principal = true AND f.is_deleted = false
  )`;

  let linha;
  try {
    [linha] = await db
      .insert(itensFotos)
      .values({ ...valores, principal: viraCapa })
      .returning();
  } catch (erro) {
    // Duas fotos simultaneas viram capa ao mesmo tempo: o indice barra a
    // segunda. Ela entra como foto comum — o item continua com uma capa so.
    if (!ehViolacaoUnica(erro)) throw erro;
    [linha] = await db
      .insert(itensFotos)
      .values({ ...valores, principal: false })
      .returning();
  }

  return {
    ok: true,
    dados: {
      id: linha.id,
      url,
      alt: linha.alt,
      principal: linha.principal,
      ordem: linha.ordem,
      largura: linha.largura,
      altura: linha.altura,
    },
  };
}

/**
 * Exclusao LOGICA. O objeto continua no MinIO de proposito: e o que permite
 * desfazer o engano de quem exclui a foto errada.
 *
 * Se a excluida era a capa, a proxima assume na mesma transacao — item sem capa
 * some do card do site e do anuncio, e o operador nao teria como saber por que.
 */
export async function removerFoto(id: string): Promise<Resultado<{ novaCapa: string | null }>> {
  return db.transaction(async (tx) => {
    // Ler ANTES de escrever, e nao pelo `returning` do UPDATE: o RETURNING do
    // Postgres devolve a linha DEPOIS da alteracao, entao `principal` viria
    // sempre `false` — o proprio UPDATE acabou de zerar. O item ficaria sem capa
    // nenhuma e a falha so apareceria no card vazio do site.
    // `FOR UPDATE` trava a linha: sem isso duas exclusoes simultaneas leem
    // "era capa" as duas e promovem duas substitutas.
    const [foto] = await tx
      .select({ item_id: itensFotos.item_id, eraCapa: itensFotos.principal })
      .from(itensFotos)
      .where(and(eq(itensFotos.id, id), eq(itensFotos.is_deleted, false)))
      .for("update")
      .limit(1);

    if (!foto) return { ok: false as const, motivo: "Foto nao encontrada." };

    await tx
      .update(itensFotos)
      .set({
        is_deleted: true,
        deleted_at: new Date(),
        // Sai do posto de capa junto: restaurar a foto depois nao pode colidir
        // com a capa que assumiu no lugar dela.
        principal: false,
        // Nada atualiza `updated_at` sozinho nesta base (docs/known-issues.md):
        // toda escrita seta a coluna na mao.
        updated_at: new Date(),
        modified_by: autorEdicao(),
      })
      .where(eq(itensFotos.id, id));

    if (!foto.eraCapa) return { ok: true as const, dados: { novaCapa: null } };

    const [proxima] = await tx
      .select({ id: itensFotos.id })
      .from(itensFotos)
      .where(and(eq(itensFotos.item_id, foto.item_id), eq(itensFotos.is_deleted, false)))
      .orderBy(asc(itensFotos.ordem), asc(itensFotos.created_at))
      .limit(1);

    if (!proxima) return { ok: true as const, dados: { novaCapa: null } };

    await tx
      .update(itensFotos)
      .set({ principal: true, updated_at: new Date(), modified_by: autorEdicao() })
      .where(eq(itensFotos.id, proxima.id));

    return { ok: true as const, dados: { novaCapa: proxima.id } };
  });
}

/**
 * Troca a capa do item.
 *
 * Limpa a capa antiga ANTES de marcar a nova, na mesma transacao. A ordem
 * inversa violaria o indice unico no instante entre os dois UPDATEs.
 */
export async function definirPrincipal(id: string): Promise<Resultado<null>> {
  return db.transaction(async (tx) => {
    const [foto] = await tx
      .select({ item_id: itensFotos.item_id })
      .from(itensFotos)
      .where(and(eq(itensFotos.id, id), eq(itensFotos.is_deleted, false)))
      .limit(1);

    if (!foto) return { ok: false as const, motivo: "Foto nao encontrada." };

    await tx
      .update(itensFotos)
      .set({ principal: false, updated_at: new Date(), modified_by: autorEdicao() })
      .where(
        and(
          eq(itensFotos.item_id, foto.item_id),
          eq(itensFotos.principal, true),
          eq(itensFotos.is_deleted, false),
        ),
      );

    await tx
      .update(itensFotos)
      .set({ principal: true, updated_at: new Date(), modified_by: autorEdicao() })
      .where(eq(itensFotos.id, id));

    return { ok: true as const, dados: null };
  });
}

/** Reordena a galeria. `ids` na ordem desejada; o que nao vier na lista fica onde esta. */
export async function reordenar(itemId: string, ids: string[]): Promise<Resultado<null>> {
  if (ids.length === 0) return { ok: false, motivo: "Nenhuma foto informada." };
  if (ids.length > MAXIMO_FOTOS_POR_ITEM) return { ok: false, motivo: "Lista longa demais." };

  await db.transaction(async (tx) => {
    // Lista curta por definicao (teto de 12): um UPDATE por foto e mais legivel
    // que um CASE gigante, e a diferenca de tempo nao existe nessa escala.
    for (const [posicao, id] of ids.entries()) {
      await tx
        .update(itensFotos)
        .set({ ordem: posicao, updated_at: new Date(), modified_by: autorEdicao() })
        .where(
          and(
            eq(itensFotos.id, id),
            eq(itensFotos.item_id, itemId),
            eq(itensFotos.is_deleted, false),
          ),
        );
    }
  });

  return { ok: true, dados: null };
}

/** Texto alternativo da foto (acessibilidade e SEO do site publico). */
export async function definirAlt(id: string, alt: string | null): Promise<Resultado<null>> {
  const [foto] = await db
    .update(itensFotos)
    .set({ alt, updated_at: new Date(), modified_by: autorEdicao() })
    .where(and(eq(itensFotos.id, id), eq(itensFotos.is_deleted, false)))
    .returning({ id: itensFotos.id });

  return foto ? { ok: true, dados: null } : { ok: false, motivo: "Foto nao encontrada." };
}

/**
 * Liga/desliga o item no site publico — a guarda da RN-109.
 *
 * Item sem foto NAO pode ser publicado: a vitrine mostraria um card vazio e o
 * lead chegaria no WhatsApp perguntando de um produto que ninguem consegue ver.
 * A checagem mora aqui, e nao na tela, porque esconder o toggle no CSS nao e
 * regra — e aparencia de regra.
 *
 * ponytail: mora em `actions/fotos.ts` porque o que a regra checa e foto. Quando
 * existir `actions/itens.ts`, muda de casa junto com o resto do item.
 */
export async function definirExibicaoNoSite(
  itemId: string,
  exibir: boolean,
): Promise<Resultado<null>> {
  if (exibir) {
    const [contagem] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(itensFotos)
      .where(and(eq(itensFotos.item_id, itemId), eq(itensFotos.is_deleted, false)));

    if ((contagem?.total ?? 0) === 0) {
      return { ok: false, motivo: "Item sem foto nao pode ir para o site (RN-109)." };
    }
  }

  const [item] = await db
    .update(itens)
    .set({ exibir_no_site: exibir, updated_at: new Date(), modified_by: autorEdicao() })
    .where(and(eq(itens.id, itemId), eq(itens.is_deleted, false)))
    .returning({ id: itens.id });

  return item ? { ok: true, dados: null } : { ok: false, motivo: "Item nao encontrado." };
}
