/**
 * Porteiro das rotas do painel (convencao `proxy` do Next 16).
 *
 * Migrado de `middleware.ts` em 2026-08-11: o Next depreciou aquele nome. Nao
 * volte a chamar de middleware — o build avisa, e quando a convencao antiga for
 * removida o arquivo simplesmente deixa de ser carregado, sem erro nenhum.
 *
 * ⚠️ O QUE ESTE ARQUIVO **NAO** E: autorizacao. Ele so confere se existe cookie
 * de sessao, e cookie pode ser forjado — o middleware do Next roda no edge e nao
 * tem acesso ao banco. Quem valida de verdade e `lerSessao()` no servidor, que
 * confere o hash do token, a expiracao e se o usuario continua ativo.
 *
 * Isto aqui e conveniencia: manda para o login quem obviamente nao esta logado,
 * em vez de renderizar uma tela que vai falhar. **Nunca** troque uma checagem de
 * `lerSessao()` por "o middleware ja garantiu" — nao garantiu.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Nome do cookie do Better Auth: `<advanced.cookiePrefix>.session_token`, com o
 * prefixo `mm` definido em `src/lib/auth/config.ts`.
 *
 * ⚠️ SAO DOIS NOMES, E IGNORAR O SEGUNDO QUEBRA O LOGIN EM PRODUCAO.
 *
 * Sobre HTTPS (ou com `BETTER_AUTH_URL` em `https://`), o Better Auth prefixa o
 * cookie com `__Secure-` — ver `better-auth/dist/cookies/index.mjs:21`. Ou seja:
 * em producao o cookie NAO se chama `mm.session_token`, e sim
 * `__Secure-mm.session_token`.
 *
 * Custou um deploy inteiro: o login funcionava (sessao gravada no banco, cookie
 * no navegador), mas o porteiro procurava so o nome sem prefixo, nao achava, e
 * mandava para /login — a aplicacao recusando a sessao que ela mesma acabara de
 * criar. Passou em todos os testes locais porque `http://localhost` nao ganha
 * prefixo: o defeito so existe onde ha TLS, que e exatamente onde ninguem
 * testa antes de subir.
 *
 * O proprio Better Auth le os dois (`index.mjs:216`, `__Secure-<nome>` primeiro,
 * depois o cru). Aqui e a mesma regra.
 *
 * ⚠️ Nao da para importar de `@/lib/auth/sessao`: aquele modulo puxa a
 * configuracao inteira, que puxa o driver do banco — e este arquivo roda no
 * edge. As constantes sao duplicadas de proposito; mudou o prefixo la, mude aqui.
 */
const COOKIE_SESSAO = "mm.session_token";
const COOKIE_SESSAO_SEGURO = `__Secure-${COOKIE_SESSAO}`;

/** Rotas que existem sem sessao. */
const PUBLICAS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const temCookie = Boolean(
    request.cookies.get(COOKIE_SESSAO_SEGURO)?.value ?? request.cookies.get(COOKIE_SESSAO)?.value,
  );
  const ehPublica = PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  if (!temCookie && !ehPublica) {
    const url = new URL("/login", request.url);
    // Guarda para onde a pessoa queria ir. So o caminho relativo — aceitar URL
    // completa aqui seria redirecionamento aberto: um link para
    // /login?destino=https://site-falso viraria phishing com o nosso dominio.
    url.searchParams.set("destino", pathname);
    return NextResponse.redirect(url);
  }

  if (temCookie && ehPublica) {
    // Para a raiz, que e a Visao geral. Ia para /perguntas de quando `/` ainda
    // era o placeholder de docs.
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Fora do porteiro:
   * - `/api/auth/*` — as rotas do Better Auth. OBRIGATORIO: e por elas que o
   *   login acontece, e quem esta fazendo login ainda nao tem cookie. Sem esta
   *   excecao o `POST /api/auth/sign-in/email` seria redirecionado para
   *   /login — o login mandando para o login, em laco.
   * - `/api/saude` — healthcheck. OBRIGATORIO, e ja mordeu: sem a excecao a
   *   rota responde 307 para /login, o Docker le isso como container doente e
   *   o orquestrador reinicia a aplicacao em laco, PARA SEMPRE — uma app
   *   perfeitamente saudavel derrubada pelo proprio porteiro. Descoberto ao
   *   subir o bundle standalone, nao revisando codigo.
   * - `/api/integracoes/*` — chamadas de MAQUINA (webhook, worker, OAuth de
   *   canal). Tem porteiro proprio por segredo; exigir cookie aqui quebraria o
   *   webhook do ML, que obviamente nao tem sessao.
   * - estaticos e imagem — nao ha o que proteger e custa latencia em toda carga.
   * - `/robots.txt` — precisa ser legivel por rastreador, que obviamente nao
   *   tem cookie. Dentro do porteiro ele responderia 307 para /login, e
   *   rastreador que nao consegue ler robots.txt costuma assumir que pode
   *   rastrear tudo — o oposto do que o arquivo pede.
   */
  matcher: [
    "/((?!api/auth|api/saude|api/integracoes|_next/static|_next/image|favicon.ico|icon.png|robots.txt).*)",
  ],
};
