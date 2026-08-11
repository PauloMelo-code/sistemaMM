/**
 * Reconciliacao de pedidos do Mercado Livre.
 *
 * POR QUE EXISTE: nenhum marketplace garante 100% de entrega de notificacao. Se
 * uma venda se perder, o sistema **nao sabe que nao soube** — o item continua
 * anunciado, continua no site, e a descoberta vem quando o segundo comprador
 * paga. Idempotencia nao ajuda: nao da para ser idempotente sobre um evento que
 * nunca chegou.
 *
 * COMO CORRIGE (e o quanto NAO corrige):
 *
 * Achando um pedido pago que nao temos, ela **grava um evento sintetico** em
 * `integracoes_eventos`, exatamente como se o webhook tivesse chegado. Quem
 * processa e o handler de venda que ja existe — idempotente, protegido pela
 * RN-112, com a logica de dinheiro ja testada. **Nenhuma rota de correcao
 * paralela**, que seria uma segunda implementacao da mesma regra para divergir
 * depois.
 *
 * Esse e o UNICO caso auto-corrigido: "o canal diz vendido e nos nao sabiamos".
 * Toda outra divergencia so REPORTA — inclusive a inversa (nos dizemos vendido,
 * o canal diz ativo), que pode ser leitura errada e, corrigida sozinha, pausaria
 * anuncio certo.
 *
 * ⚠️ "Corrige ou so reporta" ainda e decisao do Anderson (docs/known-issues.md).
 * O que esta aqui e a recomendacao da analise de corretude, nao confirmacao.
 *
 * Roda na lane `varredura`: reconciliacao nunca passa na frente de uma venda ou
 * de uma pergunta com SLA correndo.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { integracoesSincronizacoes } from "@/lib/db/schema/integracoes-sincronizacoes";
import { pedidos } from "@/lib/db/schema/pedidos";

import { chamarML } from "./client";
import { STATUS_PAGO } from "./pedido-ml";
import {
  MAX_PAGINAS,
  alcancouMarcaDagua,
  lerPaginaPedidos,
  urlBuscaPedidos,
  type ResumoPedido,
} from "./busca-pedidos";
import { registrarEvento } from "../eventos";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";

const RECURSO = "pedidos";

export interface ResumoReconciliacao {
  /** Pedidos pagos que o canal listou dentro da janela conferida. */
  conferidos: number;
  /** Pagos que nao existiam aqui — reinjetados como evento. */
  reinjetados: number;
  /** Ja conhecidos: o webhook tinha chegado. O caso normal. */
  jaConhecidos: number;
  /** Linhas em formato inesperado, ignoradas sem derrubar a passada. */
  descartados: number;
  paginas: number;
  /** `true` quando o teto de paginas cortou antes da marca d'agua. */
  truncada: boolean;
}

/** A marca d'agua atual. Cria a linha na primeira execucao. */
async function marcaDagua(): Promise<Date | null> {
  const [linha] = await db
    .select()
    .from(integracoesSincronizacoes)
    .where(
      and(
        eq(integracoesSincronizacoes.canal, "mercado_livre"),
        eq(integracoesSincronizacoes.recurso, RECURSO),
        eq(integracoesSincronizacoes.is_deleted, false),
      ),
    );

  if (linha) return linha.ate_qual_instante;

  await db
    .insert(integracoesSincronizacoes)
    .values({ canal: "mercado_livre", recurso: RECURSO, modified_by: USUARIO_SISTEMA_ID })
    .onConflictDoNothing();
  return null;
}

/**
 * Grava o desfecho da passada.
 *
 * `ultimo_sucesso_em` so avanca quando deu certo — e o que alimenta o alarme de
 * obsolescencia. A marca d'agua tambem so avanca no sucesso: avancar depois de
 * uma passada truncada ou com erro criaria um vao que ninguem conferiria nunca
 * mais.
 */
async function gravarPassada(
  resultado: Record<string, unknown>,
  { ate, sucesso }: { ate: Date | null; sucesso: boolean },
): Promise<void> {
  const agora = new Date();
  await db
    .update(integracoesSincronizacoes)
    .set({
      resultado,
      updated_at: agora,
      modified_by: USUARIO_SISTEMA_ID,
      ...(sucesso ? { ultimo_sucesso_em: agora } : {}),
      ...(sucesso && ate ? { ate_qual_instante: ate } : {}),
    })
    .where(
      and(
        eq(integracoesSincronizacoes.canal, "mercado_livre"),
        eq(integracoesSincronizacoes.recurso, RECURSO),
        eq(integracoesSincronizacoes.is_deleted, false),
      ),
    );
}

/** Quais destes numeros de pedido ja existem aqui. */
async function jaTemos(numeros: string[]): Promise<Set<string>> {
  if (numeros.length === 0) return new Set();
  const linhas = await db
    .select({ numero: pedidos.numero })
    .from(pedidos)
    .where(and(eq(pedidos.canal, "mercado_livre"), inArray(pedidos.numero, numeros)));
  return new Set(linhas.map((l) => l.numero));
}

/**
 * Reinjeta a notificacao perdida.
 *
 * O corpo e DETERMINISTICO (so o recurso e a origem): a chave do evento e o
 * hash dele, entao rodar a reconciliacao duas vezes gera a mesma chave e a
 * segunda nao entra. Sem isso, cada passada criaria um evento novo para o mesmo
 * pedido e a fila cresceria sozinha.
 *
 * `origem: "reconciliacao"` fica no corpo de proposito: e o que permite, depois,
 * medir quantas vendas so entraram porque o webhook falhou.
 */
async function reinjetar(pedido: ResumoPedido): Promise<boolean> {
  const corpo = JSON.stringify({
    topic: "orders_v2",
    resource: `/orders/${pedido.numero}`,
    origem: "reconciliacao",
  });
  const { novo } = await registrarEvento({ canal: "mercado_livre", corpoCru: corpo });
  return novo;
}

/** Id da conta conectada. Sem credencial, nao ha o que reconciliar. */
async function contaConectada(): Promise<string | null> {
  const r = await db.execute<{ conta: string | null }>(sql`
    SELECT conta_externa_id AS conta FROM integracoes_credenciais
    WHERE canal = 'mercado_livre' AND is_deleted = false LIMIT 1
  `);
  return r.rows[0]?.conta ?? null;
}

export async function reconciliarPedidosML(): Promise<ResumoReconciliacao> {
  const vendedor = await contaConectada();
  if (!vendedor) {
    throw new Error(
      "Sem credencial do Mercado Livre: nao ha conta para reconciliar (known-issues 🔴).",
    );
  }

  const marca = await marcaDagua();
  const resumo: ResumoReconciliacao = {
    conferidos: 0,
    reinjetados: 0,
    jaConhecidos: 0,
    descartados: 0,
    paginas: 0,
    truncada: false,
  };

  let maisRecente: Date | null = null;

  try {
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const bruto = await chamarML<unknown>(urlBuscaPedidos({ vendedor, pagina }), {
        // Varredura: nunca na frente de venda ou pergunta com SLA correndo.
        lane: "varredura",
      });

      const { pedidos: lista, descartados } = lerPaginaPedidos(bruto);
      resumo.paginas += 1;
      resumo.descartados += descartados;
      if (lista.length === 0) break;

      for (const p of lista) {
        if (!maisRecente || p.vendidoEm > maisRecente) maisRecente = p.vendidoEm;
      }

      // So pedido PAGO vira venda (RN-115). Os demais estados existem e chegam;
      // cada um pede tratamento proprio, que ainda nao foi desenhado.
      const pagos = lista.filter((p) => p.status === STATUS_PAGO);
      const conhecidos = await jaTemos(pagos.map((p) => p.numero));

      for (const p of pagos) {
        resumo.conferidos += 1;
        if (conhecidos.has(p.numero)) {
          resumo.jaConhecidos += 1;
          continue;
        }
        if (await reinjetar(p)) resumo.reinjetados += 1;
        console.warn(
          `[reconciliacao] pedido ${p.numero} existia no ML e NAO aqui — ` +
            "notificacao perdida, reinjetada como evento",
        );
      }

      if (alcancouMarcaDagua(lista, marca)) break;
      if (pagina === MAX_PAGINAS - 1) resumo.truncada = true;
    }

    // Passada truncada NAO avanca a marca: avancar deixaria para tras um vao
    // que ninguem conferiria nunca mais.
    await gravarPassada({ ...resumo }, {
      ate: resumo.truncada ? null : maisRecente,
      sucesso: !resumo.truncada,
    });

    return resumo;
  } catch (erro) {
    await gravarPassada(
      { ...resumo, erro: erro instanceof Error ? erro.message : String(erro) },
      { ate: null, sucesso: false },
    );
    throw erro;
  }
}
