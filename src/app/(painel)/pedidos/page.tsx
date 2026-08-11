/**
 * Tela Pedidos — portada do handoff (README secao 4).
 *
 * FIDELIDADE: colunas Nº / Produto / Canal / Valor / Taxa / NF-e / Status, com
 * a taxa em vermelho (e valor que SAI) e as pills de status do design system.
 *
 * QUATRO DIVERGENCIAS, todas justificadas:
 *
 * 1. **Os cards de resumo subiram para o TOPO.** No prototipo ficavam depois de
 *    cinco linhas de tabela, abaixo da dobra — e sao o que o dono abre a tela
 *    para ver. Era achado da auditoria.
 * 2. **Seletor de mes**, que o prototipo nao tinha (cravava "Agosto"). O
 *    periodo sai de `vendido_em`, nao de `created_at` (RN-114).
 * 3. **Coluna "a conferir"**: pedido criado por integracao nasce com valores
 *    calculados a partir de taxa que pode ser estimada. Sem esta marca, o
 *    rodape passaria por extrato.
 * 4. **Nada de dinheiro para o operador** (RN-107) — nem colunas, nem cards.
 */
import { redirect } from "next/navigation";

import { lerPedidos, mesCorrente, type StatusPedido } from "@/lib/actions/pedidos";
import { lerSessao } from "@/lib/auth/sessao";
import { formatarBRL, type Canal } from "@/lib/pricing";

import { FiltroMes, rotuloDoMes } from "./_components/filtro-mes";

export const dynamic = "force-dynamic";

const ROTULO_CANAL: Record<Canal, string> = {
  mercado_livre: "ML",
  olx: "OLX",
  // "WA" sozinho nao e obvio (achado da auditoria). Aqui cabe o nome inteiro.
  whatsapp: "Direta",
};

const PILL_STATUS: Record<StatusPedido, { rotulo: string; classe: string }> = {
  aguardando_envio: { rotulo: "Aguardando envio", classe: "bg-warning-soft text-warning-text" },
  em_transporte: { rotulo: "Em transporte", classe: "bg-info-soft text-info" },
  concluido: { rotulo: "Concluído", classe: "bg-success-soft text-success" },
  cancelado: { rotulo: "Cancelado", classe: "bg-danger-soft text-danger" },
};

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const { mes: mesPedido } = await searchParams;
  const { pedidos, totais, dinheiroOculto, mes } = await lerPedidos(sessao.papel, mesPedido);

  const colunas = dinheiroOculto ? 5 : 7;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[22px] font-bold text-navy">Pedidos</h1>
          <span className="text-[13px] capitalize text-ink-2">
            {rotuloDoMes(mes)} · {pedidos.length} pedido{pedidos.length === 1 ? "" : "s"}
            {mes === mesCorrente() ? "" : " · mês fechado"}
          </span>
        </div>
        <FiltroMes mes={mes} />
      </header>

      {/* ANTES da tabela: e o numero que o dono vem ver. */}
      {totais && (
        <>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card rotulo="Faturamento bruto" valor={totais.faturamento} />
            <Card rotulo="Taxas" valor={-totais.taxas} sai />
            <Card rotulo="Comissões (4%)" valor={-totais.comissoes} sai />
            <Card rotulo="Líquido" valor={totais.liquido} destaque />
          </dl>

          {totais.aConferir > 0 && (
            <p className="rounded-card border border-warning bg-warning-soft px-4 py-3 text-xs text-warning-note">
              <strong>
                {totais.aConferir} pedido{totais.aConferir === 1 ? "" : "s"} ainda não conferido
                {totais.aConferir === 1 ? "" : "s"}
              </strong>{" "}
              contra o extrato do canal: a taxa pode ter sido estimada por nós, e a
              base da comissão de 4% ainda não foi confirmada. Trate estes números
              como parciais.
            </p>
          )}
        </>
      )}

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-table-head text-left text-[11px] uppercase tracking-[.12em] text-ink-2">
              <th scope="col" className="px-4 py-2.5 font-normal">Nº</th>
              <th scope="col" className="px-2 py-2.5 font-normal">Produto</th>
              <th scope="col" className="px-2 py-2.5 font-normal">Canal</th>
              {!dinheiroOculto && (
                <>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">Valor</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-normal">Taxa</th>
                </>
              )}
              <th scope="col" className="px-2 py-2.5 font-normal">NF-e</th>
              <th scope="col" className="px-4 py-2.5 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.length === 0 ? (
              <tr>
                <td colSpan={colunas} className="px-4 py-12 text-center text-ink-2">
                  Nenhum pedido em {rotuloDoMes(mes)}.
                </td>
              </tr>
            ) : (
              pedidos.map((p) => {
                const pill = PILL_STATUS[p.status];
                return (
                  <tr key={p.id} className="border-t border-divider">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal tabular-nums text-ink-2">
                      {p.numero}
                      {/* So para quem ve dinheiro: o marcador fala de VALORES
                          nao conferidos, e para o operador isso e ruido sobre
                          um estado que ele nem consegue observar. */}
                      {p.aConferir && !dinheiroOculto && (
                        <span
                          title="Valores ainda não conferidos contra o extrato do canal"
                          className="ml-1.5 text-warning-text"
                          aria-label="a conferir"
                        >
                          •
                        </span>
                      )}
                    </th>
                    <td className="max-w-0 truncate px-2 py-2.5">{p.produto}</td>
                    <td className="px-2 py-2.5 text-ink-2">{ROTULO_CANAL[p.canal]}</td>
                    {!dinheiroOculto && (
                      <>
                        <td className="px-2 py-2.5 text-right font-display font-bold tabular-nums text-navy">
                          {formatarBRL(p.valor ?? null)}
                        </td>
                        {/* Taxa sempre em `danger`: e dinheiro que sai (handoff). */}
                        <td className="px-2 py-2.5 text-right font-display font-bold tabular-nums text-danger">
                          −{formatarBRL(p.taxa ?? null)}
                        </td>
                      </>
                    )}
                    <td className="px-2 py-2.5">
                      {p.nfeEmitida ? (
                        <span className="text-success">Emitida</span>
                      ) : (
                        <span className="text-ink-2">—</span>
                      )}
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
    </div>
  );
}

/** Card do resumo. Numero em Archivo, como manda o design system. */
function Card({
  rotulo,
  valor,
  sai = false,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  sai?: boolean;
  destaque?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-card border bg-card px-5 py-4 ${
        destaque ? "border-navy" : "border-border"
      }`}
    >
      <dt className="text-[11px] uppercase tracking-[.14em] text-ink-2">{rotulo}</dt>
      <dd
        className={`font-display text-[26px] font-extrabold tabular-nums ${
          sai ? "text-danger" : "text-navy"
        }`}
      >
        {formatarBRL(valor)}
      </dd>
    </div>
  );
}
