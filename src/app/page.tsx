// Placeholder honesto: o ambiente subiu, nenhuma das 12 telas do painel existe
// ainda. Nao inventar dashboard aqui — cada tela nasce por /importar-tela.
const DOCS: ReadonlyArray<readonly [string, string]> = [
  ["docs/known-issues.md", "o que bloqueia o inicio e o que ainda nao foi decidido"],
  ["docs/regras-negocio.md", "regras de dinheiro, estoque e SLA"],
  ["docs/design-system.md", "tokens de cor, tipografia e raio"],
  ["design_handoff_sistema_mm/README.md", "handoff hi-fi das telas"],
];

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-5">
      <section className="w-full max-w-xl rounded-card border border-border bg-card p-5">
        <p className="text-[11px] uppercase tracking-[.12em] text-ink-2">
          Ambiente de desenvolvimento
        </p>

        <h1 className="mt-2 font-display text-[22px] font-bold text-navy">
          Sistema MM Solucoes
        </h1>

        <p className="mt-2 text-[13px] text-ink-2">
          Next 16 + Tailwind v4 no ar, com os tokens do design system carregados
          em <span className="font-medium text-ink">src/app/globals.css</span>.
          Nenhuma tela do painel ou do site publico foi implementada ainda.
        </p>

        <ul className="mt-4 flex flex-col gap-2 border-t border-divider pt-4">
          {DOCS.map(([caminho, descricao]) => (
            <li key={caminho} className="text-[13px] text-ink-2">
              <span className="font-medium text-ink">{caminho}</span>
              {" — "}
              {descricao}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
