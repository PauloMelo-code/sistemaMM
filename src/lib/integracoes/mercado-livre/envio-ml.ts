/**
 * QUARENTENA do formato do ENVIO do Mercado Livre e da traducao para o status
 * do pedido daqui. Modulo PURO.
 *
 * Conferido na doc oficial em 2026-10-29 (gerenciamento-de-vendas e
 * gerenciamento-de-envios): o pedido traz `shipping.id`; `GET /shipments/{id}`
 * com `x-format-new: true` traz `status`. A doc NAO tem tabela oficial do que
 * cada status significa — a traducao abaixo sai dos exemplos dela, e e
 * deliberadamente conservadora: na duvida, NAO muda o pedido.
 */

export type StatusPedido = "aguardando_envio" | "em_transporte" | "concluido" | "cancelado";

type Json = Record<string, unknown>;

const objeto = (v: unknown): Json | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

const texto = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

/** O que importa do pedido para o status: o proprio status, o envio e as tags. */
export interface PedidoParaEnvio {
  status: string | null;
  idEnvio: string | null;
  /** Tag `delivered`: entregue, para pedido sem envio do ML (retirada, combinado). */
  entregue: boolean;
}

export function lerPedidoParaEnvio(payload: unknown): PedidoParaEnvio {
  const raiz = objeto(payload);
  const tags = Array.isArray(raiz?.tags) ? raiz.tags : [];
  return {
    status: texto(raiz?.status),
    idEnvio: texto(objeto(raiz?.shipping)?.id),
    entregue: tags.includes("delivered"),
  };
}

/** `status` do `/shipments/{id}`. */
export function lerStatusDoEnvio(payload: unknown): string | null {
  return texto(objeto(payload)?.status);
}

/** Envio ainda nao saiu: pagamento confirmado ate a etiqueta pronta. */
const AGUARDANDO = new Set(["pending", "handling", "ready_to_ship"]);

/**
 * O status do pedido daqui, dado o pedido e o envio do ML. `null` = nao mude.
 *
 * - Pedido `cancelled` no ML -> cancelado (sai do faturamento).
 * - Envio `delivered` (ou tag `delivered` sem envio) -> concluido.
 * - Envio `shipped` -> em transporte; pending/handling/ready_to_ship -> aguardando.
 * - `not_delivered` e envio `cancelled` -> NAO muda. O primeiro e devolucao ou
 *   extravio, e o segundo pode ser "enviado por fora do ML" (`shipped_outside_me`)
 *   — cancelar a venda ai apagaria faturamento real. Os dois vao para o fluxo de
 *   devolucao/cancelamento, que olha a reclamacao.
 */
export function statusPedidoPara(pedido: PedidoParaEnvio, statusEnvio: string | null): StatusPedido | null {
  if (pedido.status === "cancelled") return "cancelado";
  if (statusEnvio === "delivered") return "concluido";
  if (statusEnvio === "shipped") return "em_transporte";
  if (statusEnvio && AGUARDANDO.has(statusEnvio)) return "aguardando_envio";
  if (!pedido.idEnvio && pedido.entregue) return "concluido";
  return null;
}
