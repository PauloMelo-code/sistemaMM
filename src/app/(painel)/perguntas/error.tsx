"use client";

/**
 * Erro da tela Perguntas.
 *
 * Esta tela e uma fila com prazo correndo: falhar em silencio faria o operador
 * achar que nao ha pergunta pendente. Por isso o texto diz explicitamente que
 * pode haver pergunta esperando, em vez do generico "algo deu errado".
 */
import { useEffect } from "react";

export default function ErroPerguntas({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[perguntas] falha ao carregar a fila", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-card border border-border bg-card shadow-(--shadow-card) px-6 py-8"
    >
      <h1 className="font-display text-[15px] font-bold text-navy">
        Não foi possível carregar as perguntas
      </h1>
      <p className="max-w-prose text-[13px] text-ink-2">
        Pode haver pergunta aguardando resposta com o prazo correndo — a fila não
        está vazia, apenas não pôde ser lida. Tente de novo; se persistir,
        verifique a conexão com o banco.
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
