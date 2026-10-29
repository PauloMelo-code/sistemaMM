/**
 * Tela Lotes — portada do handoff (README secao 7).
 *
 * ⚠️ A ROTA E `/lotes`. No prototipo, `state.screen === 'estoque'` E a tela
 * Lotes (e `'itens'` e a tela Estoque). A inversao fica no prototipo.
 *
 * FIDELIDADE: grid 2x2 de cards, tres colunas Custo / Anunciado / Vendido,
 * barra de progresso do custo recuperado e linha de resumo.
 *
 * DUAS DIVERGENCIAS, ambas da auditoria:
 * 1. **"Anunciado" agora diz o que soma** ("4 de 9 itens"). No prototipo,
 *    `CUSTO 41.000 · ANUNCIADO 47.400` lia-se como "+6.400 de lucro" — mas os
 *    dois numeros cobrem conjuntos diferentes de itens.
 * 2. **Anunciado abaixo do custo ganha destaque.** O Lote 11 do prototipo
 *    mostrava 14.300 contra 18.500 sem aviso nenhum: nem tudo o que esta no ar
 *    cobre o que foi pago.
 */
import { redirect } from "next/navigation";

import { custoRecuperado, giroLento, lerLotes, LENTO_DIAS } from "@/lib/actions/lotes";
import { lerSessao } from "@/lib/auth/sessao";
import { temPermissao } from "@/lib/auth/rbac";
import { formatarBRL } from "@/lib/pricing";
import { BotaoNovoLote, AcoesLote } from "./_components/formulario-lote";

export const dynamic = "force-dynamic";

const MES_ANO = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });

export default async function LotesPage() {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const estado = await lerLotes(sessao.papel);

  // Acesso negado EXPLICITO. Redirecionar em silencio faria a pessoa achar que
  // o link esta quebrado; lista vazia seria mentira ("nenhum lote").
  if (!estado) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-card shadow-(--shadow-card) px-6 py-10">
        <h1 className="font-display text-[18px] font-bold text-navy">Lotes</h1>
        <p className="max-w-prose text-[13px] text-ink-2">
          Esta tela não faz parte do seu acesso. Um lote é custo de arremate do
          primeiro ao último campo — não há versão sem os valores (RN-107).
        </p>
      </div>
    );
  }

  const { lotes, custoTotal, totalItens } = estado;

  /**
   * Quem LE nao necessariamente ESCREVE: a consultoria (Orbital) enxerga tudo e
   * nao opera. Decidido no servidor — o botao nem chega ao HTML de quem nao
   * pode. As actions conferem de novo; esconder botao nunca e a protecao.
   */
  const podeEscrever = temPermissao(sessao.papel, "lotes", "criar");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[22px] font-bold text-navy">Lotes arrematados</h1>
          <span className="text-[13px] text-ink-2">
            {totalItens} {totalItens === 1 ? "item" : "itens"} em {lotes.length}{" "}
            {lotes.length === 1 ? "lote" : "lotes"} · custo total arrematado{" "}
            {formatarBRL(custoTotal)}
          </span>
        </div>
        {podeEscrever ? <BotaoNovoLote /> : null}
      </header>

      {lotes.length === 0 ? (
        <p className="rounded-card border border-border bg-card shadow-(--shadow-card) px-6 py-12 text-center text-[13px] text-ink-2">
          Nenhum lote cadastrado.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lotes.map((lote) => {
            const recuperado = custoRecuperado(lote);
            const lento = giroLento(lote);
            // Anunciado abaixo do custo: o que esta no ar nao cobre o que foi
            // pago. So faz sentido apontar quando ainda ha item para vender.
            const anunciadoNaoCobre =
              lote.anunciado > 0 && lote.anunciado + lote.vendido < lote.custo;

            return (
              <section
                key={lote.id}
                aria-label={`Lote ${lote.nome}`}
                className={`flex flex-col gap-3 rounded-card border bg-card p-5 ${
                  lento ? "border-warning" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-[15px] font-bold text-navy">
                    Lote {lote.nome} · {lote.segmento}
                  </h2>
                  <span className="text-xs text-ink-2">
                    arrematado em {MES_ANO.format(lote.arrematadoEm)}
                  </span>
                </div>

                {podeEscrever ? (
                  <AcoesLote
                    // `temItens` desabilita Excluir com motivo visivel. A action
                    // recusa de qualquer forma — aqui a regra so chega antes do
                    // clique, em vez de depois da confirmacao.
                    temItens={lote.itens > 0}
                    lote={{
                      id: lote.id,
                      nome: lote.nome,
                      segmento: lote.segmento,
                      dataArremate: lote.dataArremateTexto,
                      custoTotal: lote.custoTexto,
                      atualizadoEm: lote.atualizadoEm,
                    }}
                  />
                ) : null}

                <dl className="grid grid-cols-3 gap-3">
                  <Valor rotulo="Custo" valor={lote.custo} legenda={`${lote.itens} itens`} />
                  <Valor
                    rotulo="Anunciado"
                    valor={lote.anunciado}
                    // A correcao do achado: dizer o que a soma cobre.
                    legenda={`${lote.itensAnunciados} de ${lote.itens} itens`}
                  />
                  <Valor
                    rotulo="Vendido"
                    valor={lote.vendido}
                    legenda={`${lote.itensVendidos} de ${lote.itens} itens`}
                    destaque
                  />
                </dl>

                <div className="flex flex-col gap-1.5">
                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(recuperado * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Lote ${lote.nome}: ${Math.round(recuperado * 100)}% do custo recuperado`}
                    className="h-2 w-full overflow-hidden rounded-pill bg-divider"
                  >
                    <div
                      className={`h-full rounded-pill ${lento ? "bg-warning" : "bg-success"}`}
                      // Passa de 100% quando o lote se pagou; a barra para em
                      // 100 mas o texto ao lado mostra o numero real.
                      style={{ width: `${Math.min(recuperado, 1) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-ink-2">
                    {Math.round(recuperado * 100)}% do custo recuperado
                    {lento && (
                      <>
                        {" · "}
                        <strong className="text-warning-text">
                          giro lento: {lote.diasDesdeArremate} dias sem se pagar
                        </strong>
                      </>
                    )}
                  </span>
                </div>

                {anunciadoNaoCobre && (
                  <p className="rounded-button bg-warning-soft px-3 py-2 text-xs text-warning-note">
                    O que está anunciado mais o já vendido ({formatarBRL(lote.anunciado + lote.vendido)}
                    ) ainda não cobre o custo do lote. Faltam{" "}
                    {lote.itens - lote.itensAnunciados - lote.itensVendidos} item(ns) sem anúncio.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="text-xs text-ink-2">
        <strong>&ldquo;Giro lento&rdquo;</strong> aqui é: passou de {LENTO_DIAS} dias do arremate e
        o lote ainda não recuperou o custo. O critério é uma proposta — não há
        regra definida para isso.
      </p>
    </div>
  );
}

function Valor({
  rotulo,
  valor,
  legenda,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  legenda: string;
  destaque?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-[.12em] text-ink-2">{rotulo}</dt>
      <dd
        className={`truncate font-display text-[17px] font-bold tabular-nums ${
          destaque ? "text-success" : "text-navy"
        }`}
      >
        {formatarBRL(valor)}
      </dd>
      <dd className="text-xs text-ink-2">{legenda}</dd>
    </div>
  );
}
