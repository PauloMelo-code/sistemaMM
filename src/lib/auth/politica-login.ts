/**
 * Politica de login — constantes e tipos, fora do arquivo de server action.
 *
 * Separado porque um arquivo com `"use server"` **so pode exportar funcao
 * assincrona**: exportar uma constante dali quebra a compilacao com
 * "Only async functions are allowed to be exported in a 'use server' file".
 * Aqui tambem fica testavel sem puxar banco junto.
 */

/** Falhas seguidas antes de bloquear o login. */
export const MAX_TENTATIVAS_LOGIN = 5;

/** Quanto tempo o bloqueio dura. */
export const BLOQUEIO_MINUTOS = 15;

/**
 * A MESMA mensagem para e-mail inexistente, senha errada e usuario sem senha.
 *
 * Distinguir transformaria o login em enumerador de usuarios: "este e-mail
 * existe" e informacao valiosa para quem ataca. Nao "melhore" a experiencia
 * dizendo qual dos dois falhou.
 */
export const MENSAGEM_GENERICA = "E-mail ou senha inválidos.";

export interface ResultadoLogin {
  erro: string;
}

/** Ainda esta dentro da janela de bloqueio? */
export function estaBloqueado(bloqueadoAte: Date | null, agora: Date = new Date()): boolean {
  return bloqueadoAte !== null && bloqueadoAte > agora;
}

/**
 * A proxima falha bloqueia? Devolve ate quando, ou `null` se ainda ha folga.
 *
 * Recebe o contador JA incrementado — por isso `>=` e nao `>`: com teto 5, a
 * quinta falha bloqueia.
 */
export function bloqueioApos(
  tentativas: number,
  agora: Date = new Date(),
): Date | null {
  return tentativas >= MAX_TENTATIVAS_LOGIN
    ? new Date(agora.getTime() + BLOQUEIO_MINUTOS * 60_000)
    : null;
}
