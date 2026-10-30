/**
 * QUARENTENA do formato da PERGUNTA do Mercado Livre: tudo o que o sistema
 * presume sobre `/questions/search` e `/questions/{id}` (com `api_version=4`)
 * esta aqui, e em nenhum outro arquivo.
 *
 * ⚠️ Escrito a partir da documentacao publica, nao de uma resposta real.
 * Confira na primeira importacao.
 *
 * Campo obrigatorio ausente faz LANCAR (mesma politica de `pedido-ml.ts`): uma
 * pergunta gravada com data inventada teria prazo de SLA inventado (RN-105).
 *
 * Modulo PURO: nao chama rede nem banco.
 */
import { META_SLA_HORAS } from "../../sla.ts";

/** Status do ML que viram pergunta na caixa. Os demais nao pedem acao. */
const STATUS_PENDENTE = "UNANSWERED";
const STATUS_RESPONDIDA = "ANSWERED";

/**
 * Status em que a pergunta deixou de existir para o vendedor: excluida pelo
 * comprador, banida, encerrada sem resposta (anuncio fechado), desativada.
 * `UNDER_REVIEW` fica de fora de proposito: e passageiro, a pergunta pode voltar.
 */
const STATUS_ENCERRADOS = new Set(["DELETED", "BANNED", "CLOSED_UNANSWERED", "DISABLED"]);

export interface PerguntaML {
  idExterno: string;
  idAnuncio: string;
  texto: string;
  /** Quando o COMPRADOR perguntou — base do prazo, nunca a hora da importacao. */
  feitaEm: Date;
  prazoSla: Date;
  status: "pendente" | "respondida";
  resposta: string | null;
  respondidaEm: Date | null;
  idVendedor: string | null;
}

export class PerguntaMLInvalidaError extends Error {
  constructor(motivo: string) {
    super(
      `Pergunta do Mercado Livre em formato inesperado: ${motivo}. ` +
        "O mapeamento vive em src/lib/integracoes/mercado-livre/pergunta-ml.ts.",
    );
    this.name = "PerguntaMLInvalidaError";
  }
}

type Json = Record<string, unknown>;

const objeto = (v: unknown): Json | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

const texto = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

const data = (v: unknown): Date | null => {
  const t = texto(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Le uma pergunta. Devolve `null` para status que nao pede acao — encerrada sem
 * resposta, banida, excluida, em revisao. Elas existem, mas nao sao trabalho de
 * ninguem na caixa.
 */
export function lerPerguntaML(payload: unknown): PerguntaML | null {
  const raiz = objeto(payload);
  if (!raiz) throw new PerguntaMLInvalidaError("o corpo nao e um objeto JSON");

  const status = texto(raiz.status);
  if (status !== STATUS_PENDENTE && status !== STATUS_RESPONDIDA) return null;

  const idExterno = texto(raiz.id);
  if (!idExterno) throw new PerguntaMLInvalidaError("sem `id`");
  const idAnuncio = texto(raiz.item_id);
  if (!idAnuncio) throw new PerguntaMLInvalidaError("sem `item_id`");
  const pergunta = texto(raiz.text);
  if (!pergunta) throw new PerguntaMLInvalidaError("sem `text`");
  const feitaEm = data(raiz.date_created);
  if (!feitaEm) throw new PerguntaMLInvalidaError("`date_created` ausente ou ilegivel");

  const resposta = objeto(raiz.answer);
  const respondida = status === STATUS_RESPONDIDA;

  return {
    idExterno,
    idAnuncio,
    texto: pergunta,
    feitaEm,
    prazoSla: new Date(feitaEm.getTime() + META_SLA_HORAS * 3600 * 1000),
    status: respondida ? "respondida" : "pendente",
    resposta: respondida && resposta ? texto(resposta.text) : null,
    respondidaEm: respondida && resposta ? data(resposta.date_created) : null,
    idVendedor: texto(raiz.seller_id),
  };
}

/**
 * A pergunta foi encerrada no ML? Uma pergunta que ja esta na caixa como
 * pendente e o ML diz isto precisa SAIR — senao fica la para sempre, com o SLA
 * vencido crescendo, sem existir em lugar nenhum.
 */
export function perguntaEncerradaNoML(payload: unknown): boolean {
  const status = texto(objeto(payload)?.status);
  return status !== null && STATUS_ENCERRADOS.has(status);
}

/** Id de uma pergunta crua, para casar com a caixa mesmo quando ela nao e lida. */
export function idDaPergunta(payload: unknown): string | null {
  return texto(objeto(payload)?.id);
}

/** Uma pagina do `/questions/search`: as perguntas e o total da conta. */
export function lerPaginaPerguntas(payload: unknown): { perguntas: unknown[]; total: number } {
  const raiz = objeto(payload);
  if (!raiz || !Array.isArray(raiz.questions)) {
    throw new PerguntaMLInvalidaError("busca sem `questions`");
  }
  const total = typeof raiz.total === "number" ? raiz.total : raiz.questions.length;
  return { perguntas: raiz.questions, total };
}
