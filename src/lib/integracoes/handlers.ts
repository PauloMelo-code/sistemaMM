/**
 * Registro de handlers de evento — quem sabe o que fazer com cada notificacao.
 *
 * ESTA VAZIO DE PROPOSITO. Pela RN-117, processar um evento significa ir buscar
 * o recurso na API do canal com o NOSSO token; o corpo do POST nunca e fonte de
 * verdade. Como nao existe credencial do Mercado Livre nem confirmacao de acesso
 * a API da OLX (docs/known-issues.md 🔴), nao ha um unico handler que possa ser
 * escrito com honestidade hoje.
 *
 * A consequencia disso e boa: o worker filtra a fila pelos topicos que TEM
 * handler, entao com o registro vazio ele nao reivindica nada e nenhum evento
 * gasta tentativa a toa. Os eventos ficam acumulados na tabela e sao processados
 * retroativamente no dia em que o handler existir — e esse e exatamente o valor
 * de ter uma caixa de entrada em vez de processar dentro do request.
 *
 * Para registrar um handler quando a credencial chegar:
 *
 *   HANDLERS.set(chaveHandler("mercado_livre", "orders_v2"), async (evento) => {
 *     const pedido = await clienteML.buscar(evento.recurso);  // GET, com token
 *     await registrarVenda(pedido);                            // idempotente
 *   });
 *
 * Contrato do handler:
 * - **Idempotente.** Ele PODE rodar duas vezes com o mesmo evento — a trava do
 *   banco cobre a entrega, nao o efeito (ver known-issues 🟢).
 * - **Lanca excecao para falhar.** Quem lanca vira retentativa; quem retorna
 *   normalmente marca o evento como processado.
 * - **Nunca confia em `corpo`.** Use `recurso` para saber o que buscar.
 */
import type { Canal } from "@/lib/pricing";

export interface EventoParaHandler {
  id: string;
  canal: Canal;
  topico: string | null;
  /** O que buscar na API do canal. E daqui que sai o dado real. */
  recurso: string | null;
  /** Envelope cru. Prova, NAO fonte — ver RN-117. */
  corpo: unknown;
  /** Quantas vezes este evento ja foi reivindicado, contando a atual. */
  tentativas: number;
}

export type Handler = (evento: EventoParaHandler) => Promise<void>;

/**
 * Chave do registro. Topico nulo vira string vazia — vale como "qualquer
 * notificacao deste canal", util para canal que nao mande topico nenhum.
 */
export function chaveHandler(canal: string, topico: string | null): string {
  return `${canal}:${topico ?? ""}`;
}

/** O registro. Vazio ate existir credencial — ver o cabecalho deste arquivo. */
export const HANDLERS = new Map<string, Handler>();
