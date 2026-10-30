/**
 * QUARENTENA do formato da RECLAMACAO e da DEVOLUCAO do Mercado Livre, e da
 * decisao que sai delas (RN-126). Modulo PURO.
 *
 * Conferido na doc oficial em 2026-10-29 (gerenciar-reclamacoes,
 * gerenciar-devolucoes):
 * - `GET /post-purchase/v1/claims/{id}`: `resource` + `resource_id` (o pedido),
 *   `status`, `related_entities` (contem "return" quando ha devolucao),
 *   `resolution.reason`.
 * - `GET /post-purchase/v2/claims/{id}/returns`: `status` (delivered = chegou ao
 *   vendedor), `status_money` (refunded = dinheiro devolvido), `subtype`
 *   (low_cost = sem devolucao fisica).
 *
 * ⚠️ Escrito a partir da documentacao, nao de uma resposta real. A doc nao diz
 * explicitamente o que acontece com o pedido numa devolucao — por isso a decisao
 * abaixo e conservadora: so cancela quando o dinheiro voltou ao comprador.
 */

type Json = Record<string, unknown>;

const objeto = (v: unknown): Json | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

const texto = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

export interface ReclamacaoML {
  id: string;
  /** Numero do pedido, quando a reclamacao e sobre um pedido. */
  numeroPedido: string | null;
  status: string | null;
  temDevolucao: boolean;
  /** `resolution.reason` — preenchido quando a reclamacao fechou. */
  motivoResolucao: string | null;
}

export function lerReclamacao(payload: unknown): ReclamacaoML | null {
  const raiz = objeto(payload);
  const id = texto(raiz?.id);
  if (!raiz || !id) return null;

  const relacionadas = Array.isArray(raiz.related_entities) ? raiz.related_entities : [];
  return {
    id,
    numeroPedido: raiz.resource === "order" ? texto(raiz.resource_id) : null,
    status: texto(raiz.status),
    temDevolucao: relacionadas.includes("return"),
    motivoResolucao: texto(objeto(raiz.resolution)?.reason),
  };
}

export interface DevolucaoML {
  status: string | null;
  statusDinheiro: string | null;
  subtipo: string | null;
}

export function lerDevolucao(payload: unknown): DevolucaoML | null {
  // A rota pode devolver o objeto ou uma lista com ele.
  const raiz = objeto(Array.isArray(payload) ? payload[0] : payload);
  if (!raiz) return null;
  return {
    status: texto(raiz.status),
    statusDinheiro: texto(raiz.status_money),
    subtipo: texto(raiz.subtype),
  };
}

/** Motivos de resolucao em que o comprador recebeu o dinheiro de volta. */
const RESOLUCAO_COM_REEMBOLSO = new Set(["payment_refunded", "partial_refunded", "reimbursed", "item_returned"]);

/**
 * - `devolvido`: a peca voltou e o dinheiro tambem -> cancela, "a conferir".
 * - `reembolso_sem_volta`: dinheiro devolvido, peca nao volta -> cancela, nada a conferir.
 * - `null`: ainda em andamento, ou fechou sem reembolso -> nao mexe.
 */
export type DecisaoDevolucao = "devolvido" | "reembolso_sem_volta" | null;

export function decidirDevolucao(rec: ReclamacaoML, dev: DevolucaoML | null): DecisaoDevolucao {
  if (rec.temDevolucao && dev) {
    if (dev.statusDinheiro !== "refunded") return null;
    if (dev.subtipo === "low_cost") return "reembolso_sem_volta";
    return dev.status === "delivered" ? "devolvido" : null;
  }
  // Sem devolucao: so a reclamacao FECHADA com reembolso cancela a venda.
  if (rec.status === "closed" && rec.motivoResolucao && RESOLUCAO_COM_REEMBOLSO.has(rec.motivoResolucao)) {
    return "reembolso_sem_volta";
  }
  return null;
}

/** Uma pagina do `/post-purchase/v1/claims/search`. */
export function lerPaginaReclamacoes(payload: unknown): unknown[] {
  const raiz = objeto(payload);
  return Array.isArray(raiz?.data) ? raiz.data : Array.isArray(raiz?.results) ? raiz.results : [];
}
