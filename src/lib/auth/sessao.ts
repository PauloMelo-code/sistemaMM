/**
 * Sessao — fachada fina sobre o Better Auth.
 *
 * ESTE ARQUIVO EXISTE PARA QUE O RESTO DO PAINEL NAO CONHECA O BETTER AUTH.
 * As 7 telas e as 5 actions importam `lerSessao` e o tipo `Papel` daqui; se um
 * dia a biblioteca mudar (ou sair), muda este arquivo e mais nenhum. Foi o que
 * permitiu trocar o login proprio pelo Better Auth sem tocar em nenhuma tela.
 *
 * DUAS COISAS QUE A BIBLIOTECA **NAO** FAZ, E POR ISSO ESTAO AQUI:
 *
 * 1. **Ela nao sabe da RN-107.** `getSession` devolve a sessao de qualquer
 *    usuario com cookie valido. Quem confere `ativo` e `is_deleted` — ou seja,
 *    quem faz o desligamento valer na requisicao seguinte — e o codigo abaixo.
 *    Tirar essa checagem devolve acesso a quem foi desligado.
 *
 * 2. **Ela nao valida o papel.** `papel` chega como string do banco; o `as
 *    Papel` seria uma promessa vazia se a coluna tivesse lixo. A conferencia
 *    explicita transforma dado inesperado em "sem sessao", nunca em
 *    "administrador por acidente".
 */
import { headers } from "next/headers";

import { auth } from "./config";

/**
 * Nome do cookie de sessao. Vem de `advanced.cookiePrefix: "mm"` no config —
 * o Better Auth monta `<prefixo>.session_token`.
 *
 * ⚠️ Usado pelo porteiro (`src/proxy.ts`). Mudar o prefixo no config sem mudar
 * aqui faz o porteiro parar de ver a sessao e mandar todo mundo para /login.
 */
export const COOKIE_SESSAO = "mm.session_token";

export type Papel = "administrador" | "operador" | "consultoria";

const PAPEIS: readonly Papel[] = ["administrador", "operador", "consultoria"];

const ehPapel = (valor: unknown): valor is Papel =>
  typeof valor === "string" && (PAPEIS as readonly string[]).includes(valor);

export interface Sessao {
  usuarioId: string;
  nome: string;
  email: string;
  papel: Papel;
}

/**
 * A sessao atual, ou `null`.
 *
 * Devolve `null` — e nunca lanca — para qualquer entrada ruim: sem cookie,
 * cookie forjado, sessao vencida, usuario desligado, usuario excluido ou papel
 * irreconhecivel. Quem chama trata um caso so.
 */
export async function lerSessao(): Promise<Sessao | null> {
  const sessao = await auth.api.getSession({ headers: await headers() });
  if (!sessao?.user) return null;

  const usuario = sessao.user;

  // Desligado ou excluido nao entra, mesmo com cookie perfeitamente valido.
  // E por isto que a sessao e tabela e nao JWT: o efeito e ja, nao quando o
  // token vencer.
  if (usuario.ativo !== true) return null;
  if (usuario.is_deleted === true) return null;

  if (!ehPapel(usuario.papel)) return null;

  return {
    usuarioId: usuario.id,
    nome: usuario.name,
    email: usuario.email,
    papel: usuario.papel,
  };
}

/** Encerra a sessao atual (logout). */
export async function encerrarSessao(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
}
