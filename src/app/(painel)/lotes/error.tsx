"use client";

/**
 * Erro de Lotes.
 *
 * Esta tela responde "o lote se pagou?". Falhar em silencio faria "sem lotes"
 * se confundir com "capital todo recuperado" — e a reacao a isso e ir arrematar
 * mais. O texto precisa fechar essa porta.
 */
import { useEffect } from "react";

export default function ErroLotes({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[lotes] falha ao carregar", error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-card border border-border bg-card shadow-(--shadow-card) px-6 py-8">
      <h1 className="font-display text-[15px] font-bold text-navy">
        Não foi possível carregar os lotes
      </h1>
      <p className="max-w-prose text-[13px] text-ink-2">
        Isto não diz nada sobre o capital arrematado — diz que a leitura falhou.
        Não decida novo arremate por esta tela agora.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-button bg-navy px-4 py-2 text-[13px] text-white foco"
      >
        Tentar de novo
      </button>
    </div>
  );
}
