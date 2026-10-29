"use client";

/**
 * Modal de confirmacao com BLOQUEIO de 3 segundos (RN-003 / CLAUDE.md).
 *
 * Exigido em toda acao critica: excluir registro, publicar ou pausar anuncio,
 * emitir NF-e, gerar etiqueta, acertar comissao. O bloqueio existe porque boa
 * parte dessas acoes **sai do sistema** — anuncio publicado, etiqueta emitida e
 * resposta enviada nao voltam com um Ctrl+Z. Tres segundos e o tempo de a pessoa
 * ler o que vai acontecer antes de a mao decidir sozinha.
 *
 * PRIMEIRO COMPONENTE COMPARTILHADO DO PROJETO. Ate aqui tudo era colocado
 * dentro da tela que usava; este nasce em `src/components/ui` porque a regra
 * vale para o sistema inteiro, e duas copias dela divergiriam.
 *
 * ---------------------------------------------------------------------------
 * DECISOES QUE PARECEM DETALHE:
 *
 * - **`<dialog>` nativo com `showModal()`**, e nao uma `div` com `position:
 *   fixed`. O elemento nativo entrega de graca o que uma div exigiria em
 *   JavaScript e quase sempre sai errado: foco preso dentro do modal, o resto da
 *   pagina inerte para leitor de tela, e a camada superior acima de qualquer
 *   `z-index`.
 * - **A CONTAGEM APARECE.** Um botao desabilitado sem explicacao e
 *   indistinguivel de tela travada — e este projeto passou o dia de hoje
 *   descobrindo o quanto isso custa. O numero descendo diz "espere", nao
 *   "quebrou".
 * - **Cancelar tambem espera os 3s.** Parece exagero, mas o bloqueio protege
 *   contra a mao que ja estava descendo: se Cancelar liberasse antes, o clique
 *   automatico cairia nele e a pessoa acharia que confirmou.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Segundos de bloqueio. Vem do CLAUDE.md; nao reduza sem mudar a regra. */
const BLOQUEIO_S = 3;

interface Props {
  aberto: boolean;
  titulo: string;
  /** O QUE VAI ACONTECER, em texto que a pessoa entenda. Nao "Confirma?". */
  children: ReactNode;
  rotuloConfirmar?: string;
  /** Vermelho para o que destroi; navy para o resto. */
  destrutivo?: boolean;
  ocupado?: boolean;
  erro?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ModalConfirmacaoBlock({
  aberto,
  titulo,
  children,
  rotuloConfirmar = "Confirmar",
  destrutivo = false,
  ocupado = false,
  erro,
  onConfirmar,
  onCancelar,
}: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [restam, setRestam] = useState(BLOQUEIO_S);

  // Abre e fecha pelo metodo nativo — `open` como atributo NAO cria a camada
  // superior nem prende o foco; so `showModal()` faz isso.
  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (aberto && !el.open) {
      setRestam(BLOQUEIO_S);
      el.showModal();
    } else if (!aberto && el.open) {
      el.close();
    }
  }, [aberto]);

  // Contagem regressiva.
  useEffect(() => {
    if (!aberto || restam <= 0) return;
    const t = setTimeout(() => setRestam((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [aberto, restam]);

  const bloqueado = restam > 0;

  return (
    <dialog
      ref={dialogo}
      aria-labelledby="titulo-confirmacao"
      /**
       * ESC e clique fora nao fecham enquanto bloqueado — e a exigencia literal
       * da regra. O `cancel` do `<dialog>` cobre o ESC; o clique fora chega como
       * clique no proprio `<dialog>` (o backdrop e parte dele), por isso a
       * comparacao com `event.target`.
       */
      onCancel={(evento) => {
        evento.preventDefault();
        if (!bloqueado && !ocupado) onCancelar();
      }}
      onClick={(evento) => {
        if (evento.target === dialogo.current && !bloqueado && !ocupado) onCancelar();
      }}
      /**
       * ⚠️ `m-auto` NAO E ESPACAMENTO — e o que CENTRALIZA o modal.
       *
       * O navegador centra `<dialog>` modal com `margin: auto` sobre
       * `position: fixed; inset: 0` (folha de estilo do proprio agente). O
       * Preflight do Tailwind zera `margin` em TODO elemento, entao a regra do
       * navegador e sobrescrita e o modal cola no canto superior esquerdo —
       * medido: x=0, y=0, com 1480px de sobra a direita numa tela de 1920.
       *
       * Vale para os TRES `<dialog>` da base (este, formulario-lote e
       * formulario-item). Tirar esta classe devolve o modal para o canto.
       */
      className="m-auto max-w-[440px] rounded-card border border-border bg-card shadow-(--shadow-card) p-0 text-ink backdrop:bg-navy/40 open:flex open:flex-col"
    >
      <div className="flex flex-col gap-3 p-6">
        <h2 id="titulo-confirmacao" className="font-display text-[17px] font-bold text-navy">
          {titulo}
        </h2>

        <div className="text-[13px] leading-relaxed text-ink-2">{children}</div>

        {erro ? (
          <p role="alert" className="rounded-button bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        ) : null}

        {/* `aria-live` para quem usa leitor de tela saber que a espera acabou —
            sem isso o botao "destrava" em silencio. */}
        <p aria-live="polite" className="min-h-[18px] text-xs text-ink-2">
          {bloqueado ? `Leia com atencao. Os botoes liberam em ${restam}s.` : ""}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancelar}
            disabled={bloqueado || ocupado}
            className="rounded-button border border-border-input bg-card px-4 py-2 text-[13px] text-ink disabled:opacity-50 hover:bg-table-head foco"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={bloqueado || ocupado}
            className={`rounded-button px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50 ${
              destrutivo ? "bg-danger foco-perigo" : "bg-navy foco"
            }`}
          >
            {ocupado ? "Aguarde…" : bloqueado ? `${rotuloConfirmar} (${restam})` : rotuloConfirmar}
          </button>
        </div>
      </div>
    </dialog>
  );
}
