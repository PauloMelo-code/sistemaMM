#!/usr/bin/env node
/**
 * Aplica as migracoes pendentes. E o que roda em HML e PRD.
 *
 *   node scripts/migrar.mjs
 *
 * POR QUE NAO `drizzle-kit migrate`: o drizzle-kit e dependencia de
 * DESENVOLVIMENTO e nao entra na imagem de producao (o estagio de runtime do
 * Dockerfile so tem o que a app importa). O migrador de runtime vem do proprio
 * `drizzle-orm`, que ja e dependencia de producao — mesma cadeia de migracoes,
 * mesma tabela de controle, sem arrastar a ferramenta de build para dentro do
 * container.
 *
 * `npm run db:migrate` (drizzle-kit) continua sendo o caminho de
 * desenvolvimento, onde ele tambem gera SQL.
 *
 * ⚠️ TODAS AS MIGRACOES PENDENTES CORREM NUMA TRANSACAO SO. Se a ultima falhar,
 * o Postgres desfaz o lote inteiro — o banco fica exatamente onde estava, e nao
 * num estado parcial que so sai na mao. Por isso este script pode ser chamado
 * de novo com seguranca depois de um erro.
 */
import { exit, env } from "node:process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const raiz = resolve(import.meta.dirname, "..");

/**
 * DATABASE_URL do ambiente ou do `.env`.
 *
 * ⚠️ O `replace(/^﻿/, "")` NAO e paranoia: no Windows, `Set-Content -Encoding
 * utf8` do PowerShell 5.1 grava BOM, e o BOM gruda na PRIMEIRA chave do arquivo.
 * Sem tirar, `DATABASE_URL` vira `﻿DATABASE_URL` e o script jura que a
 * variavel nao existe — com um `.env` correto na frente da pessoa.
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

const connectionString = urlDoBanco();
if (!connectionString) {
  console.error("DATABASE_URL nao encontrada (nem no ambiente, nem no .env).");
  exit(1);
}

// `connectionTimeoutMillis` pelo mesmo motivo do criar-usuario.mjs: sem ele,
// host errado deixa o comando pendurado sem dizer nada, e trava silenciosa e
// indistinguivel de script quebrado.
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder: resolve(raiz, "src/lib/db/migrations") });
  console.log("Migracoes aplicadas.");
} catch (erro) {
  // Mensagem completa no stderr: aqui quem le e quem faz o deploy, nao a
  // internet — ao contrario de /api/saude, esconder detalhe so atrapalharia.
  console.error("FALHOU ao migrar. O banco foi deixado como estava (rollback).");
  console.error(erro);
  exit(1);
} finally {
  await pool.end();
}

exit(0);
