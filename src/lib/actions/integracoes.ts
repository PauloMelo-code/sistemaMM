/**
 * Estado real das integracoes — o que a tela Integracoes precisa saber.
 *
 * O PROTOTIPO desenhou esta tela como cinco cards com pill "Conectado" fixa e
 * nenhum estado de erro. A auditoria registrou isso como o defeito principal
 * dela: token OAuth expira, e quando o ML cai, quatro das doze telas envelhecem
 * **em silencio** — o painel continua bonito e o Anderson descobre pelo cliente.
 *
 * Entao aqui as pills saem de fato do banco, e junto vem o que so passou a
 * existir com a integracao: fila parada, tarefa esgotada, reconciliacao velha.
 *
 * NUNCA devolve token, nem pedaco dele. So se ha credencial e quando vence.
 */
import { asc, count, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { integracoesMlAnuncios } from "@/lib/db/schema/integracoes-ml-anuncios";
import { chamarML } from "@/lib/integracoes/mercado-livre/client";
import { MAX_TENTATIVAS } from "@/lib/integracoes/retentativa";
import type { Canal } from "@/lib/pricing";

/**
 * Estado de uma conexao.
 *
 * `nao_configurado` e diferente de `erro` de proposito: "nunca foi ligado" e
 * pendencia de setup; "estava ligado e quebrou" e incidente. Misturar os dois
 * faria o painel gritar vermelho desde o primeiro dia e ninguem mais olharia.
 */
export type EstadoConexao = "conectado" | "vencendo" | "vencido" | "nao_configurado";

export interface Conexao {
  canal: Canal;
  estado: EstadoConexao;
  /** Segundos ate o token vencer. Negativo = venceu. Nulo sem credencial. */
  segundosAteVencer: number | null;
  contaExterna: string | null;
}

export interface Fila {
  eventosPendentes: number;
  eventosEsgotados: number;
  tarefasPendentes: number;
  /** Tarefas que desistiram: anuncio pode ter ficado NO AR com item vendido. */
  tarefasEsgotadas: number;
  /** Tarefas que nenhum executor sabe fazer — hoje, as da OLX sem decisao. */
  tarefasSemExecutor: number;
}

export interface Sincronizacao {
  recurso: string;
  /** Segundos desde a ultima passada bem-sucedida. Nulo = nunca teve. */
  segundosDesdeSucesso: number | null;
  ateQualInstante: Date | null;
}

export interface EstadoIntegracoes {
  conexoes: Conexao[];
  fila: Fila;
  sincronizacoes: Sincronizacao[];
}

/** Margem em que o token ja conta como "vencendo" (1h). */
export const MARGEM_VENCENDO_S = 3600;

/**
 * Reconciliacao mais velha que isto e obsoleta.
 *
 * A analise pede cadencia de 15-30 min; 90 minutos da folga para duas passadas
 * falharem antes de acusar. Enquanto **nada agenda** a reconciliacao, o estado
 * util e "nunca executou" — e por isso `segundosDesdeSucesso` nulo NAO e tratado
 * como obsoleto: falta de setup nao e incidente.
 */
export const LIMITE_OBSOLESCENCIA_S = 90 * 60;

/** Um anuncio importado do ML, como a tela de importados mostra (RN-123). */
export interface AnuncioImportado {
  id: string;
  idExterno: string;
  titulo: string;
  /** `SELLER_SKU`, ou o `seller_custom_field` quando so ele existir. */
  sku: string | null;
  skuDuplicado: boolean;
  status: string;
  preco: number;
  qtdDisponivel: number;
  qtdVendida: number;
  tipoAnuncio: string;
  permalink: string | null;
  foto: string | null;
  vinculado: boolean;
}

/**
 * Os anuncios importados, mais vendidos primeiro, e quando foi a ultima
 * importacao. SKU duplicado e calculado aqui, sobre a conta inteira — e o que
 * bloqueia o vinculo (RN-123).
 */
export async function lerAnunciosImportados(): Promise<{
  anuncios: AnuncioImportado[];
  ultimaImportacao: Date | null;
}> {
  const linhas = await db
    .select()
    .from(integracoesMlAnuncios)
    .where(eq(integracoesMlAnuncios.is_deleted, false))
    .orderBy(desc(integracoesMlAnuncios.qtd_vendida), asc(integracoesMlAnuncios.titulo));

  const skuDe = (l: (typeof linhas)[number]) => l.sku ?? l.campo_vendedor;
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    const sku = skuDe(l);
    if (sku) contagem.set(sku, (contagem.get(sku) ?? 0) + 1);
  }

  let ultimaImportacao: Date | null = null;
  const anuncios = linhas.map((l): AnuncioImportado => {
    if (!ultimaImportacao || l.sincronizado_em > ultimaImportacao) ultimaImportacao = l.sincronizado_em;
    const sku = skuDe(l);
    return {
      id: l.id,
      idExterno: l.id_externo,
      titulo: l.titulo,
      sku,
      skuDuplicado: sku !== null && (contagem.get(sku) ?? 0) > 1,
      status: l.status,
      preco: Number(l.preco),
      qtdDisponivel: l.qtd_disponivel,
      qtdVendida: l.qtd_vendida,
      tipoAnuncio: l.tipo_anuncio,
      permalink: l.permalink,
      foto: l.fotos[0]?.url ?? null,
      vinculado: l.item_id !== null,
    };
  });

  return { anuncios, ultimaImportacao };
}

/** So o total, para o link do card na tela Integracoes. */
export async function contarAnunciosImportados(): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(integracoesMlAnuncios)
    .where(eq(integracoesMlAnuncios.is_deleted, false));
  return linha?.total ?? 0;
}

/** Quem esta do outro lado do token — so o que a tela mostra. */
export interface UsuarioML {
  id: number;
  nickname: string;
  siteId: string;
  /** Tag `user_product_seller`: a conta publica com `family_name`, nao `title`. */
  emUserProducts: boolean;
}

/**
 * `GET /users/me` — a prova de que o token funciona, nao so de que existe.
 *
 * So leitura. Passa pelo `chamarML`, entao um token perto de vencer e renovado
 * aqui mesmo. Lanca `SemCredencialError`/`ReautorizacaoNecessariaError`/`ErroML`;
 * quem chama decide o que mostrar. E-mail e dados pessoais nao saem daqui.
 */
export async function lerUsuarioML(): Promise<UsuarioML> {
  const dados = await chamarML<{ id: number; nickname: string; site_id: string; tags?: string[] }>(
    "/users/me",
  );
  return {
    id: dados.id,
    nickname: dados.nickname,
    siteId: dados.site_id,
    emUserProducts: dados.tags?.includes("user_product_seller") ?? false,
  };
}

/**
 * So o estado das conexoes — uma consulta. Separada do resto para o shell do
 * painel (sidebar) nao pagar as consultas de fila e conferencia em toda
 * navegacao.
 */
export async function lerConexoes(): Promise<Conexao[]> {
  const credenciais = await db.execute<{
    canal: Canal;
    conta: string | null;
    segundos: number;
  }>(sql`
    SELECT canal, conta_externa_id AS conta,
           EXTRACT(EPOCH FROM (expira_em - now()))::double precision AS segundos
    FROM integracoes_credenciais
    WHERE is_deleted = false
  `);

  const porCanal = new Map(credenciais.rows.map((l) => [l.canal, l]));
  const canais: Canal[] = ["mercado_livre", "olx", "whatsapp"];

  return canais.map((canal): Conexao => {
    const linha = porCanal.get(canal);
    if (!linha) {
      return { canal, estado: "nao_configurado", segundosAteVencer: null, contaExterna: null };
    }
    const estado: EstadoConexao =
      linha.segundos <= 0 ? "vencido" : linha.segundos <= MARGEM_VENCENDO_S ? "vencendo" : "conectado";
    return {
      canal,
      estado,
      segundosAteVencer: linha.segundos,
      contaExterna: linha.conta,
    };
  });
}

export async function lerEstadoIntegracoes(): Promise<EstadoIntegracoes> {
  const conexoes = await lerConexoes();

  const [eventos] = (
    await db.execute<{ pendentes: number; esgotados: number }>(sql`
      SELECT count(*) FILTER (WHERE tentativas <  ${MAX_TENTATIVAS})::int AS pendentes,
             count(*) FILTER (WHERE tentativas >= ${MAX_TENTATIVAS})::int AS esgotados
      FROM integracoes_eventos
      WHERE processado_em IS NULL AND is_deleted = false
    `)
  ).rows;

  // `sem_executor` sai de uma lista fixa e nao do registro de executores: esta
  // consulta roda no server component da tela, e importar o registro traria
  // junto o cliente do ML. A tela so precisa saber que ha tarefa parada.
  const [tarefas] = (
    await db.execute<{ pendentes: number; esgotadas: number; sem_executor: number }>(sql`
      SELECT count(*) FILTER (WHERE tentativas <  ${MAX_TENTATIVAS})::int AS pendentes,
             count(*) FILTER (WHERE tentativas >= ${MAX_TENTATIVAS})::int AS esgotadas,
             count(*) FILTER (WHERE tentativas = 0 AND canal = 'olx')::int  AS sem_executor
      FROM integracoes_tarefas
      WHERE processado_em IS NULL AND is_deleted = false
    `)
  ).rows;

  const sincronizacoes = await db.execute<{
    recurso: string;
    segundos: number | null;
    ate: Date | null;
  }>(sql`
    SELECT recurso,
           EXTRACT(EPOCH FROM (now() - ultimo_sucesso_em))::double precision AS segundos,
           ate_qual_instante AS ate
    FROM integracoes_sincronizacoes
    WHERE is_deleted = false
    ORDER BY recurso
  `);

  return {
    conexoes,
    fila: {
      eventosPendentes: eventos?.pendentes ?? 0,
      eventosEsgotados: eventos?.esgotados ?? 0,
      tarefasPendentes: tarefas?.pendentes ?? 0,
      tarefasEsgotadas: tarefas?.esgotadas ?? 0,
      tarefasSemExecutor: tarefas?.sem_executor ?? 0,
    },
    sincronizacoes: sincronizacoes.rows.map((l) => ({
      recurso: l.recurso,
      segundosDesdeSucesso: l.segundos,
      ateQualInstante: l.ate,
    })),
  };
}
