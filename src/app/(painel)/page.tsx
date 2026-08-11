/**
 * Visao geral — a raiz do painel (`/`), portada do handoff (README secao 1).
 *
 * FIDELIDADE: 4 KPIs, grid `1.7fr 1fr` com anuncios em destaque a esquerda e a
 * coluna de perguntas e lotes a direita, e o card de perguntas com borda ambar.
 *
 * DIVERGENCIAS:
 * 1. **Numero nao quebra linha.** O prototipo exibia `R$ / 38.400` em duas
 *    linhas (grid fixo sem minimo) — achado da auditoria. Aqui os KPIs sao
 *    flex com `truncate`, e o numero cabe ou corta, mas nunca dobra.
 * 2. **"Perguntas recentes" mostra as mais URGENTES.** Numa tela de resumo, o
 *    que importa e o que esta prestes a estourar o SLA — "recente" e "urgente"
 *    so coincidem enquanto nada atrasa.
 * 3. **Para o operador a tela encolhe e DIZ isso** (RN-107). Vendas, margem e
 *    lotes sao dinheiro; mostrar zeros seria mentira.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { lerVisaoGeral } from "@/lib/actions/visao-geral";
import { lerSessao } from "@/lib/auth/sessao";
import { formatarBRL, type Canal } from "@/lib/pricing";
import { classificarSla, formatarDuracao, textoPrazo } from "@/lib/sla";

export const dynamic = "force-dynamic";

const ROTULO_CANAL: Record<Canal, string> = {
  mercado_livre: "Mercado Livre",
  olx: "OLX",
  whatsapp: "Venda direta",
};

export default async function VisaoGeralPage() {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const v = await lerVisaoGeral(sessao.papel);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[22px] font-bold text-navy">Visão geral</h1>
          <span className="text-[13px] text-ink-2">
            Olá, {sessao.nome.split(" ")[0]} · dados de todos os canais
          </span>
        </div>
        <Link
          href="/anuncios"
          className="rounded-button border border-border-input bg-card px-4 py-2 text-[13px] text-ink hover:bg-table-head focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          Ver anúncios
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!v.dinheiroOculto && (
          <>
            <Kpi rotulo="Vendas do mês" valor={formatarBRL(v.vendasDoMes ?? 0)} />
            <Kpi
              rotulo="Margem média"
              valor={v.margemMedia === null || v.margemMedia === undefined
                ? "—"
                : `${Math.round(v.margemMedia * 100)}%`}
              nota="realizada, das vendas do mês"
            />
          </>
        )}

        {/* Borda ambar quando ha pergunta esperando: ambar e alerta, e aqui ele
            aparece so quando existe alerta de verdade. */}
        <Kpi
          rotulo="Perguntas sem resposta"
          valor={String(v.perguntasSemResposta)}
          href="/perguntas"
          alerta={v.perguntasSemResposta > 0}
        />
        <Kpi
          rotulo="Tempo médio de resposta"
          valor={v.tempoMedioResposta === null ? "—" : formatarDuracao(v.tempoMedioResposta)}
          nota="conta da nossa gravação"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <section
          aria-label="Anúncios em destaque"
          className="overflow-hidden rounded-card border border-border bg-card"
        >
          <h2 className="border-b border-border px-5 py-4 font-display text-[15px] font-bold text-navy">
            Anúncios em destaque
          </h2>
          {v.anunciosDestaque.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-ink-2">
              Nenhum anúncio no ar.
            </p>
          ) : (
            <ul className="flex flex-col">
              {v.anunciosDestaque.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 border-b border-divider px-5 py-3 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{a.produto}</span>
                    <span className="block text-xs text-ink-2">{ROTULO_CANAL[a.canal]}</span>
                  </span>
                  {!v.dinheiroOculto && (
                    <span className="shrink-0 font-display text-[15px] font-bold tabular-nums text-navy">
                      {formatarBRL(a.preco)}
                    </span>
                  )}
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-2">
                    {a.visitas} vis.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section
            aria-label="Perguntas mais urgentes"
            className="overflow-hidden rounded-card border border-border bg-card"
          >
            <h2 className="flex items-center justify-between gap-2 border-b border-border px-5 py-4 font-display text-[15px] font-bold text-navy">
              Perguntas urgentes
              <Link
                href="/perguntas"
                className="text-xs font-normal text-ink-2 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
              >
                ver todas
              </Link>
            </h2>
            {v.perguntasRecentes.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-ink-2">
                Nenhuma pergunta esperando.
              </p>
            ) : (
              <ul className="flex flex-col">
                {v.perguntasRecentes.map((p) => {
                  const estado = classificarSla({
                    segundosRestantes: p.segundosRestantes,
                    respondida: false,
                  });
                  return (
                    <li
                      key={p.id}
                      className="flex flex-col gap-1 border-b border-divider px-5 py-3 last:border-b-0"
                    >
                      <span className="text-xs text-ink-2">
                        {ROTULO_CANAL[p.canal]}
                        {p.item ? ` · ${p.item}` : ""}
                      </span>
                      <span className="line-clamp-2 text-[13px]">{p.texto}</span>
                      <span
                        className={`text-xs ${
                          estado === "vencido" || estado === "urgente"
                            ? "text-danger"
                            : estado === "atencao"
                              ? "text-warning-text"
                              : "text-ink-2"
                        }`}
                      >
                        {textoPrazo(p.segundosRestantes)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {v.lotes && (
            <section
              aria-label="Estoque por lote"
              className="overflow-hidden rounded-card border border-border bg-card"
            >
              <h2 className="border-b border-border px-5 py-4 font-display text-[15px] font-bold text-navy">
                Estoque por lote
              </h2>
              {v.lotes.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-ink-2">
                  Nenhum lote cadastrado.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {v.lotes.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-col gap-1.5 border-b border-divider px-5 py-3 last:border-b-0"
                    >
                      <span className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate">Lote {l.nome}</span>
                        <span className="shrink-0 tabular-nums text-ink-2">
                          {l.vendidos}/{l.itens}
                        </span>
                      </span>
                      {/* Barra de progresso do handoff. `aria-*` porque a barra
                          sozinha nao diz nada para leitor de tela. */}
                      <span
                        role="progressbar"
                        aria-valuenow={l.vendidos}
                        aria-valuemin={0}
                        aria-valuemax={l.itens}
                        aria-label={`Lote ${l.nome}: ${l.vendidos} de ${l.itens} itens vendidos`}
                        className="block h-1.5 w-full overflow-hidden rounded-pill bg-divider"
                      >
                        <span
                          className="block h-full rounded-pill bg-success"
                          style={{ width: `${l.itens === 0 ? 0 : (l.vendidos / l.itens) * 100}%` }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Silencio aqui pareceria sistema quebrado. Dizer que e restrito e
          informacao: o operador sabe que a tela esta certa, so nao e para ele. */}
      {v.dinheiroOculto && (
        <p className="text-xs text-ink-2">
          Vendas, margem e estoque por lote não aparecem no seu acesso — são
          informações de custo, restritas ao administrador (RN-107).
        </p>
      )}
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  nota,
  href,
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  href?: string;
  alerta?: boolean;
}) {
  const conteudo = (
    <>
      <span className="text-[11px] uppercase tracking-[.14em] text-ink-2">{rotulo}</span>
      {/* `truncate` e nao quebra: o prototipo exibia `R$ / 38.400` em duas
          linhas, e numero de dinheiro partido ao meio se le errado. */}
      <span className="truncate font-display text-[26px] font-extrabold tabular-nums text-navy">
        {valor}
      </span>
      {nota ? <span className="text-xs text-ink-2">{nota}</span> : null}
    </>
  );

  const classe = `flex min-w-0 flex-col gap-1 rounded-card border bg-card px-5 py-4 ${
    alerta ? "border-warning" : "border-border"
  }`;

  return href ? (
    <Link
      href={href}
      className={`${classe} hover:border-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy`}
    >
      {conteudo}
    </Link>
  ) : (
    <div className={classe}>{conteudo}</div>
  );
}
