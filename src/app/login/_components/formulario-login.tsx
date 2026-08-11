"use client";

/**
 * Formulario de login.
 *
 * Client component pelo motivo legitimo: `useActionState` para mostrar o erro e
 * desabilitar o botao durante o envio — sem isso, um duplo clique dispara duas
 * tentativas e queima duas do orcamento de bloqueio.
 *
 * O CAMPO DE SENHA NUNCA VAI PARA ESTADO DO REACT. Fica no `<form>` e viaja no
 * FormData direto para a server action: senha em `useState` acaba em DevTools,
 * em replay de sessao e em relatorio de erro.
 */
import { useActionState } from "react";

import { entrar } from "@/lib/actions/auth";

export function FormularioLogin() {
  const [estado, acao, enviando] = useActionState(entrar, { erro: "" });

  return (
    <form action={acao} className="flex flex-col gap-4">
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

      {estado.erro ? (
        // `role="alert"` para leitor de tela anunciar sem precisar navegar ate
        // aqui: quem erra a senha nao esta com o foco neste paragrafo.
        <p role="alert" className="rounded-button bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {estado.erro}
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
