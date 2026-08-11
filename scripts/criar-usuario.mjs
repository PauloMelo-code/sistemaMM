#!/usr/bin/env node
/**
 * Cria um usuario do painel, ou troca a senha de um que ja existe.
 * RODE VOCE, no seu terminal.
 *
 *   node scripts/criar-usuario.mjs anderson@mmsolucoes.com.br "Anderson" administrador
 *   node scripts/criar-usuario.mjs anderson@mmsolucoes.com.br        # so troca a senha
 *
 * SUBSTITUI o antigo `definir-senha.mjs`, que so fazia UPDATE. Aquele assumia
 * que a linha do usuario ja existia — e em banco novo ela NAO existe: a unica
 * linha semeada e o robo das integracoes, com `ativo = false` de proposito.
 * Resultado: PRD migrado e painel trancado para todo mundo. Este script e a
 * correcao disso, e e o UNICO caminho de cadastro — `disableSignUp: true` no
 * config fecha a rota publica de registro.
 *
 * A senha e pedida de forma OCULTA e nunca vira argumento de linha de comando:
 * argumento fica no `history`, no `ps` e no log do terminal.
 *
 * Nao passe senha real em chat, ticket ou mensagem — nem para uma IA. Este
 * script existe justamente para a senha nao precisar sair da sua maquina.
 *
 * FALA COM O `pg` DIRETO, e nao com o client Drizzle da aplicacao: aquele usa o
 * alias `@/`, que o Node puro nao resolve. O hash, porem, vem da PROPRIA
 * biblioteca (`better-auth/crypto`) — reimplementar o formato aqui seria a
 * receita para gravar uma senha que o login nao reconhece.
 */
import { createInterface } from "node:readline";
import { stdin, stdout, argv, exit, env } from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

const PAPEIS = ["administrador", "operador", "consultoria"];
/** Espelha `emailAndPassword.minPasswordLength` em src/lib/auth/config.ts. */
const TAMANHO_MINIMO = 12;

const email = argv[2]?.trim().toLowerCase();
const nome = argv[3]?.trim();
const papel = argv[4]?.trim();

if (!email) {
  console.error('Uso: node scripts/criar-usuario.mjs <email> ["Nome"] [papel]');
  console.error(`Papeis: ${PAPEIS.join(" | ")}`);
  exit(1);
}
if (papel && !PAPEIS.includes(papel)) {
  console.error(`Papel invalido: "${papel}". Use um de: ${PAPEIS.join(", ")}`);
  exit(1);
}

const raiz = resolve(import.meta.dirname, "..");

/**
 * DATABASE_URL do ambiente ou do `.env` — sem depender do dotenv.
 *
 * ⚠️ O `replace(/^﻿/, "")` NAO e paranoia: no Windows, `Set-Content
 * -Encoding utf8` do PowerShell 5.1 grava BOM, e o BOM gruda na PRIMEIRA chave
 * do arquivo. Sem tirar, `DATABASE_URL` vira `﻿DATABASE_URL` e o script
 * jura que a variavel nao existe — com um `.env` correto na frente da pessoa.
 */
function urlDoBanco() {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  try {
    const conteudo = readFileSync(resolve(raiz, ".env"), "utf8").replace(/^﻿/, "");
    const achado = conteudo
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/))
      .find(Boolean);
    return achado?.[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

/**
 * Le as duas senhas sem ecoar, numa UNICA interface de readline.
 *
 * Duas interfaces sobre o mesmo `stdin` sao frageis: a primeira consome o
 * buffer e a segunda espera para sempre. Uma so, usada duas vezes, resolve.
 */
async function pedirSenhas() {
  // SEM TTY (entrada canalizada, CI): o readline dispara todas as linhas de uma
  // vez e um segundo `question` nunca recebe nada. Lendo o stdin inteiro, o
  // comportamento e deterministico — e nao se perde protecao, porque o que a
  // ocultacao protege e a tela do terminal, que aqui nao existe.
  if (!stdin.isTTY) {
    let bruto = "";
    for await (const pedaco of stdin) bruto += pedaco;
    const linhas = bruto.split(/\r?\n/);
    return [linhas[0] ?? "", linhas[1] ?? ""];
  }

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  rl._writeToOutput = () => {};

  const perguntar = (rotulo) =>
    new Promise((resolver) => {
      stdout.write(rotulo);
      rl.question("", (resposta) => {
        stdout.write("\n");
        resolver(resposta);
      });
    });

  try {
    return [await perguntar(`Senha para ${email}: `), await perguntar("Repita a senha: ")];
  } finally {
    rl.close();
  }
}

const connectionString = urlDoBanco();
if (!connectionString) {
  console.error("DATABASE_URL nao encontrada (nem no ambiente, nem no .env).");
  exit(1);
}

const cliente = new pg.Client({ connectionString });
await cliente.connect();

try {
  // `"user"` COM ASPAS: `user` e palavra reservada do Postgres. Sem as aspas o
  // Postgres entende o usuario da sessao, nao a nossa tabela.
  const { rows } = await cliente.query(
    `SELECT id, name, papel, ativo FROM "user"
     WHERE lower(email) = $1 AND is_deleted = false`,
    [email],
  );
  const existente = rows[0];

  if (!existente && (!nome || !papel)) {
    console.error(`Nao existe usuario com o e-mail ${email}.`);
    console.error('Para CRIAR, informe nome e papel: node scripts/criar-usuario.mjs <email> "Nome" <papel>');
    exit(1);
  }

  const [senha, confirmacao] = await pedirSenhas();

  if (senha !== confirmacao) {
    console.error("As senhas nao conferem. Nada foi alterado.");
    exit(1);
  }
  if (senha.length < TAMANHO_MINIMO) {
    console.error(`A senha precisa de pelo menos ${TAMANHO_MINIMO} caracteres.`);
    exit(1);
  }

  // Hash pela propria biblioteca: e o formato que `sign-in/email` sabe conferir.
  const hash = await hashPassword(senha);

  // Tudo numa transacao. Se a senha mudasse e as sessoes sobrevivessem por uma
  // falha no meio, quem ja estava dentro continuaria dentro — e esse e
  // exatamente o cenario em que a senha e trocada por suspeita de acesso
  // indevido.
  await cliente.query("BEGIN");

  let usuarioId = existente?.id;

  if (!existente) {
    usuarioId = randomUUID();
    await cliente.query(
      `INSERT INTO "user" (id, name, email, email_verified, papel, ativo)
       VALUES ($1, $2, $3, true, $4, true)`,
      [usuarioId, nome, email, papel],
    );
    await cliente.query(
      // `account_id` recebe parametro PROPRIO ($4) mesmo carregando o mesmo
      // valor de `$2`: reusar $2 nos dois lugares faz o Postgres tentar deduzir
      // um tipo so para uma coluna `uuid` e uma `text` — erro 42P08.
      `INSERT INTO account (id, user_id, account_id, provider_id, password)
       VALUES ($1, $2, $4, 'credential', $3)`,
      [randomUUID(), usuarioId, hash, usuarioId],
    );
  } else {
    // Papel e nome so mudam se foram informados — trocar senha nao deve
    // silenciosamente rebaixar ou promover ninguem.
    if (nome || papel) {
      await cliente.query(
        `UPDATE "user"
         SET name = coalesce($2, name), papel = coalesce($3, papel), updated_at = now()
         WHERE id = $1`,
        [usuarioId, nome ?? null, papel ?? null],
      );
    }
    // `ON CONFLICT` nao serve aqui: a conta pode simplesmente nao existir (uma
    // linha de `user` criada a mao, sem credencial).
    const { rowCount } = await cliente.query(
      `UPDATE account SET password = $2, updated_at = now()
       WHERE user_id = $1 AND provider_id = 'credential' AND is_deleted = false`,
      [usuarioId, hash],
    );
    if (rowCount === 0) {
      await cliente.query(
        `INSERT INTO account (id, user_id, account_id, provider_id, password)
         VALUES ($1, $2, $2, 'credential', $3)`,
        [randomUUID(), usuarioId, hash],
      );
    }
  }

  const { rowCount: sessoes } = await cliente.query(
    `UPDATE session SET is_deleted = true, deleted_at = now(), updated_at = now()
     WHERE user_id = $1 AND is_deleted = false`,
    [usuarioId],
  );

  await cliente.query("COMMIT");

  console.log(
    existente
      ? `Senha atualizada para ${existente.name} (${email}).`
      : `Usuario criado: ${nome} (${email}) — papel ${papel}.`,
  );
  if (sessoes > 0) console.log(`${sessoes} sessao(oes) aberta(s) foram encerradas.`);
  if (existente && !existente.ativo) {
    console.log("ATENCAO: este usuario esta INATIVO e nao vai conseguir entrar.");
  }
} catch (erro) {
  await cliente.query("ROLLBACK").catch(() => {});
  throw erro;
} finally {
  await cliente.end();
}

exit(0);
