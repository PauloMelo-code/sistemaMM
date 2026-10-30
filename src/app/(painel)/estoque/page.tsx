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

import { lerEstoque, ORDENS_ESTOQUE, type SituacaoItem } from "@/lib/actions/estoque";
import { CabecalhoOrdenavel, lerOrdem } from "@/components/ui/cabecalho-ordenavel";
import { listarLotesParaSelecao } from "@/lib/actions/lotes";
import { temPermissao } from "@/lib/auth/rbac";
import { BotaoNovoItem, AcoesItem } from "./_components/formulario-item";
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
  searchParams: Promise<{
    segmento?: string;
    situacao?: string;
    ordem?: string;
    dir?: string;
  }>;
}) {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const params = await searchParams;
  const situacao = SITUACOES.find((s) => s === params.situacao);
  const segmento = params.segmento?.trim() || undefined;
  // Chave desconhecida cai no padrao — nunca chega a consulta.
  const { ordem, direcao } = lerOrdem(ORDENS_ESTOQUE, params.ordem, params.dir);

  const { itens, kpis, segmentos, custoOculto } = await lerEstoque(sessao.papel, {
    segmento,
    situacao,
    ordem,
    direcao,
  });

  /** Filtros a preservar quando a ordem muda — senao ordenar zera o recorte. */
  const filtrosAtuais = { segmento, situacao };

  /**
   * Cadastro exige `itens` E `itens_custo` — ver o cabecalho de
   * `estoque-mutacoes.ts`. Na pratica: administrador. Decidido no SERVIDOR, e
   * as actions conferem de novo.
   */
  const podeEscrever =
    temPermissao(sessao.papel, "itens", "criar") &&
    temPermissao(sessao.papel, "itens_custo", "criar");

  // So busca os lotes se houver formulario para preencher.
  const lotes = podeEscrever ? await listarLotesParaSelecao(sessao.papel) : [];

  const colunas = (custoOculto ? 6 : 8) + (podeEscrever ? 1 : 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[22px] font-bold text-navy">Estoque</h1>
          <span className="text-[13px] text-ink-2">
            {itens.length} {itens.length === 1 ? "item" : "itens"}
            {segmento || situacao ? " no filtro atual" : ""} · baixa automática quando o item vende
            em qualquer canal
          </span>
        </div>
        {podeEscrever ? <BotaoNovoItem lotes={lotes} /> : null}
      </header>

      <FiltrosEstoque kpis={kpis} segmentos={segmentos} segmento={segmento} situacao={situacao} />

      {/* `relative` NAO e decoracao: sem ele o `sr-only` do cabecalho de Acoes
          (que e `position:absolute`) escapa deste contentor. Um elemento
          absoluto e recortado pelo bloco CONTENTOR dele, e um ancestral
          `static` com `overflow` nao serve de bloco contentor — entao o rotulo
          invisivel ia parar em x=760 e fazia a PAGINA INTEIRA rolar de lado
          (394px a 375px de viewport). Medido: `scrollWidth` 761 -> 367. */}
      <div className="relative overflow-x-auto rounded-card border border-border bg-card shadow-(--shadow-card)">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-table-head text-left text-[11px] uppercase tracking-[.12em] text-ink-2">
              <CabecalhoOrdenavel
                rotulo="Item"
                chave="nome"
                base="/estoque"
                ordemAtual={ordem}
                direcaoAtual={direcao}
                parametros={filtrosAtuais}
                className="px-4"
              />
              <CabecalhoOrdenavel
                rotulo="Lote"
                chave="lote"
                base="/estoque"
                ordemAtual={ordem}
                direcaoAtual={direcao}
                parametros={filtrosAtuais}
              />
              <CabecalhoOrdenavel
                rotulo="Segmento"
                chave="segmento"
                base="/estoque"
                ordemAtual={ordem}
                direcaoAtual={direcao}
                parametros={filtrosAtuais}
              />
              {!custoOculto && (
                <>
                  <CabecalhoOrdenavel
                    rotulo="Custo"
                    chave="custo"
                    base="/estoque"
                    ordemAtual={ordem}
                    direcaoAtual={direcao}
                    parametros={filtrosAtuais}
                    direita
                  />
                  {/* `whitespace-nowrap`: com a coluna Item absorvendo a sobra,
                      as demais encolhem ate o conteudo — e este e o unico
                      cabecalho de duas palavras, que virava "Preço / alvo". */}
                  <CabecalhoOrdenavel
                    rotulo="Preço alvo"
                    chave="precoAlvo"
                    base="/estoque"
                    ordemAtual={ordem}
                    direcaoAtual={direcao}
                    parametros={filtrosAtuais}
                    direita
                    className="whitespace-nowrap"
                  />
                </>
              )}
              {/* Qtd: unidades em estoque (ADR-0002). Peca unica e 1. */}
              <th scope="col" className="px-2 py-2.5 text-right font-normal">Qtd</th>
              {/* Canais NAO ordena: e um array agregado no banco, e "ordenar por
                  lista de canais" nao tem significado que o Anderson use. */}
              <th scope="col" className="px-2 py-2.5 font-normal">Canais</th>
              <CabecalhoOrdenavel
                rotulo="Situação"
                chave="situacao"
                base="/estoque"
                ordemAtual={ordem}
                direcaoAtual={direcao}
                parametros={filtrosAtuais}
                className="px-4"
              />
              {podeEscrever ? (
                // Cabecalho sem rotulo visivel, mas COM nome para leitor de
                // tela: uma coluna anonima e um buraco na tabela para quem nao
                // ve os botoes.
                <th scope="col" className="px-4 py-2.5 text-right font-normal">
                  <span className="sr-only">Ações</span>
                </th>
              ) : null}
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
                // Hover em `row-selected`, e nao `table-head`: o `--page`
                // clareou para #F7F8FA na casca nova, que e EXATAMENTE o valor
                // de `--table-head` — hover com ele seria invisivel sobre o
                // card. `row-selected` (#F0F4F9) ja existe e significa "linha
                // em destaque".
                return (
                  <tr
                    key={item.id}
                    className="border-t border-divider transition-colors duration-(--duracao-rapida) ease-(--ease-padrao) hover:bg-row-selected"
                  >
                    {/* `w-full max-w-0` andam SEMPRE juntos — sao as duas
                        metades da mesma receita. `max-w-0` deixa a celula
                        encolher (sem ele o nome longo alarga a tabela e nada
                        trunca); `w-full` faz ela ABSORVER a sobra. Com so o
                        `max-w-0`, em `table-layout:auto`, esta coluna ficava
                        com 98px num viewport de 1440 e ate o SKU saia cortado
                        ("MM-AUT-0..."), enquanto Acoes levava 241px. E esta e
                        a coluna que o handoff define como `minmax(0,1fr)`. */}
                    <th scope="row" className="w-full max-w-0 px-4 py-2.5 text-left font-normal">
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
                    <td className="px-2 py-2.5 text-right tabular-nums">{item.quantidade}</td>
                    <td className="px-2 py-2.5 text-ink-2">
                      {item.canais.length === 0
                        ? "—"
                        : item.canais.map((c) => ROTULO_CANAL[c]).join(" · ")}
                    </td>
                    <td className="px-4 py-2.5">
                      {/* `whitespace-nowrap` pelo mesmo motivo do cabecalho:
                          "Sem anúncio" quebrava em duas linhas e a pill virava
                          um retangulo de dois andares. */}
                      <span
                        className={`whitespace-nowrap rounded-pill px-2.5 py-[3px] text-[11px] ${pill.classe}`}
                      >
                        {pill.rotulo}
                      </span>
                    </td>
                    {podeEscrever ? (
                      <td className="px-4 py-2.5">
                        <AcoesItem
                          lotes={lotes}
                          item={{
                            id: item.id,
                            sku: item.sku,
                            nome: item.nome,
                            // `!` seguro: estes campos so existem quando
                            // `podeEscrever`, que exige a permissao de custo —
                            // a mesma que faz a action devolve-los.
                            loteId: item.loteId!,
                            segmento: item.segmento,
                            custo: item.custoTexto!,
                            precoAlvo: item.precoAlvoTexto!,
                            localGalpao: item.localGalpao!,
                            situacao: item.situacao,
                            quantidade: item.quantidade,
                            atualizadoEm: item.atualizadoEm!,
                            vendido: item.situacao === "vendido",
                          }}
                        />
                      </td>
                    ) : null}
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
