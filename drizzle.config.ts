import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Invariante do projeto (CLAUDE.md #9): so `db:generate` + `db:migrate`.
// NUNCA `drizzle-kit push` — migracao e SQL aditivo, versionado e revisavel.

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL nao definida. Copie .env.example para .env e suba o banco local " +
      "com `docker compose up -d` (PostgreSQL na porta 5436, ver docker-compose.yml).",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./src/lib/db/migrations",
  dbCredentials: { url },
});
