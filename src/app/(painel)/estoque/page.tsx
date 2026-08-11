/**
 * Tela Estoque — portada do handoff (bloco `isItens`, linha 398).
 *
 * ⚠️ A ROTA E `/estoque`. No prototipo, `state.screen === 'itens'` E a tela
 * Estoque e `'estoque'` e a tela Lotes — nomenclatura invertida la, que a
 * invariante do projeto manda NAO propagar para o codigo.
 *
 * FIDELIDADE: 4 KPIs, chips de segmento, colunas Item / Lote / Segmento /
 * Custo / Preco alvo / Canais / Situacao.
 *
 * TRES DIVERGENCIAS, todas respondendo a auditoria:
 * 1. `<table>` semantica com `min-width` — conserta a colisao de colunas (o
 *    nome do item era pintado por cima da coluna Lote abaixo de ~1100px) e a
 *    acessibilidade.
 * 2. **KPIs clicaveis**: "Sem anuncio · 12" agora filtra. Era o achado *"o
 *    sistema aponta o problema e nao deixa ir ate ele"*.
 * 3. **Custo E preco alvo somem para o operador** (RN-107) — duas colunas, nao
 *    uma: preco alvo deriva do custo.
 */
import { redirect } from "next/navigation";

import { lerEstoque, type SituacaoItem } from "@/lib/actions/estoque";
import { lerSessao } from "@/lib/auth/sessao";
import { formatarBRL, type Canal } from "@/lib/pricing";

import { FiltrosEstoque } from "./_components/filtros-estoque";

export const dynamic = "force-dynamic";

const ROTULO_CANAL: Record<Canal, string> = {
  mercado_livre: "ML",
  olx: "OLX",
  whatsapp: "WA",
};

const PILL_SITUACAO: Record<SituacaoItem, { rotulo: string; classe: string }> = {
  anunciado: { rotulo: "Anunciado", classe: "bg-success-soft text-success" },
  sem_anuncio: { rotulo: "Sem anúncio", classe: "bg-warning-soft text-warning-text" },
  reservado: { rotulo: "Reservado", classe: "bg-info-soft text-info" },
  pausado: { rotulo: "Pausado", classe: "bg-table-head text-ink-2" },
  vendido: { rotulo: "Vendido", classe: "bg-table-head text-ink-2" },
};

const SITUACOES: SituacaoItem[] = ["anunciado", "sem_anuncio", "reservado", "pausado", "vendido"];

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ segmento?: string; situacao?: string }>;
}) {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const params = await searchParams;
  const situacao = SITUACOES.find((s) => s === params.situacao);
  const segmento = params.segmento?.trim() || undefined;

  const { itens, kpis, segmentos, custoOculto } = await lerEstoque(sessao.papel, {
    segmento,
    situacao,
  });

  const colunas = custoOculto ? 5 : 7;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <h1 className="font-display text-[22px] font-bold text-navy">Estoque</h1>
        <span className="text-[13px] text-ink-2">
          {itens.length} {itens.length === 1 ? "item" : "itens"}
          {segmento || situacao ? " no filtro atual" : ""} · baixa automática quando o item vende
          em qualquer canal
        </span>
      </header>

      <FiltrosEstoque kpis={kpis} segmentos={segmentos} segmento={segmento} situacao={situacao} />

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-table-head text-left text-[11px] uppercase tracking-[.12em] text-ink-2">
              <th scope="col" className="px-4 py-2.5 font-normal">Item</th>
              <th scope="col" className="px-2 py-2.5 font-normal">Lote</th>
              <th scope="col" className="px-2 py-2.5 font-normal">Segmento</th>
              {!custoOculto && (
                <>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">Custo</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">Preço alvo</th>
                </>
              )}
              <th scope="col" className="px-2 py-2.5 font-normal">Canais</th>
              <th scope="col" className="px-4 py-2.5 font-normal">Situação</th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 ? (
              <tr>
                <td colSpan={colunas} className="px-4 py-12 text-center text-ink-2">
                  Nenhum item {segmento || situacao ? "com este filtro" : "no estoque"}.
                </td>
              </tr>
            ) : (
              itens.map((item) => {
                const pill = PILL_SITUACAO[item.situacao];
                return (
                  <tr key={item.id} className="border-t border-divider">
                    <th scope="row" className="max-w-0 px-4 py-2.5 text-left font-normal">
                      <span className="block truncate">{item.nome}</span>
                      <span className="block truncate text-xs text-ink-2">{item.sku}</span>
                    </th>
                    <td className="px-2 py-2.5 tabular-nums text-ink-2">{item.lote}</td>
                    <td className="px-2 py-2.5 text-ink-2">{item.segmento}</td>
                    {!custoOculto && (
                      <>
                        <td className="px-2 py-2.5 text-right font-display font-bold tabular-nums text-ink">
                          {formatarBRL(item.custo ?? null)}
                        </td>
                        <td className="px-2 py-2.5 text-right font-display font-bold tabular-nums text-navy">
                          {formatarBRL(item.precoAlvo ?? null)}
                        </td>
                      </>
                    )}
                    <td className="px-2 py-2.5 text-ink-2">
                      {item.canais.length === 0
                        ? "—"
                        : item.canais.map((c) => ROTULO_CANAL[c]).join(" · ")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-pill px-2.5 py-[3px] text-[11px] ${pill.classe}`}>
                        {pill.rotulo}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Honestidade sobre um KPI que nunca vai sair de zero sozinho. Sem esta
          nota, "Reservados 0" parece operacao tranquila em vez de recurso que
          ninguem implementou. */}
      {kpis.reservados === 0 && (
        <p className="text-xs text-ink-2">
          <strong>Reservados</strong> fica em zero porque nada no sistema reserva
          item ainda: se a MM reserva durante negociação — e por quanto tempo — é
          decisão pendente com o Anderson.
        </p>
      )}
    </div>
  );
}
