/**
 * Vinculo dos anuncios importados do ML com o Estoque (RN-124).
 *
 * Mostra os anuncios sem item agrupados por lote (prefixo do SKU) e pede o
 * custo total de cada lote. So administrador: vincular cria lote, item com
 * custo e anuncio de canal.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { lerParaVincular } from "@/lib/actions/integracoes";
import { temPermissao } from "@/lib/auth/rbac";
import { lerSessao } from "@/lib/auth/sessao";
import { resumirLotes } from "@/lib/integracoes/mercado-livre/vinculo";

import { CopiaDeFotos, FormularioVinculo } from "./_components/formulario-vinculo";

export const dynamic = "force-dynamic";

export default async function VincularPage() {
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const pode =
    temPermissao(sessao.papel, "lotes", "criar") &&
    temPermissao(sessao.papel, "itens_custo", "criar") &&
    temPermissao(sessao.papel, "integracoes", "atualizar");

  if (!pode) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-card shadow-(--shadow-card) px-6 py-10">
        <h1 className="font-display text-[18px] font-bold text-navy">Vincular ao Estoque</h1>
        <p className="max-w-prose text-[13px] text-ink-2">
          Só administrador vincula: o vínculo cria lotes e itens com custo (RN-107).
        </p>
      </div>
    );
  }

  const lotes = resumirLotes(await lerParaVincular());
  // Data de hoje em Brasilia, para o limite do campo de arremate.
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <Link href="/integracoes/mercado-livre" className="self-start text-xs text-ink-2 hover:text-ink foco">
          ← Anúncios do Mercado Livre
        </Link>
        <h1 className="font-display text-[22px] font-bold text-navy">Vincular ao Estoque</h1>
        <span className="text-[13px] text-ink-2">
          Cada prefixo de SKU vira um lote. Informe o custo total de cada um; o sistema rateia entre
          os itens (RN-124).
        </span>
      </header>

      {lotes.length === 0 ? (
        <>
          <p className="text-[13px] text-ink-2">Todos os anúncios importados já estão no Estoque.</p>
          {/* Para terminar uma copia de fotos que ficou pela metade. Item que ja
              tem foto e pulado, entao clicar de novo nao duplica. */}
          <CopiaDeFotos />
        </>
      ) : (
        <FormularioVinculo lotes={lotes} hoje={hoje} />
      )}
    </div>
  );
}
