/**
 * Sessao: criar, ler e encerrar.
 *
 * DECISOES QUE VALE ENTENDER ANTES DE MEXER:
 *
 * - **O token nunca e gravado em claro.** O banco guarda o SHA-256; o valor real
 *   so existe no cookie do navegador. Um dump vazado nao vira sessao ativa.
 *   Hash simples (nao KDF) e o certo aqui: o token e aleatorio de 32 bytes, nao
 *   uma senha adivinhavel — nao ha o que forcar bruto.
 * - **A sessao le o usuario a cada requisicao.** Custa uma consulta e paga com
 *   revogacao imediata: desligar alguem (`ativo = false`) ou trocar a senha
 *   encerra o acesso ja, sem esperar token vencer.
 * - **`httpOnly` + `sameSite=lax`.** httpOnly tira o cookie do alcance de
 *   JavaScript, que e o que transforma um XSS em roubo de sessao. `lax` (e nao
 *   `strict`) para o link vindo de fora nao cair sempre no login.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { usuarios } from "@/lib/db/schema/usuarios";
import { usuariosSessoes } from "@/lib/db/schema/usuarios-sessoes";

export const COOKIE_SESSAO = "mm_sessao";

/** Duracao da sessao. 12h cobre um dia de trabalho sem virar acesso eterno. */
export const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000;

export type Papel = "administrador" | "operador" | "consultoria";

export interface Sessao {
  usuarioId: string;
  nome: string;
  email: string;
  papel: Papel;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Cria a sessao e devolve o token que vai para o cookie.
 *
 * `modified_by` e o proprio usuario: quem criou a sessao foi ele, ao entrar.
 */
export async function criarSessao(usuarioId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await db.insert(usuariosSessoes).values({
    user_id: usuarioId,
    token_hash: hashToken(token),
    expira_em: new Date(Date.now() + DURACAO_SESSAO_MS),
    modified_by: usuarioId,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_SESSAO_MS / 1000,
  });

  return token;
}

/**
 * A sessao atual, ou `null`.
 *
 * Confere, na MESMA consulta: sessao nao expirada, nao excluida, e usuario
 * ativo e nao excluido. Checar so o token deixaria o operador desligado
 * continuar entrando ate o token vencer.
 */
export async function lerSessao(): Promise<Sessao | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  const [linha] = await db
    .select({
      usuarioId: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      papel: usuarios.papel,
      sessaoId: usuariosSessoes.id,
    })
    .from(usuariosSessoes)
    .innerJoin(usuarios, eq(usuarios.id, usuariosSessoes.user_id))
    .where(
      and(
        eq(usuariosSessoes.token_hash, hashToken(token)),
        eq(usuariosSessoes.is_deleted, false),
        gt(usuariosSessoes.expira_em, new Date()),
        eq(usuarios.ativo, true),
        eq(usuarios.is_deleted, false),
      ),
    );

  if (!linha) return null;

  // Marca de uso. Falha aqui nao pode derrubar a requisicao: e telemetria, nao
  // autorizacao — quem ja passou pela consulta acima esta autenticado.
  void db
    .update(usuariosSessoes)
    .set({ ultimo_acesso_em: new Date() })
    .where(eq(usuariosSessoes.id, linha.sessaoId))
    .catch(() => {});

  return {
    usuarioId: linha.usuarioId,
    nome: linha.nome,
    email: linha.email,
    papel: linha.papel as Papel,
  };
}

/** Encerra a sessao atual (logout). */
export async function encerrarSessao(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_SESSAO)?.value;
  cookieStore.delete(COOKIE_SESSAO);
  if (!token) return;

  // Exclusao LOGICA — a regra da casa vale aqui tambem: quem entrou e quando
  // saiu e trilha de auditoria, nao lixo a apagar.
  await db
    .update(usuariosSessoes)
    .set({ is_deleted: true, deleted_at: new Date(), updated_at: new Date() })
    .where(eq(usuariosSessoes.token_hash, hashToken(token)));
}

/**
 * Encerra TODAS as sessoes de um usuario.
 *
 * Chamado ao trocar senha e ao desligar alguem: se a troca de senha nao
 * derrubasse as sessoes abertas, quem ja estava dentro continuaria dentro — que
 * e exatamente o cenario em que a senha e trocada.
 */
export async function encerrarSessoesDe(usuarioId: string, porQuem: string): Promise<number> {
  const linhas = await db
    .update(usuariosSessoes)
    .set({
      is_deleted: true,
      deleted_at: new Date(),
      updated_at: new Date(),
      modified_by: porQuem,
    })
    .where(and(eq(usuariosSessoes.user_id, usuarioId), eq(usuariosSessoes.is_deleted, false)))
    .returning({ id: usuariosSessoes.id });

  return linhas.length;
}

/** Remove sessoes vencidas ha mais de 30 dias. Higiene, nao seguranca. */
export async function limparSessoesVencidas(): Promise<void> {
  await db.execute(sql`
    UPDATE usuarios_sessoes
    SET is_deleted = true, deleted_at = now(), updated_at = now()
    WHERE is_deleted = false AND expira_em < now() - interval '30 days'
  `);
}
