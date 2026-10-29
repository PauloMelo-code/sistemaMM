"use client";

/**
 * Erro da Visao geral.
 *
 * E a primeira tela que o dono abre. Um resumo que falha em silencio vira
 * "hoje nao teve nada" — e a reacao a "nao teve nada" e mexer em preco ou parar
 * de comprar. O texto tem que impedir essa leitura.
 */
import { useEffect } from "react";

export default function ErroVisaoGeral({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[visao-geral] falha ao carregar", error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-card border border-danger bg-danger-soft px-6 py-8">
      <h1 className="font-display text-[15px] font-bold text-danger">
        Não foi possível montar a visão geral
      </h1>
      <p className="max-w-prose text-[13px] text-ink">
        Isto <strong>não</strong> é um dia sem vendas nem uma caixa de perguntas
        vazia — é uma leitura que falhou. As telas de Perguntas, Pedidos e
        Estoque continuam disponíveis pelo menu.
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
