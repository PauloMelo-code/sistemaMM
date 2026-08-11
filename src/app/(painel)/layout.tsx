/**
 * Shell do painel: sidebar de 236px + area de conteudo (handoff, linhas 20-65
 * do prototipo). Server component — busca o contador do badge e repassa.
 *
 * A partir de `md` o shell e o do handoff, exatamente: sidebar lateral fixa em
 * 236px. Abaixo de `md` a sidebar vira uma faixa no topo e o conteudo ocupa a
 * largura toda — senao 236px de menu comem 63% de uma tela de 375px e sobram
 * 75px de conteudo util.
 *
 * Isto NAO e o "mobile-first" que o docs/front.md pede: e so impedir que o
 * layout quebre. A decisao de largura minima suportada continua aberta
 * (docs/known-issues.md 🟡) — nada aqui a antecipa, e o desenho do handoff fica
 * intacto no desktop.
 *
 * Route group `(painel)`: agrupa as 12 telas autenticadas sem entrar na URL. O
 * site publico, quando entrar, vira `(site)` ao lado — decisao ainda registrada
 * como recomendacao em docs/known-issues.md, nao como ADR.
 */
import { redirect } from "next/navigation";

import { contarPerguntasPendentes } from "@/lib/actions/perguntas";
import { lerSessao } from "@/lib/auth/sessao";

import { Sidebar } from "./_components/sidebar";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  /**
   * ESTA e a checagem que vale. O middleware so olha se EXISTE cookie — ele roda
   * no edge e nao alcanca o banco, entao um cookie forjado passa por ele.
   * `lerSessao()` confere o hash do token, a expiracao e se o usuario continua
   * ativo, no servidor.
   *
   * Fica no LAYOUT, e nao em cada `page.tsx`, de proposito: pagina nova nasce
   * protegida sem ninguem lembrar de nada. Esquecer esta linha numa tela seria
   * abrir o painel inteiro por omissao.
   */
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  const perguntasPendentes = await contarPerguntasPendentes();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar perguntasPendentes={perguntasPendentes} sessao={sessao} />
      <main className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-5 md:gap-6 md:px-8 md:py-7">
        {children}
      </main>
    </div>
  );
}
