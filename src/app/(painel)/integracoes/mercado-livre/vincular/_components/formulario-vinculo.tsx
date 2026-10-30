"use client";

/**
 * Vinculo dos anuncios importados com o Estoque (RN-124).
 *
 * Client component pelo motivo legitimo: formulario com estado, modal de
 * confirmacao e a copia das fotos em laco com progresso. O plano de verdade e
 * recalculado no servidor — daqui so saem os dados de cada lote.
 */
import { useState, useTransition, type FormEvent } from "react";

import { ModalConfirmacaoBlock } from "@/components/ui/modal-confirmacao-block";
import { copiarFotosML, vincularAnunciosML, type EntradaVinculo } from "@/lib/actions/vinculo-ml";
import type { ResumoLote } from "@/lib/integracoes/mercado-livre/vinculo";

const campo = "rounded-button border border-border-input px-3 py-2 text-[13px] foco-campo";

export function FormularioVinculo({ lotes, hoje }: { lotes: ResumoLote[]; hoje: string }) {
  const [entrada, setEntrada] = useState<EntradaVinculo | null>(null);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState<{ lotes: number; itens: number } | null>(null);
  const [vinculando, iniciar] = useTransition();

  const totalAnuncios = lotes.reduce((s, l) => s + l.anuncios, 0);

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const d = new FormData(evento.currentTarget);
    setErro("");
    setEntrada({
      lotes: lotes.map((l) => ({
        prefixo: l.prefixo,
        nome: String(d.get(`nome-${l.prefixo}`) ?? ""),
        segmento: String(d.get(`segmento-${l.prefixo}`) ?? ""),
        data_arremate: String(d.get(`data-${l.prefixo}`) ?? ""),
        custo_total: String(d.get(`custo-${l.prefixo}`) ?? ""),
      })),
    });
  }

  if (feito) return <CopiaDeFotos lotes={feito.lotes} itens={feito.itens} />;

  return (
    <form onSubmit={aoEnviar} className="flex flex-col gap-4">
      <div className="relative overflow-x-auto rounded-card border border-border bg-card shadow-(--shadow-card)">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-table-head text-left text-[11px] uppercase tracking-[.12em] text-ink-2">
              <th scope="col" className="px-4 py-2.5 font-normal">Lote (prefixo)</th>
              <th scope="col" className="px-2 py-2.5 text-right font-normal">Anúncios</th>
              <th scope="col" className="px-2 py-2.5 text-right font-normal">Unidades</th>
              <th scope="col" className="px-2 py-2.5 font-normal">Nome do lote</th>
              <th scope="col" className="px-2 py-2.5 font-normal">Segmento</th>
              <th scope="col" className="px-2 py-2.5 font-normal">Arremate</th>
              <th scope="col" className="px-4 py-2.5 font-normal">Custo total (R$)</th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.prefixo} className="border-t border-divider">
                <th scope="row" className="px-4 py-2 text-left font-medium">{l.prefixo}</th>
                <td className="px-2 py-2 text-right tabular-nums">{l.anuncios}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-2">
                  {l.unidadesDisponiveis} em estoque · {l.unidadesVendidas} vendidas
                </td>
                <td className="px-2 py-2">
                  <input
                    aria-label={`Nome do lote ${l.prefixo}`}
                    name={`nome-${l.prefixo}`}
                    required
                    maxLength={120}
                    defaultValue={`Leilão ${l.prefixo}`}
                    className={`${campo} w-40`}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    aria-label={`Segmento do lote ${l.prefixo}`}
                    name={`segmento-${l.prefixo}`}
                    required
                    maxLength={60}
                    placeholder="automotivo"
                    className={`${campo} w-32`}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    aria-label={`Data de arremate do lote ${l.prefixo}`}
                    name={`data-${l.prefixo}`}
                    type="date"
                    required
                    max={hoje}
                    defaultValue={l.dataSugerida ?? hoje}
                    className={campo}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    aria-label={`Custo total do lote ${l.prefixo}`}
                    name={`custo-${l.prefixo}`}
                    required
                    inputMode="decimal"
                    placeholder="12000,00"
                    className={`${campo} w-32 tabular-nums`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-2">
        O custo total de cada lote é dividido entre os itens na proporção do preço de anúncio ×
        unidades (em estoque + vendidas). Dá para corrigir o custo de um item depois, no Estoque.
      </p>

      <div className="flex justify-end">
        <button type="submit" className="rounded-button bg-navy px-4 py-2 text-[13px] font-medium text-white foco">
          Revisar e vincular
        </button>
      </div>

      <ModalConfirmacaoBlock
        aberto={entrada !== null}
        titulo="Vincular anúncios ao Estoque"
        rotuloConfirmar="Vincular"
        ocupado={vinculando}
        erro={erro}
        onCancelar={() => setEntrada(null)}
        onConfirmar={() =>
          iniciar(async () => {
            if (!entrada) return;
            const r = await vincularAnunciosML(entrada);
            if (r.ok) {
              setEntrada(null);
              setFeito(r.dados);
            } else {
              setErro(r.erro);
            }
          })
        }
      >
        Cria <strong>{lotes.length} lote(s)</strong>, <strong>{totalAnuncios} itens</strong> no Estoque e{" "}
        {totalAnuncios} anúncios no canal Mercado Livre, com o custo rateado.{" "}
        <strong>A partir daqui, uma venda em outro canal pausa o anúncio no Mercado Livre</strong> —
        é a primeira vez que o sistema escreve na sua conta. Nada é alterado no ML agora.
      </ModalConfirmacaoBlock>
    </form>
  );
}

/**
 * Depois do vinculo: copia as fotos em lotes pequenos, mostrando o progresso.
 * Sem `lotes`/`itens`, e a volta a tela depois — para terminar uma copia que
 * ficou pela metade.
 */
export function CopiaDeFotos({ lotes, itens }: { lotes?: number; itens?: number }) {
  const [estado, setEstado] = useState<{ copiadas: number; recusadas: number; restantes: number | null }>({
    copiadas: 0,
    recusadas: 0,
    restantes: null,
  });
  const [erro, setErro] = useState("");
  const [copiando, iniciar] = useTransition();

  function copiar() {
    setErro("");
    iniciar(async () => {
      const tentados: string[] = [];
      let total = { copiadas: 0, recusadas: 0, restantes: 1 };
      while (total.restantes > 0) {
        const r = await copiarFotosML(tentados);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        tentados.push(...r.dados.tentados);
        total = {
          copiadas: total.copiadas + r.dados.copiadas,
          recusadas: total.recusadas + r.dados.recusadas,
          restantes: r.dados.tentados.length === 0 ? 0 : r.dados.restantes,
        };
        setEstado(total);
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-card p-5 shadow-(--shadow-card)">
      {itens !== undefined && (
        <p className="text-[13px]">
          Vinculados: <strong>{itens} itens</strong> em <strong>{lotes} lote(s)</strong>. Eles já
          aparecem em Estoque e Anúncios.
        </p>
      )}
      <p className="text-[13px] text-ink-2">
        Agora copie as fotos do Mercado Livre para o storage do sistema. São várias por item, e
        leva alguns minutos — mantenha esta aba aberta.
      </p>
      <button
        type="button"
        disabled={copiando || estado.restantes === 0}
        onClick={copiar}
        className="rounded-button bg-navy px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60 foco"
      >
        {copiando ? "Copiando fotos…" : estado.restantes === 0 ? "Fotos copiadas" : "Copiar fotos"}
      </button>
      <p aria-live="polite" className="text-xs text-ink-2">
        {estado.restantes !== null &&
          `${estado.copiadas} fotos copiadas · ${estado.recusadas} recusadas · ` +
            `${estado.restantes} itens na fila`}
        {erro && <span className="text-danger"> {erro}</span>}
      </p>
    </div>
  );
}
