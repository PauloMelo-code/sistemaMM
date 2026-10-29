"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { sair } from "@/lib/actions/auth";
import { temPermissao, type Recurso } from "@/lib/auth/rbac";
import type { EstadoConexao } from "@/lib/actions/integracoes";
import type { Papel } from "@/lib/auth/sessao";
import type { Canal } from "@/lib/pricing";

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
  /**
   * "Calculadora", nao "Calculadora de preço" — o titulo da TELA continua
   * inteiro; o do MENU nao cabe. Com icone + padding sobram ~124px para texto
   * na sidebar de 200px, e o rotulo completo pede ~140px: vazava para fora da
   * faixa navy, porque `whitespace-nowrap` (que a faixa horizontal do mobile
   * exige) impede a quebra. Menu mais curto que titulo de tela e o normal.
   *
   * Restrita a quem ve custo, como /lotes — ver calculadora/page.tsx.
   *
   * ⚠️ DESLIGADA (`href: null`) ate a tela ser corrigida: o "lance maximo" dela
   * so devolvia o custo digitado (ver known-issues). Ao religar:
   * `href: "/calculadora", exige: "itens_custo"`.
   */
  { rotulo: "Calculadora", href: null },
  { rotulo: "Relatórios", href: null },
  { rotulo: "Equipe", href: null },
  { rotulo: "Integrações", href: "/integracoes" },
];

/**
 * Icone de cada tela — SVG inline, sem biblioteca.
 *
 * Nao ha pacote de icones instalado e o CLAUDE.md proibe adicionar dependencia
 * sem autorizacao. Sao 12 tracados simples; um pacote inteiro para isso seria
 * peso sem contrapartida. Mesmo padrao do `LogoMM` logo abaixo.
 *
 * ⚠️ O ROTULO FICA. O Figma de referencia usa rail so de icones, e aqui isso
 * seria regressao: sao 12 telas e varias nao tem icone distinto — Estoque,
 * Lotes e Pedidos viram todas uma caixa. O escopo contratado inclui cinco
 * semanas treinando um operador; menu sem texto e caro exatamente nesse caso.
 * O icone entra como ANCORA VISUAL, para achar a linha mais rapido, nao como
 * substituto do nome.
 */
const ICONES: Record<string, string> = {
  // dashboard: quatro blocos
  "Visão geral": "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  // etiqueta de preco
  "Anúncios": "M3 12V4h8l9 9-8 8-9-9zM7.5 7.5h.01",
  // globo
  "Site": "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18",
  // balao de conversa
  "Perguntas": "M21 12a8 8 0 01-8 8H7l-4 3v-6.5A8 8 0 0111 4h2a8 8 0 018 8z",
  // recibo
  "Pedidos": "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6",
  // caminhao
  "Expedição": "M3 7h10v9H3zM13 10h4l3 3v3h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  // caixa aberta
  "Estoque": "M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8",
  // camadas empilhadas (lote = conjunto de itens)
  "Lotes": "M12 3l9 4.5-9 4.5-9-4.5zM3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5",
  // calculadora
  Calculadora: "M5 3h14v18H5zM9 7h6M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h4",
  // barras
  "Relatórios": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  // duas pessoas
  "Equipe": "M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 10a4 4 0 100-8 4 4 0 000 8M22 20v-2a4 4 0 00-3-3.9M16 2.1a4 4 0 010 7.8",
  // tomada / conexao
  "Integrações": "M9 3v6M15 3v6M6 9h12v3a6 6 0 01-6 6 6 6 0 01-6-6zM12 18v3",
};

function Icone({ rotulo }: { rotulo: string }) {
  const d = ICONES[rotulo];
  if (!d) return null;
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[18px] shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Como cada estado de conexao aparece.
 *
 * ⚠️ `nao_configurado` e CINZA, nunca verde nem vermelho. Verde mentiria;
 * vermelho gritaria incidente onde ha apenas setup pendente — e o Anderson
 * aprenderia a ignorar a cor, que e o pior resultado possivel para um alerta.
 * Ambar e vermelho ficam para o que EXIGE acao: token vencendo e token vencido.
 */
const VISUAL_CONEXAO: Record<EstadoConexao, { cor: string; rotulo: string }> = {
  conectado: { cor: "bg-online", rotulo: "ativo" },
  vencendo: { cor: "bg-warning", rotulo: "token vencendo" },
  vencido: { cor: "bg-danger", rotulo: "reautorizar" },
  nao_configurado: { cor: "bg-on-navy-2/40", rotulo: "não conectado" },
};

const NOME_CANAL: Record<Canal, string> = {
  mercado_livre: "Mercado Livre",
  olx: "OLX",
  whatsapp: "WhatsApp",
};

interface SidebarProps {
  /** Perguntas pendentes — o badge âmbar. Contado no servidor. */
  perguntasPendentes: number;
  /** Quem está logado. Mostrar o papel evita operar achando que é outro. */
  sessao: { nome: string; papel: Papel };
  /** Estado REAL de cada canal, da mesma fonte que a tela Integrações. */
  conexoes: { canal: Canal; estado: EstadoConexao }[];
}

export function Sidebar({ perguntasPendentes, sessao, conexoes }: SidebarProps) {
  const pathname = usePathname();

  return (
    /**
     * 236px -> 200px na casca de 2026-08-11: o icone carrega parte do
     * reconhecimento, entao o rotulo precisa de menos largura. Sobra vai para o
     * conteudo, que e onde o trabalho acontece.
     *
     * ⚠️ `sticky top-0 h-screen` a partir de `md` — e nao e enfeite.
     * Antes a sidebar tinha a altura do CONTEUDO: com `mt-auto` no bloco do
     * usuario, "Sair" e "Canais conectados" iam parar no fim da PAGINA, nao da
     * tela. Em /estoque (13 linhas) desciam para fora da vista; em /anuncios
     * (5 linhas) subiam. O mesmo elemento em lugar diferente a cada tela, e
     * rolando junto com a tabela.
     *
     * `h-screen` prende a altura na viewport e `sticky` a mantem no lugar
     * enquanto o conteudo rola. `overflow-y-auto` e a rede de seguranca: em
     * tela baixa (ou com zoom alto) 12 itens + usuario + canais passam de
     * 100vh, e sem ele o "Sair" ficaria inalcancavel.
     *
     * Abaixo de `md` nada disso vale: la a sidebar e uma faixa no topo que
     * rola com a pagina, que e o certo para o estreito.
     */
    <aside className="flex w-full shrink-0 flex-col bg-navy py-3 text-white md:sticky md:top-0 md:h-screen md:w-[200px] md:overflow-y-auto md:py-6">
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
              <Icone rotulo={item.rotulo} />
              {/* Ponto âmbar de 6px marca a tela ativa (handoff). Decorativo:
                  quem usa leitor de tela recebe o estado por aria-current.
                  Continua sendo âmbar e continua sendo o marcador de "você está
                  aqui" — a pill de fundo abaixo reforça, não substitui. */}
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
          // `transition-[color,background-color]` e NAO `transition-colors`:
          // aquela inclui `outline-color`, e o anel de foco entao nascia na cor
          // do texto e migrava para ambar ao longo de 150ms. Medido: logo apos
          // o Tab o outline saia rgb(199,210,221); so depois virava
          // rgb(232,163,61). Indicador de foco tem de ser instantaneo — quem
          // tabula rapido nunca ve a cor final.
          const classe = `flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-button px-3 py-2 transicao-cor ${
            ativo ? "bg-white/12 font-medium text-white" : "text-on-navy"
          }`;

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
              className={`${classe} hover:bg-white/8 foco-alerta`}
            >
              {conteudo}
            </Link>
          );
        })}
      </nav>

      {/* Quem está logado. Fica acima dos canais porque, num sistema cuja regra
          central é sigilo de custo (RN-107), saber com qual papel se está
          operando não é enfeite: o operador e o dono veem telas diferentes. */}
      {/**
        * Rodape do usuario.
        *
        * Era quatro blocos empilhados com o MESMO gap e duas bordas coladas —
        * nome, cargo, botao e canais tinham todos o mesmo peso, entao nada
        * parecia agrupado. Agora: avatar + (nome / cargo) numa linha so, com o
        * Sair recuado a direita, e respiro de verdade antes dos canais.
        *
        * O avatar e de INICIAIS, nao de foto: nao ha upload de avatar no
        * sistema e um placeholder generico seria ruido. Iniciais identificam
        * com quem se esta operando, que e o ponto (RN-107: o operador e o dono
        * veem telas diferentes).
        */}
      <div className="mt-auto flex items-center gap-2.5 border-t border-white/12 px-4 pt-4">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-white/12 font-display text-[12px] font-bold text-white"
        >
          {iniciais(sessao.nome)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium leading-tight text-white">
            {sessao.nome}
          </span>
          {/* `tracking-[.08em]` e nao o .14em do label padrao: medido, o
              tracking largo fazia "administrador" pedir 95px numa coluna de
              80px e o cargo saia "ADMINISTRA…". Cargo cortado nao e cosmetico —
              e a regra de sigilo de custo (RN-107) que depende de saber com
              qual papel se esta operando. */}
          <span className="truncate text-[10px] uppercase leading-tight tracking-[.08em] text-on-navy-2">
            {sessao.papel}
          </span>
        </span>
        <form action={sair} className="ml-auto shrink-0">
          {/* Icone COM `aria-label` e `title`: aqui o icone-sozinho se justifica
              (uma acao so, simbolo consagrado, e o rotulo chega a leitor de tela
              e ao hover) — diferente do menu, onde 12 icones parecidos
              disputariam significado. */}
          <button
            type="submit"
            aria-label="Sair"
            title="Sair"
            className="grid size-7 shrink-0 place-items-center rounded-button text-on-navy-2 transicao-cor hover:bg-white/10 hover:text-white foco-alerta"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[17px]"
            >
              <path d="M15 17l5-5-5-5M20 12H9M12 21H6a2 2 0 01-2-2V5a2 2 0 012-2h6" />
            </svg>
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
      {/* `mt-4` + borda mais fraca: antes este bloco encostava no do usuario e
          os dois liam como um amontoado so. O respiro e o que separa "quem sou
          eu" de "o que esta ligado". */}
      {/**
        * ✅ CORRIGIDO em 2026-08-11. Estes tres status eram STRINGS CRAVADAS —
        * "Mercado Livre · ativo" e "OLX · ativo" em verde, em TODA tela, com
        * zero credencial no banco. O painel afirmava o contrario da verdade
        * bem ao lado de /integracoes, que dizia "nao autorizado", e era a tela
        * que o Anderson olha o dia inteiro.
        *
        * Agora vem de `lerEstadoIntegracoes()` — a MESMA fonte da tela
        * Integracoes. Duas leituras do mesmo dado divergem com o tempo; uma so
        * nao tem como.
        */}
      <div className="mt-4 hidden flex-col gap-2 border-t border-white/10 px-4 pt-4 text-xs md:flex">
        <span className="text-[10px] uppercase tracking-[.2em] text-on-navy-2/70">
          Canais
        </span>
        {conexoes.map((c) => {
          const v = VISUAL_CONEXAO[c.estado];
          return <Canal key={c.canal} cor={v.cor} texto={`${NOME_CANAL[c.canal]} · ${v.rotulo}`} />;
        })}
      </div>
    </aside>
  );
}

function Canal({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="flex items-center gap-2 text-[11px] text-on-navy-2">
      <span aria-hidden className={`block size-1.5 shrink-0 rounded-full ${cor}`} />
      <span className="truncate">{texto}</span>
    </span>
  );
}

/**
 * Iniciais para o avatar: primeira letra do primeiro e do ultimo nome.
 *
 * Um nome so devolve uma letra — melhor que inventar a segunda. Nome vazio nao
 * acontece (a coluna e NOT NULL), mas o `|| "?"` evita um circulo vazio se
 * algum dia acontecer.
 */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
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
