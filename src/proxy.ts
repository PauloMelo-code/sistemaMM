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

const COOKIE_SESSAO = "mm_sessao";

/** Rotas que existem sem sessao. */
const PUBLICAS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const temCookie = Boolean(request.cookies.get(COOKIE_SESSAO)?.value);
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
    return NextResponse.redirect(new URL("/perguntas", request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Fora do porteiro:
   * - `/api/integracoes/*` — chamadas de MAQUINA (webhook, worker, OAuth de
   *   canal). Tem porteiro proprio por segredo; exigir cookie aqui quebraria o
   *   webhook do ML, que obviamente nao tem sessao.
   * - estaticos e imagem — nao ha o que proteger e custa latencia em toda carga.
   */
  matcher: ["/((?!api/integracoes|_next/static|_next/image|favicon.ico|icon.png).*)"],
};
