#!/usr/bin/env node
/**
 * Define a senha de um usuario. RODE VOCE, no seu terminal.
 *
 *   node scripts/definir-senha.mjs anderson@mmsolucoes.com.br
 *
 * A senha e pedida de forma OCULTA e nunca aparece na tela, no historico do
 * shell nem em log. Por isso ela NAO e argumento de linha de comando: argumento
 * fica no `history`, no `ps` e no log do terminal.
 *
 * Nao passe senha real em chat, ticket ou mensagem — nem para uma IA. Este
 * script existe justamente para a senha nao precisar sair da sua maquina.
 *
 * FALA COM O `pg` DIRETO, e nao com o client Drizzle da aplicacao: aquele faz
 * `import * as schema from "./schema"`, um import de DIRETORIO que o Turbopack
 * resolve e o Node puro nao (ERR_UNSUPPORTED_DIR_IMPORT). Ferramenta de
 * manutencao nao deve depender do grafo de modulos da aplicacao para funcionar.
 */
import { createInterface } from "node:readline";
import { stdin, stdout, argv, exit, env } from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const email = argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Uso: node scripts/definir-senha.mjs <email>");
  exit(1);
}

const raiz = resolve(import.meta.dirname, "..");

/**
 * DATABASE_URL do ambiente ou do `.env` — sem depender do dotenv.
 *
 * ⚠️ O `replace(/^﻿/, "")` NAO e paranoia: no Windows, `Set-Content
 * -Encoding utf8` do PowerShell 5.1 grava BOM, e o BOM gruda na PRIMEIRA chave
 * do arquivo. Sem tirar, `DATABASE_URL` vira `﻿DATABASE_URL` e o script
 * jura que a variavel nao existe — com um `.env` que esta ali, correto, na
 * frente da pessoa. Custou uma rodada de depuracao para descobrir.
 *
 * A regex tolera espacos e o prefixo `export`, que aparecem em `.env` escrito a
 * mao.
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
 * buffer de entrada e a segunda fica esperando para sempre — acontece com
 * entrada canalizada e pode acontecer com digitacao rapida num terminal. Uma so,
 * usada duas vezes, resolve.
 *
 * O `_writeToOutput` vazio e o que apaga o eco: a senha nunca aparece na tela.
 */
async function pedirSenhas() {
  // SEM TTY (entrada canalizada, CI): o readline dispara todas as linhas de uma
  // vez e um segundo `question` nunca recebe nada — foi assim que este script
  // ficou pendurado ate ser reescrito. Lendo o stdin inteiro, o comportamento e
  // deterministico. E nao se perde protecao: o que a ocultacao protege e a tela
  // do terminal, que aqui nao existe.
  if (!stdin.isTTY) {
    let bruto = "";
    for await (const pedaco of stdin) bruto += pedaco;
    const linhas = bruto.split(/\r?\n/);
    return [linhas[0] ?? "", linhas[1] ?? ""];
  }

  // COM TTY: uma unica interface, com o eco desligado. `_writeToOutput` vazio e
  // o que impede a senha de aparecer na tela.
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

const { gerarHash, validarSenha } = await import(
  pathToFileURL(resolve(raiz, "src/lib/auth/senha.ts")).href
);

const [senha, confirmacao] = await pedirSenhas();

if (senha !== confirmacao) {
  console.error("As senhas nao conferem. Nada foi alterado.");
  exit(1);
}

const problema = validarSenha(senha);
if (problema) {
  console.error(problema);
  exit(1);
}

const cliente = new pg.Client({ connectionString });
await cliente.connect();

try {
  const { rows } = await cliente.query(
    `SELECT id, nome, ativo FROM usuarios
     WHERE lower(email) = $1 AND is_deleted = false`,
    [email],
  );
  const usuario = rows[0];
  if (!usuario) {
    console.error(`Nenhum usuario com o e-mail ${email}.`);
    exit(1);
  }

  const hash = await gerarHash(senha);

  // Tudo numa transacao: senha nova e sessoes derrubadas juntas, ou nada. Se a
  // senha mudasse e as sessoes sobrevivessem por causa de uma falha no meio,
  // quem ja estava dentro continuaria dentro — e esse e exatamente o cenario em
  // que a senha e trocada por suspeita de acesso indevido.
  await cliente.query("BEGIN");
  await cliente.query(
    `UPDATE usuarios
     SET senha_hash = $1, tentativas_falhas = 0, bloqueado_ate = NULL,
         updated_at = now(), modified_by = $2
     WHERE id = $2`,
    [hash, usuario.id],
  );
  const { rowCount } = await cliente.query(
    `UPDATE usuarios_sessoes
     SET is_deleted = true, deleted_at = now(), updated_at = now()
     WHERE user_id = $1 AND is_deleted = false`,
    [usuario.id],
  );
  await cliente.query("COMMIT");

  console.log(`Senha definida para ${usuario.nome} (${email}).`);
  if (rowCount > 0) console.log(`${rowCount} sessao(oes) aberta(s) foram encerradas.`);
  if (!usuario.ativo) console.log("ATENCAO: este usuario esta INATIVO e nao vai conseguir entrar.");
} catch (erro) {
  await cliente.query("ROLLBACK").catch(() => {});
  throw erro;
} finally {
  await cliente.end();
}

exit(0);
