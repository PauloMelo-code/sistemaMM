/**
 * Anuncios importados do Mercado Livre (RN-123).
 *
 * E a fotografia da conta como esta no ML, FORA do Estoque: o ML nao sabe de
 * lote nem de custo. Daqui sai, na etapa 2, o vinculo com o item.
 *
 * Mesma permissao da tela Integracoes. Nao ha custo aqui — so preco de anuncio,
 * que e publico no proprio ML.
 */
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { lerAnunciosImportados } from "@/lib/actions/integracoes";
import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao } from "@/lib/auth/sessao";
import { formatarBRL } from "@/lib/pricing";

import { BotaoImportar } from "./_components/botao-importar";

export const dynamic = "force-dynamic";

/** Vocabulario do ML -> tela. Status desconhecido aparece cru, nunca some. */
const STATUS: Record<string, { rotulo: string; classe: string }> = {
  active: { rotulo: "Ativo", classe: "bg-success-soft text-success" },
  paused: { rotulo: "Pausado", classe: "bg-warning-soft text-warning-text" },
  closed: { rotulo: "Encerrado", classe: "bg-table-head text-ink-2" },
  under_review: { rotulo: "Em revisão", classe: "bg-warning-soft text-warning-text" },
};

const TIPO: Record<string, string> = { gold_special: "Clássico", gold_pro: "Premium" };

/** Horario de Brasilia explicito: o servidor do EasyPanel roda em UTC. */
const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export default async function AnunciosImportadosPage() {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  if (!temPermissao(sessao.papel, "integracoes", "ler")) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-card shadow-(--shadow-card) px-6 py-10">
        <h1 className="font-display text-[18px] font-bold text-navy">Anúncios do Mercado Livre</h1>
        <p className="max-w-prose text-[13px] text-ink-2">Esta tela não faz parte do seu acesso.</p>
      </div>
    );
  }

  const podeImportar = temPermissao(sessao.papel, "integracoes", "atualizar");
  const { anuncios, ultimaImportacao } = await lerAnunciosImportados();
  const duplicados = anuncios.filter((a) => a.skuDuplicado).length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Link href="/integracoes" className="self-start text-xs text-ink-2 hover:text-ink foco">
            ← Integrações
          </Link>
          <h1 className="font-display text-[22px] font-bold text-navy">Anúncios do Mercado Livre</h1>
          <span className="text-[13px] text-ink-2">
            {anuncios.length} anúncio{anuncios.length === 1 ? "" : "s"} ·{" "}
            {ultimaImportacao
              ? `importados em ${DATA_HORA.format(ultimaImportacao)}`
              : "nenhuma importação ainda"}{" "}
            · só leitura, nada é alterado no ML
          </span>
        </div>
        {podeImportar && <BotaoImportar />}
      </header>

      {duplicados > 0 && (
        <p role="status" className="rounded-card bg-warning-soft px-4 py-3 text-[13px] text-warning-text">
          {duplicados} anúncios dividem SKU com outro anúncio. O vínculo com o Estoque
          fica bloqueado para eles até o SKU ser corrigido no Mercado Livre (RN-123).
        </p>
      )}

      <div className="relative overflow-x-auto rounded-card border border-border bg-card shadow-(--shadow-card)">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-table-head text-left text-[11px] uppercase tracking-[.12em] text-ink-2">
              <th scope="col" className="px-4 py-2.5 font-normal">Anúncio</th>
              <th scope="col" className="px-2 py-2.5 font-normal">SKU</th>
              <th scope="col" className="px-2 py-2.5 text-right font-normal">Preço</th>
              <th scope="col" className="px-2 py-2.5 text-right font-normal">Disponível</th>
              <th scope="col" className="px-2 py-2.5 text-right font-normal">Vendidos</th>
              <th scope="col" className="px-2 py-2.5 font-normal">Tipo</th>
              <th scope="col" className="px-4 py-2.5 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {anuncios.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-ink-2">
                  Nenhum anúncio importado.
                  {podeImportar ? " Clique em “Importar agora”." : ""}
                </td>
              </tr>
            ) : (
              anuncios.map((a) => {
                const status = STATUS[a.status] ?? { rotulo: a.status, classe: "bg-table-head text-ink-2" };
                return (
                  <tr key={a.id} className="border-t border-divider">
                    <th scope="row" className="w-full max-w-0 px-4 py-2 text-left font-normal">
                      <div className="flex items-center gap-3">
                        {a.foto ? (
                          <Image
                            src={a.foto}
                            alt=""
                            width={40}
                            height={40}
                            className="size-10 shrink-0 rounded-button border border-divider object-cover"
                          />
                        ) : (
                          <span aria-hidden className="size-10 shrink-0 rounded-button bg-table-head" />
                        )}
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{a.titulo}</span>
                          <span className="text-[11px] text-ink-2">
                            {a.permalink ? (
                              <a
                                href={a.permalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-ink foco"
                              >
                                {a.idExterno} ↗
                              </a>
                            ) : (
                              a.idExterno
                            )}
                          </span>
                        </div>
                      </div>
                    </th>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {a.sku ?? <span className="text-ink-2">sem SKU</span>}
                      {a.skuDuplicado && (
                        <span className="ml-1.5 rounded-pill bg-warning-soft px-2 py-[2px] text-[11px] text-warning-text">
                          duplicado
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-display font-bold tabular-nums text-navy">
                      {formatarBRL(a.preco)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.qtdDisponivel}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.qtdVendida}</td>
                    <td className="px-2 py-2 text-ink-2">{TIPO[a.tipoAnuncio] ?? a.tipoAnuncio}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-pill px-2.5 py-[3px] text-[11px] ${status.classe}`}>
                        {status.rotulo}
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
