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
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth/cliente";

const MENSAGEM_GENERICA = "E-mail ou senha invalidos.";
const MENSAGEM_BLOQUEIO = "Muitas tentativas. Tente de novo em alguns minutos.";

/**
 * Para onde ir depois de entrar: o `?destino=` que o porteiro guardou, ou a
 * raiz.
 *
 * ⚠️ SO CAMINHO RELATIVO. Aceitar a URL inteira aqui seria redirecionamento
 * aberto: um link para `/login?destino=https://site-falso` levaria a pessoa
 * para o golpe DEPOIS de ela ter digitado a senha com o nosso dominio na barra
 * — a hora em que ela mais confia na tela. O `//` tambem e recusado, porque
 * `//outro-site` e URL absoluta para o navegador.
 */
function destinoSeguro(): string {
  const bruto = new URLSearchParams(window.location.search).get("destino");
  if (!bruto || !bruto.startsWith("/") || bruto.startsWith("//")) return "/";
  return bruto;
}

export function FormularioLogin() {
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

    try {
      const { error } = await authClient.signIn.email({ email, password: senha });

      if (error) {
        // 429 e o unico caso em que o texto muda — ver o cabecalho.
        setErro(error.status === 429 ? MENSAGEM_BLOQUEIO : MENSAGEM_GENERICA);
        setEnviando(false);
        return;
      }
    } catch {
      /**
       * ⚠️ ESTE `catch` NAO E DEFENSIVA GENERICA — sem ele o botao TRAVA.
       *
       * Se a chamada REJEITA (rede caiu, origem recusada, resposta que o
       * cliente nao consegue interpretar) em vez de resolver com `{ error }`,
       * a excecao escapa do handler e `setEnviando(false)` nunca roda. A tela
       * fica em "Entrando…" para sempre, sem mensagem — o usuario nao tem como
       * saber se esta lento ou quebrado, e nem tentar de novo.
       */
      setErro("Nao foi possivel falar com o servidor. Tente de novo.");
      setEnviando(false);
      return;
    }

    /**
     * NAVEGACAO DURA, e nao `router.replace()`.
     *
     * O layout de (painel) e server component e le a sessao no servidor. Com a
     * navegacao do roteador do Next, a transicao depende do cache do cliente e
     * de um `refresh()` que precisa chegar antes — se a ordem escorregar, a
     * pessoa volta para o login e o botao fica preso em "Entrando…", que e
     * exatamente o sintoma relatado em producao.
     *
     * Recarregar a pagina inteira garante que o servidor veja o cookie novo e
     * renderize tudo do zero. Acontece UMA vez por login: o custo e irrelevante
     * perto de uma tela que nao avanca.
     */
    window.location.assign(destinoSeguro());
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
