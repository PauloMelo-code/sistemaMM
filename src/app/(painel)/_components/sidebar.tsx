"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { sair } from "@/lib/actions/auth";
import { temPermissao, type Recurso } from "@/lib/auth/rbac";
import type { Papel } from "@/lib/auth/sessao";

/**
 * Sidebar do painel — as 12 telas do handoff, na ordem do prototipo.
 *
 * Client component pelo unico motivo legitimo: `usePathname` marca o item ativo.
 * Nada mais aqui tem estado.
 *
 * `href: null` = tela ainda nao portada. Aparece na lista (fidelidade ao
 * handoff, o menu e o mapa do sistema) mas nao navega, porque a rota levaria a
 * 404. Ao portar cada tela, troque o `null` pelo caminho.
 */
interface ItemNav {
  rotulo: string;
  href: string | null;
  /**
   * Recurso do RBAC exigido para o item APARECER.
   *
   * Esconder e correto aqui, e nao "desabilitar": um link que o operador nunca
   * vai poder abrir e ruido permanente no menu que ele usa o dia inteiro. A
   * pagina de destino continua barrando por conta propria — menu escondido
   * nunca e a unica protecao.
   */
  exige?: Recurso;
}

const ITENS: ItemNav[] = [
  { rotulo: "Visão geral", href: "/" },
  { rotulo: "Anúncios", href: "/anuncios" },
  { rotulo: "Site", href: null },
  { rotulo: "Perguntas", href: "/perguntas" },
  { rotulo: "Pedidos", href: "/pedidos" },
  { rotulo: "Expedição", href: null },
  { rotulo: "Estoque", href: "/estoque" },
  { rotulo: "Lotes", href: "/lotes", exige: "lotes" },
  { rotulo: "Calculadora de preço", href: null },
  { rotulo: "Relatórios", href: null },
  { rotulo: "Equipe", href: null },
  { rotulo: "Integrações", href: "/integracoes" },
];

interface SidebarProps {
  /** Perguntas pendentes — o badge âmbar. Contado no servidor. */
  perguntasPendentes: number;
  /** Quem está logado. Mostrar o papel evita operar achando que é outro. */
  sessao: { nome: string; papel: Papel };
}

export function Sidebar({ perguntasPendentes, sessao }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex w-full shrink-0 flex-col bg-navy py-3 text-white md:w-[236px] md:py-6">
      <div className="flex items-center gap-3 px-[22px] pb-3 md:border-b md:border-white/14 md:pb-[22px]">
        <LogoMM />
      </div>

      {/* Coluna a partir de `md` (o handoff). Abaixo disso vira uma linha que
          rola na horizontal: mantem o menu como mapa do sistema sem inventar um
          hamburguer — que exigiria estado e um painel que ninguem desenhou.
          `overflow-x-auto` rola so a nav, nunca o corpo da pagina. */}
      <nav
        aria-label="Telas do painel"
        className="flex flex-row gap-1 overflow-x-auto px-3 py-2 text-sm md:flex-col md:gap-0.5 md:py-4"
      >
        {ITENS.filter(
          (item) => item.exige === undefined || temPermissao(sessao.papel, item.exige, "ler"),
        ).map((item) => {
          const ativo = item.href !== null && pathname === item.href;

          const conteudo = (
            <>
              {/* Ponto âmbar de 6px marca a tela ativa (handoff). Decorativo:
                  quem usa leitor de tela recebe o estado por aria-current. */}
              {ativo && <span aria-hidden className="block size-1.5 rounded-full bg-warning" />}
              {item.rotulo}
              {item.rotulo === "Perguntas" && perguntasPendentes > 0 && (
                <span className="ml-auto rounded-pill bg-warning px-[7px] py-px text-[11px] font-semibold text-navy">
                  {perguntasPendentes}
                </span>
              )}
            </>
          );

          // `shrink-0` + `whitespace-nowrap`: na faixa horizontal os itens nao
          // podem encolher nem quebrar o rotulo em duas linhas — e o que faz a
          // rolagem lateral funcionar em vez de espremer 12 itens na largura da
          // tela. Na coluna do desktop nenhum dos dois tem efeito.
          const classe =
            "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-button px-3 py-2.5 text-on-navy";

          return item.href === null ? (
            <span
              key={item.rotulo}
              aria-disabled
              title="Tela ainda não portada do protótipo"
              className={`${classe} cursor-not-allowed opacity-45`}
            >
              {conteudo}
            </span>
          ) : (
            <Link
              key={item.rotulo}
              href={item.href}
              aria-current={ativo ? "page" : undefined}
              className={`${classe} hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning`}
            >
              {conteudo}
            </Link>
          );
        })}
      </nav>

      {/* Quem está logado. Fica acima dos canais porque, num sistema cuja regra
          central é sigilo de custo (RN-107), saber com qual papel se está
          operando não é enfeite: o operador e o dono veem telas diferentes. */}
      <div className="mt-auto flex flex-col gap-2 border-t border-white/14 px-[22px] pt-4 text-xs">
        <span className="truncate font-medium text-white">{sessao.nome}</span>
        <span className="text-[10px] uppercase tracking-[.14em] text-on-navy-2">
          {sessao.papel}
        </span>
        <form action={sair}>
          <button
            type="submit"
            className="rounded-button border border-white/20 px-3 py-1.5 text-xs text-on-navy hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          >
            Sair
          </button>
        </form>
      </div>

      {/* Rodapé de canais: os status são FIXOS por enquanto — não existe tabela
          de integrações nem conexão real com ML/OLX/WhatsApp (known-issues 🔴).
          Repetem o handoff para não deixar buraco no layout; ligar aos dados
          reais quando a tela Integrações entrar.

          Escondido abaixo de `md`: é o elemento de menor valor da sidebar (status
          decorativo, hoje nem real) e empilhado no topo empurraria a fila —
          a tarefa da tela — para baixo da dobra no celular. */}
      <div className="hidden flex-col gap-2.5 border-t border-white/14 px-[22px] pt-4 text-xs md:flex">
        <span className="text-[10px] uppercase tracking-[.22em] text-on-navy-2">
          Canais conectados
        </span>
        <Canal cor="bg-online" texto="Mercado Livre · ativo" />
        <Canal cor="bg-online" texto="OLX · ativo" />
        <Canal cor="bg-warning" texto="WhatsApp · vinculado" />
      </div>
    </aside>
  );
}

function Canal({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`block size-2 rounded-full ${cor}`} />
      {texto}
    </span>
  );
}

/** Logo do handoff: "MM" + as duas setas laranja + assinatura. */
function LogoMM() {
  return (
    <svg width="170" height="56" viewBox="0 0 340 110" role="img" aria-label="MM Soluções Empresariais">
      <text
        x="14"
        y="62"
        className="fill-white font-display"
        fontWeight="800"
        fontSize="52"
        letterSpacing="-2"
      >
        MM
      </text>
      <polygon points="126,18 146,18 166,62 156,62" className="fill-orange" />
      <polygon points="146,18 166,18 186,62 176,62" className="fill-orange" opacity=".55" />
      <text
        x="14"
        y="96"
        className="fill-on-navy-2 font-body"
        fontWeight="400"
        fontSize="15"
        letterSpacing="4.5"
      >
        SOLUÇÕES EMPRESARIAIS
      </text>
    </svg>
  );
}
