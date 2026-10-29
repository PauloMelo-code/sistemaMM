"use client";

/**
 * "Importar agora" — client component so pelo estado de envio e pelo resumo.
 *
 * Sem modal de confirmacao de proposito: a importacao so le o ML e so escreve a
 * tabela de importados, que a proxima importacao reescreve. Nao ha o que
 * desfazer, e um bloqueio de 3s aqui ensinaria a clicar sem ler nos modais que
 * importam (RN-123).
 */
import { useState, useTransition } from "react";

import { importarAnunciosAgora, type ResultadoImportacao } from "@/lib/actions/importacao-ml";

export function BotaoImportar() {
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [importando, iniciar] = useTransition();

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={importando}
        onClick={() =>
          iniciar(async () => {
            setResultado(null);
            setResultado(await importarAnunciosAgora());
          })
        }
        className="rounded-button bg-navy px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60 foco"
      >
        {importando ? "Importando do Mercado Livre…" : "Importar agora"}
      </button>

      {/* `aria-live`: o resultado chega depois do clique, e quem usa leitor de
          tela precisa ouvir que terminou. */}
      <p aria-live="polite" className="max-w-md text-right text-xs">
        {resultado?.ok === false && <span className="text-danger">{resultado.erro}</span>}
        {resultado?.ok === true && (
          <span className="text-ink-2">
            {resultado.resumo.encontrados} encontrados · {resultado.resumo.novos} novos ·{" "}
            {resultado.resumo.atualizados} atualizados
            {resultado.resumo.falhas.length > 0 && (
              <span className="text-warning-text">
                {" "}
                · {resultado.resumo.falhas.length} não lidos (
                {resultado.resumo.falhas
                  .slice(0, 3)
                  .map((f) => f.id ?? "sem id")
                  .join(", ")}
                {resultado.resumo.falhas.length > 3 ? "…" : ""})
              </span>
            )}
          </span>
        )}
      </p>
    </div>
  );
}
