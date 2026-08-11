"use client";

/**
 * Erro da tela Integracoes.
 *
 * Esta e a tela que existe para avisar quando algo esta quebrado. Se ELA falha
 * em silencio, o painel volta a ser exatamente o que a auditoria apontou: bonito
 * e mudo enquanto a integracao cai. Por isso o texto diz explicitamente que o
 * estado dos canais esta desconhecido — nao "algo deu errado".
 */
import { useEffect } from "react";

export default function ErroIntegracoes({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[integracoes] falha ao ler o estado das integracoes", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-card border border-danger bg-danger-soft px-6 py-8"
    >
      <h1 className="font-display text-[15px] font-bold text-danger">
        Não foi possível ler o estado das integrações
      </h1>
      <p className="max-w-prose text-[13px] text-ink">
        Esta tela não está dizendo que os canais estão bem — está dizendo que não
        conseguiu verificar. Notificação perdida, token vencido ou fila parada
        continuariam invisíveis enquanto isto durar.
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
