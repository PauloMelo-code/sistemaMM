"use client";

/**
 * Erro do Estoque.
 *
 * O texto evita a leitura mais cara desta tela: estoque vazio por falha parece
 * "nao ha o que anunciar" — e a reacao a isso e ir comprar em leilao. Decisao de
 * capital tomada sobre dado que nao carregou.
 */
import { useEffect } from "react";

export default function ErroEstoque({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[estoque] falha ao carregar", error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-card border border-border bg-card px-6 py-8">
      <h1 className="font-display text-[15px] font-bold text-navy">
        Não foi possível carregar o estoque
      </h1>
      <p className="max-w-prose text-[13px] text-ink-2">
        Isto não significa estoque vazio — significa que a lista não pôde ser
        lida. Não decida compra nem preço com base nesta tela agora.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-button bg-navy px-4 py-2 text-[13px] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >
        Tentar de novo
      </button>
    </div>
  );
}
