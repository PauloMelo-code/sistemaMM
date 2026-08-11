/**
 * Rotas do Better Auth — `/api/auth/*`.
 *
 * Um handler so atende toda a superficie da biblioteca (`/sign-in/email`,
 * `/sign-out`, `/get-session`, ...). Nao acrescente rota irma aqui dentro: o
 * `[...all]` engole tudo abaixo de `/api/auth`.
 *
 * ⚠️ ESTA ROTA E PUBLICA POR NECESSIDADE — e a porta do login. O que a protege
 * e o `rateLimit` do config (5 tentativas por 15 min em `/sign-in/email`) e o
 * fato de `papel` e `ativo` terem `input: false`, entao ninguem se promove
 * mandando JSON. O porteiro (`src/proxy.ts`) precisa deixar `/api/auth` passar,
 * senao o login redireciona para o login.
 */
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/config";

export const { GET, POST } = toNextJsHandler(auth);
