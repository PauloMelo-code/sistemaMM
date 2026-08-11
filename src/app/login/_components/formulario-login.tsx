"use client";

/**
 * Formulario de login.
 *
 * O CAMPO DE SENHA NUNCA VAI PARA ESTADO DO REACT. Ele e lido do FormData no
 * momento do envio e some em seguida: senha em `useState` acaba em DevTools, em
 * replay de sessao e em relatorio de erro.
 *
 * O envio vai pelo `authClient` e nao por server action — o motivo esta escrito
 * em `src/lib/auth/cliente.ts` e e sobre limite de tentativas, nao sobre gosto.
 *
 * MENSAGEM DE ERRO UNICA, e isto e regra: e-mail inexistente, senha errada e
 * usuario desligado devolvem exatamente o mesmo texto. Distinguir transformaria
 * o login em enumerador de usuarios — "este e-mail existe" e informacao para
 * quem ataca. A UNICA excecao e o bloqueio por tentativas: quem chegou la ja
 * provou conhecer o e-mail, e a pessoa legitima precisa saber por que nao entra.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth/cliente";

const MENSAGEM_GENERICA = "E-mail ou senha invalidos.";
const MENSAGEM_BLOQUEIO = "Muitas tentativas. Tente de novo em alguns minutos.";

export function FormularioLogin() {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return; // duplo clique queima duas do orcamento de tentativas

    const dados = new FormData(evento.currentTarget);
    const email = String(dados.get("email") ?? "").trim().toLowerCase();
    const senha = String(dados.get("senha") ?? "");

    if (!email || !senha) {
      setErro(MENSAGEM_GENERICA);
      return;
    }

    setEnviando(true);
    setErro("");

    const { error } = await authClient.signIn.email({ email, password: senha });

    if (error) {
      // 429 e o unico caso em que o texto muda — ver o cabecalho.
      setErro(error.status === 429 ? MENSAGEM_BLOQUEIO : MENSAGEM_GENERICA);
      setEnviando(false);
      return;
    }

    // `refresh()` antes de navegar: o layout de (painel) e server component e
    // le a sessao no servidor. Sem invalidar o cache do roteador, a primeira
    // renderizacao pode vir da versao anterior — deslogada — e devolver a
    // pessoa para ca num laco.
    router.refresh();
    router.replace("/");
  }

  return (
    <form onSubmit={aoEnviar} className="flex flex-col gap-4">
      <h1 className="font-display text-[18px] font-bold text-navy">Entrar</h1>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs uppercase tracking-[.12em] text-ink-2">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          className="rounded-button border border-border-input px-3 py-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="senha" className="text-xs uppercase tracking-[.12em] text-ink-2">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-button border border-border-input px-3 py-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
        />
      </div>

      {erro ? (
        // `role="alert"` para leitor de tela anunciar sem precisar navegar ate
        // aqui: quem erra a senha nao esta com o foco neste paragrafo.
        <p role="alert" className="rounded-button bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {erro}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-button bg-navy px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
