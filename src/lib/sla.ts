/**
 * FONTE UNICA DA ESCALA DE URGENCIA DO SLA (RN-105 e RN-105.1).
 *
 * Mesma disciplina do `pricing.ts`: quem precisar da cor ou do texto de um prazo
 * IMPORTA daqui. Reimplementar os limites dentro de um componente e o caminho
 * para a tela de Perguntas voltar a mentir — foi exatamente assim que o
 * prototipo acabou pintando a pergunta de 55min mais calma que a de 3h20.
 *
 * O criterio do handoff ("pill vermelha abaixo de 4h") nao discrimina nada: com
 * meta de 4h, TODA pergunta aberta esta abaixo de 4h por definicao. Por isso a
 * urgencia e medida em FRACAO DA META restante — assim a escala continua valendo
 * se a meta for reconfigurada, que a RN-105 permite.
 *
 * COBERTURA HOJE: tela de Perguntas. AINDA NAO COBERTO: o prazo de despacho da
 * Expedicao (RN-106, alerta a 24h do limite) — mesma ideia, meta diferente.
 * Quando a tela entrar, a funcao nasce AQUI, nao no componente.
 *
 * Modulo PURO: nao importa banco, nao importa React, nao le env, nao chama
 * `Date.now()`. Recebe segundos e devolve estado/texto — por isso e testavel
 * sem relogio falso.
 */

/** Meta de resposta em horas (RN-105). Configuravel — hoje 4h. */
export const META_SLA_HORAS = 4;

/** Acima desta fracao da meta a pergunta e rotina: pill neutra. */
export const LIMITE_ATENCAO = 0.5;

/** Abaixo desta fracao da meta a pergunta e urgente: pill vermelha. */
export const LIMITE_URGENTE = 0.25;

/**
 * Estados possiveis de uma pergunta na fila (RN-105.1).
 *
 * A ordem da declaracao E a ordem de urgencia — `ORDEM_ESTADO` depende disso
 * para ordenar a lista sem uma segunda tabela de prioridade.
 */
export type EstadoSla = "vencido" | "urgente" | "atencao" | "neutro" | "respondida";

/** Peso de ordenacao: menor vem primeiro na tela. */
export const ORDEM_ESTADO: Record<EstadoSla, number> = {
  vencido: 0,
  urgente: 1,
  atencao: 2,
  neutro: 3,
  respondida: 4,
};

export interface EntradaSla {
  /**
   * Segundos ate o prazo. Negativo = prazo estourado.
   *
   * Vem calculado pelo PostgreSQL (`prazo_sla - now()`), nao por `Date` do JS:
   * as colunas sao `timestamp without time zone` e a decisao de fuso ainda esta
   * aberta (docs/known-issues.md). Subtraindo dentro do banco, os dois lados da
   * conta vivem no mesmo relogio e a cor nao depende daquela decisao.
   */
  segundosRestantes: number;
  respondida: boolean;
}

/**
 * O estado de uma pergunta segundo a RN-105.1.
 *
 * Respondida ganha precedencia sobre o prazo: uma pergunta respondida com
 * atraso continua respondida — o vermelho serve para chamar acao, e ja nao ha
 * acao a tomar.
 *
 * `segundosRestantes` invalido (NaN, Infinity) cai em `urgente`, nunca em
 * `neutro`: se o prazo de uma pergunta se perdeu, o erro seguro e a fila
 * chamar atencao para ela, nao esconde-la no meio da lista.
 */
export function classificarSla(
  { segundosRestantes, respondida }: EntradaSla,
  metaHoras: number = META_SLA_HORAS,
): EstadoSla {
  if (respondida) return "respondida";
  if (!Number.isFinite(segundosRestantes)) return "urgente";
  if (segundosRestantes <= 0) return "vencido";

  const metaSegundos = metaHoras * 3600;
  // Meta invalida (zero, negativa, NaN) tornaria a fracao inutil — sem meta nao
  // ha escala, e o seguro e tratar como urgente pelo mesmo motivo acima.
  if (!(metaSegundos > 0)) return "urgente";

  const fracao = segundosRestantes / metaSegundos;
  if (fracao < LIMITE_URGENTE) return "urgente";
  if (fracao < LIMITE_ATENCAO) return "atencao";
  return "neutro";
}

/**
 * Duracao curta em pt-BR: "3h 20min", "55min", "agora".
 *
 * Minuto e a menor unidade exibida — segundo piscando numa fila de trabalho e
 * ruido. Truncar (nao arredondar) e proposital: com 3h 20min 45s restantes a
 * tela diz "3h 20min", nunca "3h 21min". Prazo nao se arredonda para cima.
 */
export function formatarDuracao(segundos: number): string {
  if (!Number.isFinite(segundos)) return "—";

  const totalMin = Math.floor(Math.abs(segundos) / 60);
  if (totalMin === 0) return "agora";

  const horas = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (horas === 0) return `${min}min`;
  if (min === 0) return `${horas}h`;
  return `${horas}h ${min}min`;
}

/**
 * O texto da pill de prazo, no formato do prototipo ("3h 20min restantes").
 * Vencida troca a frase inteira — "menos 12min restantes" nao se diz.
 */
export function textoPrazo(segundosRestantes: number): string {
  if (!Number.isFinite(segundosRestantes)) return "prazo indefinido";
  // "há" COM acento: isto vai para a pill vermelha que o Anderson le o dia
  // inteiro. Os comentarios desta base sao sem acento; o texto de TELA nao.
  if (segundosRestantes <= 0) return `vencida há ${formatarDuracao(segundosRestantes)}`;
  return `${formatarDuracao(segundosRestantes)} restantes`;
}
