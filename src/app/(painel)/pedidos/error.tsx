"use client";

/**
 * Erro de Pedidos.
 *
 * Esta e a tela do faturamento. Se ela falhar em silencio, "zero pedidos" se
 * confunde com "mes fraco" — e mes fraco muda decisao de preco e de compra em
 * leilao. O texto precisa impedir essa leitura.
 */
import { useEffect } from "react";

export default function ErroPedidos({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[pedidos] falha ao carregar", error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-card border border-danger bg-danger-soft px-6 py-8">
      <h1 className="font-display text-[15px] font-bold text-danger">
        Não foi possível carregar os pedidos
      </h1>
      <p className="max-w-prose text-[13px] text-ink">
        Isto <strong>não</strong> quer dizer que não houve vendas no mês — quer
        dizer que os números não puderam ser lidos. Não feche comissão nem avalie
        o mês por esta tela agora.
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
