/**
 * Client Drizzle (node-postgres) — ponto unico de acesso ao banco.
 *
 * Importe `db` daqui, nunca instancie outro Pool: no dev do Next cada hot reload
 * reavalia o modulo, e um Pool novo por reload esgota as conexoes do PostgreSQL.
 * Por isso o Pool e memorizado em `globalThis` fora de producao.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL nao definida. Copie .env.example para .env e suba o banco local " +
      "com `docker compose up -d` (PostgreSQL na porta 5436, ver docker-compose.yml).",
  );
}

const globalForDb = globalThis as typeof globalThis & { __mmPool?: Pool };

export const pool = globalForDb.__mmPool ?? new Pool({ connectionString });

// `pg` emite `error` no Pool quando um client OCIOSO cai (restart do Postgres,
// timeout da rede). Sem listener e um 'error' nao tratado: o processo Node morre.
// Registrado so na criacao do Pool, para o hot reload nao empilhar listeners.
if (!globalForDb.__mmPool) {
  pool.on("error", (err) => console.error("[db] erro em conexao ociosa do pool", err));
}

if (process.env.NODE_ENV !== "production") globalForDb.__mmPool = pool;

export const db = drizzle(pool, { schema });
