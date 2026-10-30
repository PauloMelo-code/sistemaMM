/**
 * KPIs clicaveis e chips de segmento.
 *
 * OS KPIS SAO LINKS, e essa e a correcao de um achado da auditoria: no
 * prototipo, "Sem anuncio · 12" era um numero morto — *"o sistema aponta o
 * problema e nao deixa ir ate ele"*. Aqui, clicar filtra a tabela.
 *
 * Os chips de segmento saem do BANCO, nao da lista fixa do handoff: aquela e
 * mock, e `itens.segmento` e texto livre que cresce a cada leilao. Lista
 * chumbada ficaria errada no primeiro segmento novo.
 */
import Link from "next/link";

import type { KpisEstoque, SituacaoItem } from "@/lib/actions/estoque";

interface FiltrosEstoqueProps {
  kpis: KpisEstoque;
  segmentos: string[];
  segmento?: string;
  situacao?: SituacaoItem;
}

/** Monta a URL preservando o outro eixo do filtro. */
function href({
  segmento,
  situacao,
}: {
  segmento?: string;
  situacao?: SituacaoItem;
}): string {
  const p = new URLSearchParams();
  if (segmento) p.set("segmento", segmento);
  if (situacao) p.set("situacao", situacao);
  const query = p.toString();
  return query ? `/estoque?${query}` : "/estoque";
}

export function FiltrosEstoque({ kpis, segmentos, segmento, situacao }: FiltrosEstoqueProps) {
  const cards: Array<{
    rotulo: string;
    valor: number;
    filtra?: SituacaoItem;
    alerta?: boolean;
  }> = [
    // Unidades, nao itens (ADR-0002): o rele de 19 conta 19.
    { rotulo: "Unidades disponíveis", valor: kpis.disponiveis },
    // Ambar: item parado sem anuncio e dinheiro que nao esta girando — alerta
    // de verdade, nao decoracao (design-system.md).
    { rotulo: "Sem anúncio", valor: kpis.semAnuncio, filtra: "sem_anuncio", alerta: true },
    { rotulo: "Reservados", valor: kpis.reservados, filtra: "reservado" },
    { rotulo: "Unidades vendidas no mês", valor: kpis.vendidosNoMes, filtra: "vendido" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((card) => {
          const ativo = card.filtra !== undefined && situacao === card.filtra;
          const destino = href({
            segmento,
            // Clicar no KPI ja ativo DESLIGA o filtro. Sem isso, o unico jeito
            // de voltar seria mexer na URL — e o card ativo viraria beco.
            situacao: ativo ? undefined : card.filtra,
          });

          const conteudo = (
            <>
              <span className="text-[11px] uppercase tracking-[.14em] text-ink-2">
                {card.rotulo}
              </span>
              <span
                className={`font-display text-[26px] font-extrabold tabular-nums ${
                  card.alerta && card.valor > 0 ? "text-warning-text" : "text-navy"
                }`}
              >
                {card.valor}
              </span>
            </>
          );

          const classe = `flex flex-col gap-1.5 rounded-card border bg-card px-5 py-4 ${
            ativo
              ? "border-navy"
              : card.alerta && card.valor > 0
                ? "border-warning"
                : "border-border"
          }`;

          return card.filtra === undefined ? (
            <div key={card.rotulo} className={classe}>
              {conteudo}
            </div>
          ) : (
            <Link
              key={card.rotulo}
              href={destino}
              aria-current={ativo ? "true" : undefined}
              // KPI que filtra E clicavel; o que nao filtra (`card.filtra ===
              // undefined`, acima) e uma `div` parada. A sombra no hover e o
              // que separa os dois na tela. Ver a nota em (painel)/page.tsx.
              className={`${classe} transition-shadow duration-(--duracao-rapida) ease-(--ease-padrao) hover:border-navy hover:shadow-(--shadow-hover) foco`}
            >
              {conteudo}
            </Link>
          );
        })}
      </div>

      <nav aria-label="Filtrar por segmento" className="flex flex-wrap gap-2">
        <Chip href={href({ situacao })} ativo={!segmento}>
          Todos os segmentos
        </Chip>
        {segmentos.map((s) => (
          <Chip key={s} href={href({ segmento: s, situacao })} ativo={segmento === s}>
            {s}
          </Chip>
        ))}
      </nav>
    </div>
  );
}

function Chip({
  href,
  ativo,
  children,
}: {
  href: string;
  ativo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "true" : undefined}
      className={`rounded-button px-3 py-1.5 text-[13px] foco ${
        ativo ? "bg-navy text-white" : "border border-border-input text-ink hover:bg-table-head"
      }`}
    >
      {children}
    </Link>
  );
}
