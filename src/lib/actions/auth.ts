"use server";

/**
 * Logout.
 *
 * O LOGIN NAO MORA MAIS AQUI. Ele saiu para o cliente
 * (`src/app/login/_components/formulario-login.tsx`) porque o limite de
 * tentativas do Better Auth so vale para requisicao que passa pelo router dele
 * — server action passa por fora, e o login ficaria sem protecao contra forca
 * bruta. O porque completo esta em `src/lib/auth/cliente.ts`.
 *
 * O logout continua server action porque nao tem esse problema: nao ha nada
 * para forcar bruto em encerrar a propria sessao, e assim o botao da sidebar
 * segue funcionando como `<form action={sair}>`, sem JavaScript.
 */
import { redirect } from "next/navigation";

import { encerrarSessao } from "../auth/sessao";

export async function sair(): Promise<void> {
  await encerrarSessao();
  redirect("/login");
}
