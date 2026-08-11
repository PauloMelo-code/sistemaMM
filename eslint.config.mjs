import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // --- fora do lint de propósito (invariantes do projeto, ver CLAUDE.md) ---
    // Prototipo hi-fi: referencia de design, NAO codigo de producao.
    // Invariante #6 do CLAUDE.md diz literalmente "nao lintar".
    "design_handoff_sistema_mm/**",
    // Arquivos-ouro: importam modulos que so existem depois de copiados.
    "templates/**",
    // Ferramentas da base (auditores em Node puro), nao codigo da aplicacao.
    "scripts/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
