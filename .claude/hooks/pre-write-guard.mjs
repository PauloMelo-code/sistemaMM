#!/usr/bin/env node
// @ts-check
/**
 * pre-write-guard.mjs — Hook PreToolUse (Write|Edit|MultiEdit).
 *
 * BLOQUEIA (exit 2) a gravacao de codigo que viola as regras absolutas da base,
 * ANTES de o arquivo ser escrito. Hooks impoem regras a 100% — markdown so ~70%.
 *
 * Regras bloqueadas:
 *   - Prisma          (projeto usa Drizzle)
 *   - SQLite          (projeto usa PostgreSQL)
 *   - Delete fisico   (db.delete / deleteMany — usar soft delete)
 *   - Editar .env     (secrets ficam fora do git; use .env.example)
 *
 * Fail-open: qualquer erro interno -> exit 0 (nunca trava o fluxo do dev).
 * Para desativar temporariamente, remova o bloco PreToolUse de .claude/settings.json.
 */

import { basename, extname, resolve } from "node:path";

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"]);
const SKIP_PATH = /(^|[\\/])(node_modules|templates|docs|\.claude)[\\/]/;

const RULES = [
  {
    id: "prisma",
    re: /@prisma\/client|new\s+PrismaClient|from\s+["']prisma["']|require\(["']@prisma\/client["']\)/,
    msg: "Prisma detectado. Esta base usa Drizzle ORM. Use drizzle-orm.",
  },
  {
    id: "sqlite",
    re: /better-sqlite3|drizzle-orm\/better-sqlite3|from\s+["']sqlite3?["']|:memory:/,
    msg: "SQLite detectado. Esta base usa PostgreSQL em todos os ambientes.",
  },
  {
    id: "delete-fisico",
    re: /\bdb\.delete\s*\(|\.deleteMany\s*\(/,
    msg: "Delete fisico detectado. Use soft delete: set is_deleted=true, deleted_at=now().",
  },
];

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function introducedText(tool, input) {
  if (!input) return "";
  if (tool === "Write") return String(input.content ?? "");
  if (tool === "Edit") return String(input.new_string ?? "");
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.map((e) => String(e?.new_string ?? "")).join("\n");
  }
  return "";
}

function block(reason) {
  process.stderr.write(
    `[guard] Gravacao bloqueada pela Estrutura Base:\n${reason}\n` +
    `Corrija e tente novamente. (regras em CLAUDE.md / docs/)\n`
  );
  process.exit(2);
}

async function main() {
  const raw = (await readStdin()).replace(/^﻿/, ""); // strip BOM
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // fail-open
  }

  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  const filePath = String(input.file_path || "");
  if (!filePath) process.exit(0);

  // So governa arquivos DENTRO deste projeto. Edicoes em outros projetos
  // (ex.: outro repo com stack diferente) nao sao bloqueadas por esta base.
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) {
    const root = resolve(projectDir).toLowerCase();
    const target = resolve(filePath).toLowerCase();
    if (!target.startsWith(root)) process.exit(0);
  }

  const base = basename(filePath);

  // Protecao de .env (secrets) — vale para qualquer extensao.
  if (base === ".env" || base === ".env.production" || base === ".env.prod") {
    block(
      `Nao edite "${base}" diretamente (contem secrets, fica fora do git).\n` +
      `Use ".env.example" para documentar variaveis no template.`
    );
  }

  const ext = extname(filePath);
  if (!CODE_EXT.has(ext)) process.exit(0);       // .md e outros: liberado
  if (SKIP_PATH.test(filePath)) process.exit(0); // templates/docs/.claude: liberado

  const text = introducedText(tool, input);
  if (!text) process.exit(0);

  const lines = text.split("\n");
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      if (isComment(lines[i])) continue;
      if (rule.re.test(lines[i])) {
        block(`  [${rule.id}] L~${i + 1}: ${rule.msg}`);
      }
    }
  }

  process.exit(0);
}

main().catch(() => process.exit(0)); // fail-open
