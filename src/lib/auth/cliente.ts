"use client";

/**
 * Cliente do Better Auth — usado SO pelo formulario de login.
 *
 * POR QUE O LOGIN NAO E SERVER ACTION (era, e a troca foi deliberada):
 *
 * O limite de tentativas do Better Auth roda em `onRequest` do ROUTER dele
 * (`node_modules/better-auth/dist/api/index.mjs:168`). Chamar
 * `auth.api.signInEmail()` de dentro de uma server action nao passa pelo
 * router — **o rate limit simplesmente nao se aplica**. Como o contador em
 * banco do login antigo (`usuarios.tentativas_falhas`) saiu junto com a troca,
 * uma server action deixaria o login sem NENHUMA protecao contra forca bruta.
 *
 * Passando pelo cliente, a requisicao vai para `/api/auth/sign-in/email`, entra
 * pelo router e o limite de 5 por 15 minutos vale (ver `config.ts`).
 *
 * ⚠️ Nao troque este caminho por server action sem antes resolver o limite de
 * tentativas de outra forma.
 *
 * `baseURL` fica ausente de proposito: sem ele o cliente usa a origem atual, o
 * que funciona igual em local, HML e PRD sem variavel de ambiente para
 * esquecer de configurar.
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
