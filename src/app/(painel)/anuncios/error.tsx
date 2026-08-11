"use client";

/**
 * Erro da tela Anuncios.
 *
 * O texto evita a leitura mais perigosa: "nao ha anuncios". Tela de anuncios
 * vazia por falha parece estoque parado, e a reacao a estoque parado e mexer no
 * preco — decisao de dinheiro tomada sobre dado que nao existe.
 */
import { useEffect } from "react";

export default function ErroAnuncios({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[anuncios] falha ao carregar a lista", error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-card border border-border bg-card px-6 py-8">
      <h1 className="font-display text-[15px] font-bold text-navy">
        Não foi possível carregar os anúncios
      </h1>
      <p className="max-w-prose text-[13px] text-ink-2">
        Isto não quer dizer que não há anúncios no ar — quer dizer que a lista não
        pôde ser lida. Não tome decisão de preço com base nesta tela agora.
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
