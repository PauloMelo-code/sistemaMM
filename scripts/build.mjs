#!/usr/bin/env node
/**
 * Roda `next build` a partir do caminho REAL do projeto no disco.
 *
 * POR QUE ISTO EXISTE (nao remova achando que e firula):
 *
 * No Windows o sistema de arquivos ignora maiusculas, mas os grafos de modulo do
 * Node e do Turbopack sao indexados por STRING de caminho — e essas duas coisas
 * discordam. A pasta real e `C:\Users\Paulo\Desktop`; um terminal que entrou por
 * `cd desktop` faz o build inteiro rodar com `...\desktop\...`. O mesmo arquivo
 * passa a ter duas identidades, o modulo do `workAsyncStorage` e carregado duas
 * vezes, e o store que uma instancia grava a outra nao enxerga. O sintoma:
 *
 *   Error [InvariantError]: Invariant: Expected workStore to be initialized.
 *   Export encountered an error on /_global-error/page
 *
 * A mensagem termina em "This is a bug in Next.js" e aponta para uma pagina
 * interna do framework, entao custa caro perceber que a causa e o cwd. Foi
 * comprovado por bisect em 2026-08-10: o MESMO diretorio compila por
 * `C:\Users\Paulo\Desktop\...` e falha por `C:\Users\Paulo\desktop\...`.
 *
 * `realpathSync.native` devolve a grafia canonica do disco, entao o build passa
 * a independer de como o desenvolvedor navegou ate a pasta. Em Linux (CI, VPS) o
 * caminho ja e canonico e isto vira no-op.
 *
 * Nao adianta canonizar so o `turbopack.root` no next.config.ts — testado, nao
 * resolve: quem contamina o grafo e o cwd do processo.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

const raiz = realpathSync.native(path.resolve(import.meta.dirname, ".."));

// Argumentos extras passam adiante: `npm run build -- --debug-prerender`.
const { status } = spawnSync("next", ["build", ...process.argv.slice(2)], {
  cwd: raiz,
  stdio: "inherit",
  shell: true, // necessario no Windows para achar o .cmd de node_modules/.bin
});

process.exit(status ?? 1);
