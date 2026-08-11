#!/usr/bin/env node
// @ts-check
/**
 * check-compliance.mjs — Auditor de conformidade da Estrutura Base.
 *
 * Escaneia o codigo-fonte procurando violacoes das regras absolutas do projeto.
 * Sem dependencias externas (Node puro). Cross-platform (Windows/Mac/Linux).
 *
 * Uso:
 *   node scripts/check-compliance.mjs                # escaneia src/ (ou cwd)
 *   node scripts/check-compliance.mjs --file <path>  # escaneia um arquivo
 *   node scripts/check-compliance.mjs --json         # saida JSON (CI/IA)
 *   node scripts/check-compliance.mjs --quiet        # so erros (esconde avisos)
 *   node scripts/check-compliance.mjs --help
 *
 * Exit code: 1 se houver ERROS, 0 caso contrario (avisos nao falham).
 *
 * Regras checadas:
 *   [ERRO]  Prisma            — projeto usa Drizzle ORM, nunca Prisma
 *   [ERRO]  SQLite            — projeto usa PostgreSQL, nunca SQLite
 *   [ERRO]  Delete fisico     — db.delete()/deleteMany() — usar soft delete
 *   [ERRO]  DROP destrutivo   — DROP TABLE/DATABASE em .sql
 *   [ERRO]  Arquivo > 500 lin — quebrar em modulos menores
 *   [ERRO]  Tabela sem auditoria — pgTable faltando created_at/updated_at/deleted_at/is_deleted
 *   [ERRO]  Segredo hardcoded — chaves de API, tokens, private keys
 *   [AVISO] Query sem filtro  — .from() sem mencionar is_deleted no arquivo
 *   [AVISO] CASCADE em FK      — onDelete: 'cascade' (preferir restrict)
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, basename, resolve } from "node:path";

const ROOT = process.cwd();
const MAX_LINES = 500;

const IGNORE_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "coverage",
  ".turbo", "out", ".vercel", "templates", // templates contem padroes-ouro, nao escanear
  "migrations", "drizzle", // SQL gerado por drizzle-kit — nao se aplica limite de 500 linhas
  "design_handoff_sistema_mm", // prototipo hi-fi: referencia de design, nao codigo de producao
]);

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SQL_EXT = new Set([".sql"]);

// Os proprios scripts de auditoria contem os padroes proibidos como DEFINICAO
// de regra (ex.: o regex que detecta Prisma). Nunca auto-sinalizar.
const SKIP_FILES = new Set([
  "check-compliance.mjs", "project-map.mjs",
  "pre-write-guard.mjs", "post-write-check.mjs", // hooks: mesmos padroes como regra
]);

// ---------------------------------------------------------------------------
// Regras baseadas em regex (linha a linha)
// ---------------------------------------------------------------------------

/** @type {{id:string,level:'error'|'warn',re:RegExp,msg:string,ext?:Set<string>}[]} */
const LINE_RULES = [
  {
    id: "prisma",
    level: "error",
    re: /@prisma\/client|new\s+PrismaClient|from\s+["']prisma["']|require\(["']@prisma\/client["']\)/,
    msg: "Prisma detectado. Este projeto usa Drizzle ORM. Remova o Prisma.",
  },
  {
    id: "sqlite",
    level: "error",
    re: /better-sqlite3|drizzle-orm\/better-sqlite3|from\s+["']sqlite3?["']|:memory:/,
    msg: "SQLite detectado. Este projeto usa PostgreSQL em todos os ambientes.",
  },
  {
    id: "delete-fisico",
    level: "error",
    re: /\bdb\.delete\s*\(|\.deleteMany\s*\(|\bdrizzle[\w.]*\.delete\s*\(/,
    msg: "Delete fisico detectado. Use soft delete (is_deleted = true).",
  },
  {
    id: "drop-destrutivo",
    level: "error",
    ext: SQL_EXT,
    re: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
    msg: "DROP destrutivo em SQL. Proibido dropar estruturas de dados.",
  },
  {
    id: "segredo",
    level: "error",
    re: /sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN\s+(RSA|EC|OPENSSH|PRIVATE)\s+PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}/,
    msg: "Possivel segredo/credencial hardcoded. Mova para variavel de ambiente.",
  },
  {
    id: "cascade",
    level: "warn",
    re: /onDelete:\s*["']cascade["']/i,
    msg: "CASCADE em FK. Preferir RESTRICT para dados criticos.",
  },
];

// ---------------------------------------------------------------------------
// Coleta de arquivos
// ---------------------------------------------------------------------------

/** @param {string} dir @param {string[]} acc */
function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".github") {
      if (IGNORE_DIRS.has(e.name)) continue;
    }
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) continue;
      const ext = extname(e.name);
      if (CODE_EXT.has(ext) || SQL_EXT.has(ext)) acc.push(full);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Checagem de tabelas Drizzle (pgTable sem colunas de auditoria)
// ---------------------------------------------------------------------------

const AUDIT_COLS = ["created_at", "updated_at", "deleted_at", "is_deleted"];

/**
 * Marcador de excecao para tabela append-only (ex.: a propria trilha de
 * auditoria, especificada em docs/back.md sem updated_at/deleted_at/is_deleted).
 * Um log que pode ser alterado ou "soft deletado" nao e trilha de auditoria.
 *
 * Uso: comentar `compliance:append-only` nas linhas acima do pgTable.
 * So vale com justificativa escrita ao lado — nao e escape hatch generico.
 */
const APPEND_ONLY = "compliance:append-only";

/**
 * Extrai o corpo {...} de cada pgTable('nome', { ... }) e verifica as colunas.
 * @param {string} content @param {string} file @param {Finding[]} findings
 */
function checkDrizzleTables(content, file, findings) {
  const re = /pgTable\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const tableName = m[1];
    // Janela acima da declaracao: o marcador precisa estar perto da tabela,
    // para nao isentar as demais tabelas de um arquivo com varias.
    if (content.slice(Math.max(0, m.index - 600), m.index).includes(APPEND_ONLY)) continue;
    const openIdx = content.indexOf("{", m.index + m[0].length - 1);
    if (openIdx === -1) continue;
    // balanceia chaves
    let depth = 0;
    let endIdx = -1;
    for (let i = openIdx; i < content.length; i++) {
      const c = content[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (endIdx === -1) continue;
    const body = content.slice(openIdx, endIdx + 1);
    const missing = AUDIT_COLS.filter((col) => !body.includes(col));
    if (missing.length > 0) {
      const line = content.slice(0, m.index).split("\n").length;
      findings.push({
        level: "error",
        id: "tabela-sem-auditoria",
        file,
        line,
        msg: `Tabela "${tableName}" sem colunas de auditoria: ${missing.join(", ")}.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Checagem heuristica: query select sem filtro is_deleted
// ---------------------------------------------------------------------------

/** @param {string} content @param {string} file @param {Finding[]} findings */
function checkSoftDeleteFilter(content, file, findings) {
  const hasSelect = /\.from\s*\(/.test(content) && /\.select\s*\(/.test(content);
  if (!hasSelect) return;
  if (content.includes("is_deleted")) return; // ja filtra em algum lugar
  // pega a primeira ocorrencia de .from( para apontar a linha
  const idx = content.search(/\.from\s*\(/);
  const line = content.slice(0, idx).split("\n").length;
  findings.push({
    level: "warn",
    id: "query-sem-filtro",
    file,
    line,
    msg: "Arquivo faz SELECT mas nunca menciona is_deleted. Confirme que filtra deletados.",
  });
}

// ---------------------------------------------------------------------------
// Analise de um arquivo
// ---------------------------------------------------------------------------

/**
 * @typedef {{level:'error'|'warn',id:string,file:string,line:number,msg:string}} Finding
 * @param {string} file @returns {Finding[]}
 */
function analyzeFile(file) {
  /** @type {Finding[]} */
  const findings = [];
  if (SKIP_FILES.has(basename(file))) return findings; // vale tambem no modo --file
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return findings;
  }
  const ext = extname(file);
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const lines = content.split("\n");

  // tamanho do arquivo
  if (lines.length > MAX_LINES) {
    findings.push({
      level: "error",
      id: "arquivo-grande",
      file: rel,
      line: lines.length,
      msg: `Arquivo com ${lines.length} linhas (limite ${MAX_LINES}). Quebre em modulos.`,
    });
  }

  // regras por linha
  lines.forEach((text, i) => {
    // ignora linhas de comentario obvio para reduzir falso-positivo de exemplos
    const trimmed = text.trim();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    for (const rule of LINE_RULES) {
      if (rule.ext && !rule.ext.has(ext)) continue;
      if (isComment && rule.id !== "segredo") continue; // segredo vale mesmo em comentario
      if (rule.re.test(text)) {
        findings.push({
          level: rule.level,
          id: rule.id,
          file: rel,
          line: i + 1,
          msg: rule.msg,
        });
      }
    }
  });

  // checagens estruturais (so codigo TS/JS)
  if (CODE_EXT.has(ext)) {
    checkDrizzleTables(content, rel, findings);
    checkSoftDeleteFilter(content, rel, findings);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(2, 26).join("\n").replace(/^ \* ?/gm, ""));
    process.exit(0);
  }
  const asJson = args.includes("--json");
  const quiet = args.includes("--quiet");
  const fileFlag = args.indexOf("--file");

  /** @type {string[]} */
  let files = [];
  if (fileFlag !== -1 && args[fileFlag + 1]) {
    const target = resolve(args[fileFlag + 1]);
    if (existsSync(target) && statSync(target).isFile()) files = [target];
  } else {
    const srcDir = join(ROOT, "src");
    const scanRoot = existsSync(srcDir) ? srcDir : ROOT;
    files = walk(scanRoot, []);
  }

  /** @type {Finding[]} */
  let findings = [];
  for (const f of files) findings = findings.concat(analyzeFile(f));

  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");

  if (asJson) {
    console.log(JSON.stringify({
      ok: errors.length === 0,
      scanned: files.length,
      errors: errors.length,
      warnings: warns.length,
      findings,
    }, null, 2));
    process.exit(errors.length === 0 ? 0 : 1);
  }

  const show = quiet ? errors : findings;
  if (show.length === 0) {
    console.log(`OK — ${files.length} arquivo(s) escaneado(s), nenhuma violacao.`);
    process.exit(0);
  }

  // agrupa por arquivo
  /** @type {Map<string,Finding[]>} */
  const byFile = new Map();
  for (const f of show) {
    const arr = byFile.get(f.file) || [];
    arr.push(f);
    byFile.set(f.file, arr);
  }
  for (const [file, fs] of byFile) {
    console.log(`\n${file}`);
    for (const f of fs.sort((a, b) => a.line - b.line)) {
      const tag = f.level === "error" ? "ERRO " : "AVISO";
      console.log(`  ${tag} L${f.line}  [${f.id}] ${f.msg}`);
    }
  }
  console.log(`\n${"-".repeat(60)}`);
  console.log(`Escaneados: ${files.length} | Erros: ${errors.length} | Avisos: ${warns.length}`);
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
