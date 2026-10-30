"use client";

/**
 * "Buscar perguntas do ML" — traz as perguntas da conta para a caixa.
 *
 * As novas chegam sozinhas pela notificacao `questions`; este botao existe para
 * a primeira carga e para quando uma notificacao se perder. So le o ML.
 */
import { useState, useTransition } from "react";

import { importarPerguntasAgora, type ResultadoPerguntas } from "@/lib/actions/importacao-ml";

export function BotaoBuscarPerguntasML() {
  const [resultado, setResultado] = useState<ResultadoPerguntas | null>(null);
  const [buscando, iniciar] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={buscando}
        onClick={() =>
          iniciar(async () => {
            setResultado(null);
            setResultado(await importarPerguntasAgora());
          })
        }
        className="rounded-button border border-border px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-60 foco"
      >
        {buscando ? "Buscando no Mercado Livre…" : "Buscar perguntas do ML"}
      </button>
      <p aria-live="polite" className="text-right text-xs">
        {resultado?.ok === false && <span className="text-danger">{resultado.erro}</span>}
        {resultado?.ok === true && (
          <span className="text-ink-2">
            {resultado.resumo.novas} novas · {resultado.resumo.atualizadas} atualizadas
            {resultado.resumo.falhas > 0 && (
              <span className="text-warning-text"> · {resultado.resumo.falhas} não lidas</span>
            )}
          </span>
        )}
      </p>
    </div>
  );
}
