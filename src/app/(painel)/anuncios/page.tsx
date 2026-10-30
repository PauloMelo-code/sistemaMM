/**
 * Tela Anuncios — portada do handoff (README secao 2).
 *
 * FIDELIDADE: chips de filtro, colunas Produto / Canal / Preco / Margem /
 * Visitas / Status, cores por status e a nota ambar do rodape.
 *
 * TRES DIVERGENCIAS DELIBERADAS, todas vindas da auditoria:
 *
 * 1. **`<table>` semantica** em vez de grid de `<span>`. E o que conserta de uma
 *    vez a colisao de colunas (o nome do produto era pintado por cima da coluna
 *    seguinte abaixo de ~1100px) e a acessibilidade — leitor de tela nao le
 *    grid de span como tabela.
 * 2. **Filtro na URL**, nao em estado de cliente: vira link compartilhavel,
 *    sobrevive ao F5 e dispensa JavaScript.
 * 3. **Sem coluna Margem para o operador** (RN-107) — e o campo nem chega ao
 *    navegador. Ver `actions/anuncios.ts`.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { listarAnuncios, ORDENS_ANUNCIOS, type StatusAnuncio } from "@/lib/actions/anuncios";
import { contarAnunciosImportados } from "@/lib/actions/integracoes";
import { CabecalhoOrdenavel, lerOrdem } from "@/components/ui/cabecalho-ordenavel";
import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao } from "@/lib/auth/sessao";
import { formatarBRL, MARGEM_SAUDAVEL, type Canal } from "@/lib/pricing";

import { ChipsFiltro } from "./_components/chips-filtro";

export const dynamic = "force-dynamic";

const ROTULO_CANAL: Record<Canal, string> = {
  mercado_livre: "ML",
  olx: "OLX",
  whatsapp: "WA",
};

const PILL_STATUS: Record<StatusAnuncio, { rotulo: string; classe: string }> = {
  no_ar: { rotulo: "No ar", classe: "bg-success-soft text-success" },
  negociando: { rotulo: "Negociando", classe: "bg-warning-soft text-warning-text" },
  pausado: { rotulo: "Pausado", classe: "bg-table-head text-ink-2" },
};

const CANAIS_VALIDOS: Canal[] = ["mercado_livre", "olx", "whatsapp"];
const STATUS_VALIDOS: StatusAnuncio[] = ["no_ar", "negociando", "pausado"];

export default async function AnunciosPage({
  searchParams,
}: {
  searchParams: Promise<{ canal?: string; status?: string; ordem?: string; dir?: string }>;
}) {
  // O layout de `(painel)` ja barra quem nao tem sessao; aqui a sessao e lida de
  // novo porque o PAPEL decide o que a consulta traz. Sem isso, a RN-107 nao
  // teria como ser aplicada.
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const params = await searchParams;
  // Valor invalido na URL e IGNORADO, nao vira erro: query string e coisa que
  // as pessoas editam e colam. Filtro desconhecido mostra tudo.
  const canal = CANAIS_VALIDOS.find((c) => c === params.canal);
  const status = STATUS_VALIDOS.find((s) => s === params.status);

  const { ordem, direcao } = lerOrdem(ORDENS_ANUNCIOS, params.ordem, params.dir);

  // Os importados do ML moram fora daqui ate o vinculo com o Estoque (RN-123).
  // O link existe para que eles nao fiquem escondidos atras do card de
  // Integracoes — e so para quem pode abrir aquela tela.
  const verImportados = temPermissao(sessao.papel, "integracoes", "ler");

  const [{ anuncios, margemOculta, margemIgnoraFrete }, importados] = await Promise.all([
    listarAnuncios(sessao.papel, { canal, status, ordem, direcao }),
    verImportados ? contarAnunciosImportados() : Promise.resolve(0),
  ]);

  /** Filtros de canal/status preservados ao trocar a ordem. */
  const filtrosAtuais = { canal, status };

  const colunas = margemOculta ? 5 : 6;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[22px] font-bold text-navy">Anúncios</h1>
          <span className="text-[13px] text-ink-2">
            {anuncios.length} anúncio{anuncios.length === 1 ? "" : "s"}
            {canal || status ? " no filtro atual" : " · todos os canais"}
          </span>
        </div>
        {verImportados && (
          <Link
            href="/integracoes/mercado-livre"
            className="rounded-button border border-border px-4 py-2 text-[13px] font-medium text-ink foco"
          >
            {importados > 0
              ? `Importados do Mercado Livre (${importados}) →`
              : "Importar do Mercado Livre →"}
          </Link>
        )}
      </header>

      <ChipsFiltro canal={canal} status={status} />

      {/* `overflow-x-auto` no CONTEINER, com `min-w` na tabela: quem rola e a
          tabela, nunca o corpo da pagina. Era a correcao pedida pela auditoria. */}
      {/* `relative` para que qualquer filho `position:absolute` (sr-only,
          tooltip) seja recortado POR ESTE contentor. Sem ele o elemento
          absoluto escapa da caixa que rola e faz a pagina inteira rolar de
          lado — foi o que aconteceu em /estoque. Ver o comentario de la. */}
      <div className="relative overflow-x-auto rounded-card border border-border bg-card shadow-(--shadow-card)">
        <table className="w-full min-w-[680px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-table-head text-left text-[11px] uppercase tracking-[.12em] text-ink-2">
              {(
                [
                  ["Produto", "produto", false, "px-4"],
                  ["Canal", "canal", false, ""],
                  ["Preço", "preco", true, ""],
                ] as const
              ).map(([rotulo, chave, direita, extra]) => (
                <CabecalhoOrdenavel
                  key={chave}
                  rotulo={rotulo}
                  chave={chave}
                  base="/anuncios"
                  ordemAtual={ordem}
                  direcaoAtual={direcao}
                  parametros={filtrosAtuais}
                  direita={direita}
                  className={extra}
                />
              ))}
              {/* MARGEM nao ordena, e nao e esquecimento: ela sai de
                  `pricing.ts` depois da consulta, por linha. Ordenar exigiria
                  reescrever a formula em SQL — segunda copia da regra de
                  dinheiro, proibida pela RN-100. Ver ORDENS_ANUNCIOS. */}
              {!margemOculta && (
                <th scope="col" className="px-2 py-2.5 text-right font-normal">Margem</th>
              )}
              <CabecalhoOrdenavel
                rotulo="Visitas"
                chave="visitas"
                base="/anuncios"
                ordemAtual={ordem}
                direcaoAtual={direcao}
                parametros={filtrosAtuais}
                direita
              />
              <CabecalhoOrdenavel
                rotulo="Status"
                chave="status"
                base="/anuncios"
                ordemAtual={ordem}
                direcaoAtual={direcao}
                parametros={filtrosAtuais}
                className="px-4"
              />
            </tr>
          </thead>
          <tbody>
            {anuncios.length === 0 ? (
              <tr>
                <td colSpan={colunas} className="px-4 py-12 text-center text-ink-2">
                  Nenhum anúncio {canal || status ? "com este filtro" : "cadastrado"}.
                </td>
              </tr>
            ) : (
              anuncios.map((a) => {
                const pill = PILL_STATUS[a.status];
                return (
                  <tr
                    key={a.id}
                    className="border-t border-divider transition-colors duration-(--duracao-rapida) ease-(--ease-padrao) hover:bg-row-selected"
                  >
                    {/* `w-full max-w-0` andam em par: `max-w-0` deixa encolher,
                        `w-full` faz absorver a sobra. So com `max-w-0` a coluna
                        do produto — que o handoff define como `minmax(0,1fr)` —
                        ficava a mais estreita da tabela e o nome saia cortado
                        com folga vazia na coluna ao lado. Igual em /estoque. */}
                    <th
                      scope="row"
                      className="w-full max-w-0 truncate px-4 py-2.5 text-left font-normal"
                    >
                      {a.produto}
                    </th>
                    <td className="px-2 py-2.5 text-ink-2">{ROTULO_CANAL[a.canal]}</td>
                    <td className="px-2 py-2.5 text-right font-display font-bold tabular-nums text-navy">
                      {formatarBRL(a.preco)}
                    </td>
                    {!margemOculta && (
                      <td
                        className={`px-2 py-2.5 text-right font-display font-bold tabular-nums ${
                          a.margem !== null && a.margem !== undefined && a.margem >= MARGEM_SAUDAVEL
                            ? "text-success"
                            : "text-warning-text"
                        }`}
                      >
                        {a.margem === null || a.margem === undefined
                          ? "—"
                          : `${Math.round(a.margem * 100)}%`}
                      </td>
                    )}
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink-2">{a.visitas}</td>
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

      {/* A nota do handoff. Ambar porque e ressalva sobre dinheiro, nao enfeite. */}
      {!margemOculta && (
        <p className="rounded-card border border-warning bg-warning-soft px-4 py-3 text-xs text-warning-note">
          A margem já desconta a taxa do canal e a comissão (RN-103).
          {margemIgnoraFrete ? (
            <>
              {" "}
              <strong>Ela ainda não desconta frete</strong> — o sistema não guarda
              frete por item, então o número está otimista, e mais ainda em
              equipamento pesado.
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
