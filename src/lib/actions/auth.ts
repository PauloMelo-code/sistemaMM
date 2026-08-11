"use server";

/**
 * Login e logout.
 *
 * TRES DECISOES DE SEGURANCA QUE NAO SAO NEGOCIAVEIS AQUI:
 *
 * 1. **Mensagem unica.** Email inexistente, senha errada e usuario sem senha
 *    devolvem exatamente o mesmo texto. Distinguir transformaria o login em
 *    enumerador de usuarios: "este email existe" e informacao para quem ataca.
 * 2. **Trabalho constante.** Mesmo sem achar o usuario, gastamos o mesmo tempo
 *    conferindo um hash falso. Sem isso, a diferenca de tempo entrega quais
 *    emails existem, e a mensagem unica vira teatro.
 * 3. **Bloqueio por tentativas**, contado no banco (nao em memoria): contador em
 *    memoria zera a cada deploy e nao existe entre instancias — some justamente
 *    quando ha mais de um alvo para tentar.
 */
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { usuarios } from "@/lib/db/schema/usuarios";

import {
  BLOQUEIO_MINUTOS,
  MENSAGEM_GENERICA,
  bloqueioApos,
  estaBloqueado,
  type ResultadoLogin,
} from "../auth/politica-login";
import { conferirSenha, gerarHash } from "../auth/senha";
import { criarSessao, encerrarSessao } from "../auth/sessao";

/**
 * Hash descartavel para gastar o mesmo tempo quando o usuario nao existe.
 * Calculado uma vez por processo — o custo que importa e o da CONFERENCIA.
 */
let hashFalso: Promise<string> | null = null;
function hashParaComparacaoFalsa(): Promise<string> {
  hashFalso ??= gerarHash(`inexistente-${Math.random()}`);
  return hashFalso;
}

export async function entrar(_anterior: unknown, formData: FormData): Promise<ResultadoLogin> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");

  if (!email || !senha) return { erro: MENSAGEM_GENERICA };

  const [usuario] = await db
    .select({
      id: usuarios.id,
      senhaHash: usuarios.senha_hash,
      bloqueadoAte: usuarios.bloqueado_ate,
      tentativas: usuarios.tentativas_falhas,
    })
    .from(usuarios)
    .where(
      and(
        sql`lower(${usuarios.email}) = ${email}`,
        eq(usuarios.ativo, true),
        eq(usuarios.is_deleted, false),
      ),
    );

  if (estaBloqueado(usuario?.bloqueadoAte ?? null)) {
    // Aqui a mensagem DIFERE de proposito: quem chegou ao bloqueio ja provou
    // conhecer o email, entao nao ha o que proteger — e a pessoa legitima
    // precisa saber por que nao entra.
    return {
      erro: `Muitas tentativas. Tente de novo em ${BLOQUEIO_MINUTOS} minutos.`,
    };
  }

  // Sem usuario ou sem senha definida: confere contra um hash falso para o
  // tempo de resposta nao denunciar a diferenca.
  const hash = usuario?.senhaHash ?? (await hashParaComparacaoFalsa());
  const ok = await conferirSenha(senha, hash);

  if (!ok || !usuario?.senhaHash) {
    if (usuario) {
      const tentativas = usuario.tentativas + 1;
      await db
        .update(usuarios)
        .set({
          tentativas_falhas: tentativas,
          bloqueado_ate: bloqueioApos(tentativas),
          updated_at: new Date(),
        })
        .where(eq(usuarios.id, usuario.id));
    }
    return { erro: MENSAGEM_GENERICA };
  }

  await db
    .update(usuarios)
    .set({ tentativas_falhas: 0, bloqueado_ate: null, updated_at: new Date() })
    .where(eq(usuarios.id, usuario.id));

  await criarSessao(usuario.id);
  redirect("/perguntas");
}

export async function sair(): Promise<void> {
  await encerrarSessao();
  redirect("/login");
}
