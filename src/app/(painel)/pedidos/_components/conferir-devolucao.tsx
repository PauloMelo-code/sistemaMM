"use client";

/**
 * "Volta ao estoque" / "Nao volta" para a peca devolvida (RN-126).
 *
 * As duas passam pelo modal com bloqueio: uma soma estoque, a outra registra
 * que a peca nao volta — e nenhuma das duas se desfaz por esta tela.
 */
import { useState, useTransition } from "react";

import { ModalConfirmacaoBlock } from "@/components/ui/modal-confirmacao-block";
import { resolverDevolucao } from "@/lib/actions/devolucoes-mutacoes";

export function ConferirDevolucao({ pedidoId, produto }: { pedidoId: string; produto: string }) {
  const [escolha, setEscolha] = useState<boolean | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, iniciar] = useTransition();

  return (
    <div className="mt-1 flex gap-1.5">
      <button
        type="button"
        onClick={() => {
          setErro("");
          setEscolha(true);
        }}
        className="rounded-button border border-border-input px-2 py-0.5 text-[11px] text-ink hover:bg-table-head foco"
      >
        Volta ao estoque
      </button>
      <button
        type="button"
        onClick={() => {
          setErro("");
          setEscolha(false);
        }}
        className="rounded-button border border-border-input px-2 py-0.5 text-[11px] text-ink-2 hover:bg-table-head foco"
      >
        Não volta
      </button>

      <ModalConfirmacaoBlock
        aberto={escolha !== null}
        titulo={escolha ? "A peça volta ao estoque" : "A peça não volta ao estoque"}
        rotuloConfirmar="Confirmar"
        ocupado={salvando}
        erro={erro}
        onCancelar={() => setEscolha(null)}
        onConfirmar={() =>
          iniciar(async () => {
            if (escolha === null) return;
            const r = await resolverDevolucao(pedidoId, escolha);
            if (r.ok) setEscolha(null);
            else setErro(r.erro);
          })
        }
      >
        {escolha ? (
          <>
            <strong>{produto}</strong> volta a contar no estoque. Se o item estava esgotado, ele
            fica <strong>pausado</strong> até alguém reativar o anúncio.
          </>
        ) : (
          <>
            Fica registrado que <strong>{produto}</strong> não volta ao estoque (defeito, peça
            faltando). O estoque não muda.
          </>
        )}
      </ModalConfirmacaoBlock>
    </div>
  );
}
