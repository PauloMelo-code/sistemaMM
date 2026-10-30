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

/** O registro. Ver o cabecalho deste arquivo antes de acrescentar. */
export const HANDLERS = new Map<string, Handler>();

// Venda no Mercado Livre (RN-104, RN-112). O handler busca o pedido na API com
// o nosso token — sem credencial ele falha na primeira chamada, e o evento fica
// na fila com o erro visivel, que e o comportamento desejado: nada e deduzido
// do corpo do POST.
//
// O `import` e DINAMICO de proposito, e nao por estilo: `handler-venda` importa
// `db`, e importar `db` instancia um Pool do Postgres na avaliacao do modulo.
// Estaticamente, este arquivo deixaria de ser puro e `worker.test.ts` — que
// importa `chaveHandler` daqui — passaria a exigir banco no ar so para carregar.
// Registrar aqui dentro (em vez de num `registro.ts` a parte) tambem impede o
// modo de falha silencioso em que alguem esquece de importar o registro e a
// fila simplesmente nunca processa nada.
HANDLERS.set(chaveHandler("mercado_livre", "orders_v2"), async (evento) => {
  const { handlerVendaML } = await import("./mercado-livre/handler-venda");
  await handlerVendaML(evento);
});

// Envio mudou de estado (saiu, entregou) — o status do pedido acompanha.
HANDLERS.set(chaveHandler("mercado_livre", "shipments"), async (evento) => {
  const { handlerEnvioML } = await import("./mercado-livre/atualizacao-envios");
  await handlerEnvioML(evento);
});

// Reclamacao/devolucao (grupo "Post Purchase" do DevCenter) — RN-126. A doc diz
// `topic: "post_purchase"`; `claims` fica registrado tambem, porque o nome do
// subtopico e o que aparece no DevCenter e custa uma linha.
const reclamacao: Handler = async (evento) => {
  const { handlerReclamacaoML } = await import("./mercado-livre/devolucoes");
  await handlerReclamacaoML(evento);
};
HANDLERS.set(chaveHandler("mercado_livre", "post_purchase"), reclamacao);
HANDLERS.set(chaveHandler("mercado_livre", "claims"), reclamacao);

// Pergunta nova (ou respondida pelo painel do ML) — RN-105. Mesmo motivo do
// `import` dinamico acima.
HANDLERS.set(chaveHandler("mercado_livre", "questions"), async (evento) => {
  const { handlerPerguntaML } = await import("./mercado-livre/importacao-perguntas");
  await handlerPerguntaML(evento);
});
