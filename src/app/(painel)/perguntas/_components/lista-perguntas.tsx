"use client";

import { useEffect, useState } from "react";

import type { PerguntaNaFila } from "@/lib/actions/perguntas";
import type { Canal } from "@/lib/pricing";
import { classificarSla, formatarDuracao, textoPrazo, type EstadoSla } from "@/lib/sla";

/**
 * A fila de perguntas com o prazo vivo.
 *
 * Client component por um motivo so: a cor do SLA precisa ACENDER SOZINHA. Uma
 * pagina renderizada as 10h00 mostrando "1h 05min restantes" continuaria dizendo
 * isso as 10h50 — e a tela existe justamente para nao deixar o prazo passar.
 * Nada aqui busca dados; a lista chega pronta do servidor.
 */

/**
 * Cor de cada estado (RN-105.1), so com token do design system.
 *
 * `vencido` inverte o vermelho (fundo cheio, texto claro) em vez de inventar um
 * "vermelho mais forte": e o unico degrau visual acima de `urgente` que a
 * paleta oferece sem cor nova.
 */
const CLASSE_PILL: Record<EstadoSla, string> = {
  vencido: "bg-danger text-card font-medium",
  urgente: "bg-danger-soft text-danger",
  atencao: "bg-warning-soft text-warning-text",
  neutro: "bg-table-head text-ink-2",
  respondida: "bg-success-soft text-success",
};

const ROTULO_CANAL: Record<Canal, string> = {
  mercado_livre: "Mercado Livre",
  olx: "OLX",
  // O identificador e `whatsapp` no banco inteiro; "Venda direta" e o rotulo de
  // tela do handoff. Rotulo nao e identificador — ver pricing.ts.
  whatsapp: "Venda direta/WhatsApp",
};

/**
 * De quanto em quanto tempo o prazo e recalculado.
 *
 * 30s para a pill nunca ficar mais de meio minuto atrasada num texto que conta
 * minutos. Barato: e aritmetica em memoria, sem rede e sem re-fetch.
 */
const INTERVALO_MS = 30_000;

/**
 * Id do aviso que explica por que os botoes estao apagados.
 *
 * Um so elemento descreve TODOS os botoes da fila: `aria-describedby` aceita o
 * mesmo id em varios controles, e repetir a frase por pergunta seria ruido para
 * quem usa leitor de tela.
 */
const ID_AVISO_COMPOSITOR = "aviso-compositor";

interface ListaPerguntasProps {
  perguntas: PerguntaNaFila[];
  /** Ha pergunta alem do limite da consulta — a fila mostrada nao e tudo. */
  truncada: boolean;
}

export function ListaPerguntas({ perguntas, truncada }: ListaPerguntasProps) {
  // Segundos passados desde que a pagina montou. Comeca em 0 para o primeiro
  // render bater exatamente com o HTML do servidor (senao: erro de hidratacao).
  const [decorridos, setDecorridos] = useState(0);

  useEffect(() => {
    const inicio = Date.now();
    // Diferenca de `Date.now()` em vez de somar +30 a cada tick: aba em segundo
    // plano tem timer estrangulado pelo navegador, e um contador incremental
    // acordaria atrasado — mostrando prazo que ja passou como se nao tivesse.
    const id = setInterval(
      () => setDecorridos(Math.floor((Date.now() - inicio) / 1000)),
      INTERVALO_MS,
    );
    return () => clearInterval(id);
  }, []);

  if (perguntas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-5 py-12 text-center">
        <span className="font-display text-[15px] font-bold text-navy">
          Nenhuma pergunta na fila
        </span>
        <span className="text-[13px] text-ink-2">
          Perguntas do Mercado Livre, OLX e WhatsApp aparecem aqui assim que chegam.
        </span>
      </div>
    );
  }

  return (
    <>
      {/* Neutro, nao ambar: e informacao de estado do sistema, nao alerta da
          operacao — e ambar so significa alerta (design-system.md). */}
      <p
        id={ID_AVISO_COMPOSITOR}
        className="border-b border-divider bg-table-head px-5 py-3 text-xs text-ink-2"
      >
        Responder ainda não está ligado: o compositor de resposta será definido
        antes de a ação entrar.
      </p>

      <ul className="flex flex-col">
        {perguntas.map((pergunta) => {
          const restante = pergunta.segundosRestantes - decorridos;
          const estado = classificarSla({
            segundosRestantes: restante,
            respondida: pergunta.respondida,
          });

          return (
            <li
              key={pergunta.id}
              className={`flex flex-col gap-1.5 border-b border-divider px-5 py-4 last:border-b-0 ${
                pergunta.respondida ? "opacity-60" : "bg-pending-bg"
              }`}
            >
              {/* `flex-wrap`: em tela estreita "Venda direta/WhatsApp · <nome do
                  item>" nao cabe na mesma linha que a pill. Deixar quebrar joga
                  a pill para a linha de baixo, inteira — melhor do que truncar o
                  nome do item ou espremer o prazo, que e o dado que a tela
                  existe para mostrar. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-xs text-ink-2">
                  {ROTULO_CANAL[pergunta.canal]}
                  {pergunta.item ? ` · ${pergunta.item}` : ""}
                </span>
                <span
                  className={`shrink-0 rounded-pill px-2 py-[3px] text-[11px] ${CLASSE_PILL[estado]}`}
                >
                  {pergunta.respondida
                    ? `Respondida${
                        pergunta.segundosAteResposta === null
                          ? ""
                          : ` · ${formatarDuracao(pergunta.segundosAteResposta)}`
                      }`
                    : `SLA: ${textoPrazo(restante)}`}
                </span>
              </div>

              <p className="text-sm">{pergunta.texto}</p>

              {/* Responder e a tarefa desta tela, mas o compositor NUNCA foi
                  desenhado no handoff (docs/known-issues.md). Os botoes ficam
                  visiveis e inertes em vez de sumirem: some tambem a informacao
                  de que a acao existe. Ligar quando o fluxo for definido — e ai
                  passam a exigir sessao (auth 🔴).

                  `aria-disabled` em vez de `disabled`: o atributo nativo tira o
                  botao da ordem de tabulacao, entao quem navega por teclado
                  nunca chegava nele e nunca descobria POR QUE esta apagado.
                  Assim o botao continua alcancavel, e anunciado como
                  indisponivel, e o `aria-describedby` entrega o motivo. Sem
                  `onClick`, clicar e inerte. */}
              {!pergunta.respondida && (
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    aria-disabled="true"
                    aria-describedby={ID_AVISO_COMPOSITOR}
                    className="cursor-not-allowed rounded-button border border-navy px-3 py-[5px] text-xs text-navy opacity-50 foco"
                  >
                    Responder
                  </button>
                  <button
                    type="button"
                    aria-disabled="true"
                    aria-describedby={ID_AVISO_COMPOSITOR}
                    className="cursor-not-allowed rounded-button border border-border-input px-3 py-[5px] text-xs text-ink-2 opacity-50 foco"
                  >
                    Usar modelo
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Ambar com proposito: ha pergunta em aberto que a tela NAO esta
          mostrando. `role="status"` porque o aviso pode aparecer entre
          renders. */}
      {truncada && (
        <p
          role="status"
          className="border-t border-divider bg-warning-soft px-5 py-3 text-xs text-warning-note"
        >
          A fila tem mais perguntas do que cabe nesta tela. As mais urgentes estão
          no topo — responda estas e recarregue para ver as seguintes.
        </p>
      )}
    </>
  );
}
