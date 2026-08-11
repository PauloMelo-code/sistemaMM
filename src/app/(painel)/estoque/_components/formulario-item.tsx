"use client";

/**
 * Cadastro de item de estoque: criar, editar e excluir.
 *
 * ⚠️ ESTE FORMULARIO PEDE CUSTO, e custo e o dado que a RN-107 esconde do
 * operador. Ele so e renderizado para quem tem as duas permissoes (`itens` e
 * `itens_custo`) — a tela decide isso no SERVIDOR e nem manda o componente.
 * A action confere de novo: esconder o botao nunca e a unica protecao.
 */
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { ModalConfirmacaoBlock } from "@/components/ui/modal-confirmacao-block";
import { criarItem, atualizarItem, excluirItem } from "@/lib/actions/estoque-mutacoes";
import { SITUACOES_ITEM } from "@/lib/validators/item";

export interface LoteOpcao {
  id: string;
  nome: string;
  segmento: string;
}

export interface ItemEditavel {
  id: string;
  sku: string;
  nome: string;
  loteId: string;
  segmento: string;
  custo: string;
  precoAlvo: string;
  localGalpao: string;
  situacao: string;
  atualizadoEm: string;
  vendido: boolean;
}

const ROTULO_SITUACAO: Record<string, string> = {
  sem_anuncio: "Sem anúncio",
  anunciado: "Anunciado",
  reservado: "Reservado",
  pausado: "Pausado",
  vendido: "Vendido",
};

const campo =
  "rounded-button border border-border-input px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy";
const rotulo = "text-xs uppercase tracking-[.12em] text-ink-2";

function Dialogo({
  aberto,
  item,
  lotes,
  onFechar,
}: {
  aberto: boolean;
  item?: ItemEditavel;
  lotes: LoteOpcao[];
  onFechar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [erro, setErro] = useState("");
  const [enviando, iniciar] = useTransition();

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
    const d = new FormData(evento.currentTarget);
    const entrada = {
      sku: String(d.get("sku") ?? ""),
      nome: String(d.get("nome") ?? ""),
      lote_id: String(d.get("lote_id") ?? ""),
      segmento: String(d.get("segmento") ?? ""),
      custo: String(d.get("custo") ?? ""),
      preco_alvo: String(d.get("preco_alvo") ?? ""),
      local_galpao: String(d.get("local_galpao") ?? ""),
      situacao: String(d.get("situacao") ?? "sem_anuncio"),
    };

    setErro("");
    iniciar(async () => {
      const r = item
        ? await atualizarItem(item.id, entrada, item.atualizadoEm)
        : await criarItem(entrada);
      if (r.ok) onFechar();
      else setErro(r.erro);
    });
  }

  return (
    <dialog
      ref={dialogo}
      aria-labelledby="titulo-form-item"
      onCancel={(e) => {
        e.preventDefault();
        if (!enviando) onFechar();
      }}
      className="w-[min(94vw,540px)] rounded-card border border-border bg-card p-0 text-ink backdrop:bg-navy/40"
    >
      <form onSubmit={aoEnviar} className="flex flex-col gap-4 p-6">
        <h2 id="titulo-form-item" className="font-display text-[17px] font-bold text-navy">
          {item ? "Editar item" : "Novo item"}
        </h2>

        {lotes.length === 0 ? (
          <p className="rounded-button bg-warning-soft px-3 py-2 text-[13px] text-warning-note">
            Não há lote cadastrado. Todo item pertence a um lote arrematado —
            cadastre o lote primeiro, na tela Lotes.
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sku" className={rotulo}>SKU</label>
            <input id="sku" name="sku" required autoFocus defaultValue={item?.sku} maxLength={40} placeholder="MM-OFT-1401" className={campo} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="lote_id" className={rotulo}>Lote</label>
            <select id="lote_id" name="lote_id" required defaultValue={item?.loteId ?? ""} className={campo}>
              <option value="" disabled>Selecione…</option>
              {lotes.map((l) => (
                <option key={l.id} value={l.id}>{l.nome} · {l.segmento}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="nome-item" className={rotulo}>Nome do item</label>
          <input id="nome-item" name="nome" required defaultValue={item?.nome} maxLength={160} placeholder="Autorrefrator" className={campo} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="segmento-item" className={rotulo}>Segmento</label>
            <input id="segmento-item" name="segmento" required defaultValue={item?.segmento} maxLength={60} placeholder="oftalmologia" className={campo} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="local_galpao" className={rotulo}>Local no galpão</label>
            <input id="local_galpao" name="local_galpao" defaultValue={item?.localGalpao} maxLength={40} placeholder="A · 2" className={campo} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="custo" className={rotulo}>Custo de arremate</label>
            <input
              id="custo"
              name="custo"
              required
              inputMode="decimal"
              defaultValue={item?.custo}
              placeholder="3300,00"
              /**
               * Item VENDIDO trava o custo. O pedido congelou `custo_na_venda`
               * (RN-114), entao mexer aqui nao reescreve o mes fechado — mas
               * faria o custo do item divergir do que foi vendido sem nada
               * explicando. Se o valor estava errado, corrige-se pelo pedido.
               */
              readOnly={item?.vendido}
              className={`${campo} ${item?.vendido ? "bg-table-head text-ink-2" : ""}`}
            />
            {item?.vendido ? (
              <span className="text-xs text-ink-2">Item vendido: o custo não muda por aqui.</span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="preco_alvo" className={rotulo}>Preço alvo (opcional)</label>
            <input id="preco_alvo" name="preco_alvo" inputMode="decimal" defaultValue={item?.precoAlvo} placeholder="5200,00" className={campo} />
            <span className="text-xs text-ink-2">Em branco enquanto não foi precificado.</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="situacao" className={rotulo}>Situação</label>
          <select id="situacao" name="situacao" defaultValue={item?.situacao ?? "sem_anuncio"} className={campo}>
            {SITUACOES_ITEM.map((s) => (
              <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>
            ))}
          </select>
        </div>

        {erro ? (
          <p role="alert" className="rounded-button bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} disabled={enviando} className="rounded-button border border-border-input bg-card px-4 py-2 text-[13px] text-ink disabled:opacity-50 hover:bg-table-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy">
            Cancelar
          </button>
          <button type="submit" disabled={enviando || lotes.length === 0} className="rounded-button bg-navy px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy">
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function BotaoNovoItem({ lotes }: { lotes: LoteOpcao[] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-button bg-navy px-4 py-2 text-[13px] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >
        Novo item
      </button>
      <Dialogo aberto={aberto} lotes={lotes} onFechar={() => setAberto(false)} />
    </>
  );
}

export function AcoesItem({ item, lotes }: { item: ItemEditavel; lotes: LoteOpcao[] }) {
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState("");
  const [excluindo, iniciar] = useTransition();

  return (
    <>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setEditando(true)} className="rounded-button border border-border-input px-2.5 py-1 text-xs text-ink hover:bg-table-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy">
          Editar
        </button>
        <button
          type="button"
          onClick={() => { setErro(""); setConfirmando(true); }}
          className="rounded-button border border-border-input px-2.5 py-1 text-xs text-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          Excluir
        </button>
      </div>

      <Dialogo aberto={editando} item={item} lotes={lotes} onFechar={() => setEditando(false)} />

      <ModalConfirmacaoBlock
        aberto={confirmando}
        titulo="Excluir item"
        destrutivo
        rotuloConfirmar="Excluir"
        ocupado={excluindo}
        erro={erro}
        onCancelar={() => setConfirmando(false)}
        onConfirmar={() =>
          iniciar(async () => {
            const r = await excluirItem(item.id);
            if (r.ok) setConfirmando(false);
            else setErro(r.erro);
          })
        }
      >
        O item <strong>{item.sku} — {item.nome}</strong> sai do estoque e das somas do lote.
        É exclusão lógica, com registro de quem excluiu e quando.
        {" "}
        <strong>Isto não mexe em anúncio publicado:</strong> se a peça estiver no ar em algum
        canal, ela continua lá — o painel é que deixa de saber.
      </ModalConfirmacaoBlock>
    </>
  );
}
