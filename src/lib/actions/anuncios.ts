/**
 * Leitura da tela de Anuncios.
 *
 * ⚠️ ESTA E A PRIMEIRA TELA EM QUE A RN-107 MORDE. A coluna Margem deriva de
 * custo — quem sabe o preco e a margem calcula o custo de cabeca. Entao para o
 * operador a margem **nao e calculada nem enviada**: o campo nao existe no
 * objeto que sai daqui.
 *
 * Nao basta esconder na tela. Payload de server component viaja para o
 * navegador e aparece no DevTools; `Omit` no TypeScript some em tempo de
 * execucao. O filtro e aqui, no servidor.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { anuncios } from "@/lib/db/schema/anuncios";
import { itens } from "@/lib/db/schema/itens";
import { podeVerCusto } from "@/lib/auth/rbac";
import type { Papel } from "@/lib/auth/sessao";
import { margemDoAnuncio, type Canal } from "@/lib/pricing";

export type StatusAnuncio = "no_ar" | "negociando" | "pausado";

export interface AnuncioNaTela {
  id: string;
  produto: string;
  canal: Canal;
  preco: number;
  visitas: number;
  status: StatusAnuncio;
  /**
   * Margem liquida (RN-103), de 0 a 1. `null` significa DUAS coisas
   * diferentes, e a tela precisa distinguir:
   * - o papel nao pode ver (operador) — o campo nem vem;
   * - a conta nao existe (preco zero, item sem custo).
   * Por isso vem junto `margemOculta`.
   */
  margem?: number | null;
}

export interface ListaAnuncios {
  anuncios: AnuncioNaTela[];
  /** `true` quando a margem foi omitida por permissao, nao por falta de dado. */
  margemOculta: boolean;
  /**
   * `true` quando a base do calculo ignorou frete — que e sempre, hoje.
   * A tela avisa; sem isso o numero passa por exato e nao e.
   */
  margemIgnoraFrete: boolean;
}

export interface FiltroAnuncios {
  canal?: Canal;
  status?: StatusAnuncio;
}

export async function listarAnuncios(
  papel: Papel,
  filtro: FiltroAnuncios = {},
): Promise<ListaAnuncios> {
  const mostrarMargem = podeVerCusto(papel);

  const condicoes: SQL[] = [eq(anuncios.is_deleted, false), eq(itens.is_deleted, false)];
  if (filtro.canal) condicoes.push(eq(anuncios.canal, filtro.canal));
  if (filtro.status) condicoes.push(eq(anuncios.status, filtro.status));

  const linhas = await db
    .select({
      id: anuncios.id,
      produto: itens.nome,
      canal: anuncios.canal,
      preco: anuncios.preco,
      visitas: anuncios.visitas,
      status: anuncios.status,
      // O custo entra na consulta SO quando o papel pode ver margem. Trazer e
      // descartar depois deixaria o dado passar por memoria a toa — e o proximo
      // que mexer aqui pode esquecer de descartar.
      custo: mostrarMargem ? itens.custo : sql<string | null>`NULL`,
    })
    .from(anuncios)
    .innerJoin(itens, eq(itens.id, anuncios.item_id))
    .where(and(...condicoes))
    .orderBy(desc(anuncios.visitas));

  return {
    margemOculta: !mostrarMargem,
    margemIgnoraFrete: true,
    anuncios: linhas.map((l) => {
      const preco = Number(l.preco);
      const base: AnuncioNaTela = {
        id: l.id,
        produto: l.produto,
        canal: l.canal,
        preco,
        visitas: l.visitas,
        status: l.status as StatusAnuncio,
      };

      if (!mostrarMargem) return base; // a chave `margem` nem existe

      return {
        ...base,
        margem: margemDoAnuncio({
          preco,
          // ⚠️ SO O CUSTO: o sistema nao guarda frete por item (known-issues).
          // A base fica menor que a real e a margem sai OTIMISTA. A tela avisa.
          base: Number(l.custo ?? 0),
          canal: l.canal,
        }),
      };
    }),
  };
}
