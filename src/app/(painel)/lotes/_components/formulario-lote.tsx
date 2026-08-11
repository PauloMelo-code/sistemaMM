"use client";

/**
 * Cadastro de lote: criar, editar e excluir.
 *
 * Client component pelo motivo legitimo — formulario com estado de envio, erro
 * do servidor e modal de confirmacao. A LEITURA continua no server component da
 * tela; daqui so saem chamadas de escrita.
 *
 * ⚠️ O `updated_at` do registro viaja para ca e volta na atualizacao. E o que
 * sustenta o optimistic locking: se outra pessoa gravou nesse meio tempo, o
 * servidor recusa em vez de sobrescrever o trabalho dela em silencio.
 */
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { ModalConfirmacaoBlock } from "@/components/ui/modal-confirmacao-block";
import { criarLote, atualizarLote, excluirLote } from "@/lib/actions/lotes-mutacoes";

export interface LoteEditavel {
  id: string;
  nome: string;
  segmento: string;
  /** `YYYY-MM-DD` — a coluna e `date`, sem hora e sem fuso. */
  dataArremate: string;
  custoTotal: string;
  atualizadoEm: string;
}

const campo =
  "rounded-button border border-border-input px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy";
const rotulo = "text-xs uppercase tracking-[.12em] text-ink-2";

function Dialogo({
  aberto,
  lote,
  onFechar,
}: {
  aberto: boolean;
  lote?: LoteEditavel;
  onFechar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [erro, setErro] = useState("");
  const [enviando, iniciar] = useTransition();

  // Abrir/fechar e EFEITO, nao render. Fazer isso no corpo do componente mexe
  // no DOM durante a renderizacao — o lint da casa barra, e com razao: em modo
  // concorrente o React pode renderizar sem committar, e o modal abriria sozinho.
  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (aberto && !el.open) {
      setErro("");
      el.showModal();
    } else if (!aberto && el.open) {
      el.close();
    }
  }, [aberto]);

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const entrada = {
      nome: String(dados.get("nome") ?? ""),
      segmento: String(dados.get("segmento") ?? ""),
      data_arremate: String(dados.get("data_arremate") ?? ""),
      custo_total: String(dados.get("custo_total") ?? ""),
    };

    setErro("");
    iniciar(async () => {
      const r = lote
        ? await atualizarLote(lote.id, entrada, lote.atualizadoEm)
        : await criarLote(entrada);
      if (r.ok) onFechar();
      else setErro(r.erro);
    });
  }

  return (
    <dialog
      ref={dialogo}
      aria-labelledby="titulo-form-lote"
      onCancel={(e) => {
        e.preventDefault();
        if (!enviando) onFechar();
      }}
      className="w-[min(92vw,460px)] rounded-card border border-border bg-card p-0 text-ink backdrop:bg-navy/40"
    >
      <form onSubmit={aoEnviar} className="flex flex-col gap-4 p-6">
        <h2 id="titulo-form-lote" className="font-display text-[17px] font-bold text-navy">
          {lote ? "Editar lote" : "Novo lote"}
        </h2>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="nome" className={rotulo}>Nome</label>
          <input id="nome" name="nome" required autoFocus defaultValue={lote?.nome} maxLength={120} className={campo} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="segmento" className={rotulo}>Segmento</label>
          <input
            id="segmento"
            name="segmento"
            required
            defaultValue={lote?.segmento}
            maxLength={60}
            placeholder="oftalmologia"
            className={campo}
          />
          {/* O servidor normaliza para minusculo. Dizer isso evita a impressao
              de que o sistema "estragou" o que a pessoa digitou. */}
          <span className="text-xs text-ink-2">Gravado em minusculo, para nao duplicar o filtro.</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="data_arremate" className={rotulo}>Data do arremate</label>
          <input
            id="data_arremate"
            name="data_arremate"
            type="date"
            required
            defaultValue={lote?.dataArremate}
            max={new Date().toISOString().slice(0, 10)}
            className={campo}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="custo_total" className={rotulo}>Custo total do arremate</label>
          <input
            id="custo_total"
            name="custo_total"
            required
            inputMode="decimal"
            defaultValue={lote?.custoTotal}
            placeholder="12000,00"
            className={campo}
          />
        </div>

        {erro ? (
          <p role="alert" className="rounded-button bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            className="rounded-button border border-border-input bg-card px-4 py-2 text-[13px] text-ink disabled:opacity-50 hover:bg-table-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando}
            className="rounded-button bg-navy px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function BotaoNovoLote() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-button bg-navy px-4 py-2 text-[13px] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >
        Novo lote
      </button>
      <Dialogo aberto={aberto} onFechar={() => setAberto(false)} />
    </>
  );
}

export function AcoesLote({ lote, temItens }: { lote: LoteEditavel; temItens: boolean }) {
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState("");
  const [excluindo, iniciar] = useTransition();

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="rounded-button border border-border-input px-3 py-1.5 text-xs text-ink hover:bg-table-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => {
            setErro("");
            setConfirmando(true);
          }}
          /**
           * Desabilitado com MOTIVO VISIVEL quando o lote tem itens. O servidor
           * recusa de qualquer jeito — esta e a mesma regra dita antes do
           * clique, para a pessoa nao descobrir depois de confirmar.
           */
          disabled={temItens}
          title={temItens ? "Lote com itens no estoque nao pode ser excluido" : undefined}
          className="rounded-button border border-border-input px-3 py-1.5 text-xs text-danger disabled:opacity-40 hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          Excluir
        </button>
      </div>

      <Dialogo aberto={editando} lote={lote} onFechar={() => setEditando(false)} />

      <ModalConfirmacaoBlock
        aberto={confirmando}
        titulo="Excluir lote"
        destrutivo
        rotuloConfirmar="Excluir"
        ocupado={excluindo}
        erro={erro}
        onCancelar={() => setConfirmando(false)}
        onConfirmar={() =>
          iniciar(async () => {
            const r = await excluirLote(lote.id);
            if (r.ok) setConfirmando(false);
            else setErro(r.erro);
          })
        }
      >
        O lote <strong>{lote.nome}</strong> sai das telas de Lotes e Visão geral. É exclusão
        lógica: o registro continua no banco e na trilha de auditoria, com quem excluiu e
        quando — mas o painel deixa de contá-lo.
      </ModalConfirmacaoBlock>
    </>
  );
}
