/** Esqueleto da Visao geral — 4 KPIs e o grid 1.7fr/1fr. */
export default function CarregandoVisaoGeral() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy aria-label="Carregando visão geral">
      <header className="flex flex-col gap-1.5">
        <div className="h-6 w-40 rounded-button bg-border" />
        <div className="h-4 w-64 rounded-button bg-divider" />
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-card border border-border bg-card shadow-(--shadow-card) px-5 py-4">
            <div className="h-3 w-28 rounded-button bg-divider" />
            <div className="h-7 w-24 rounded-button bg-border" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="rounded-card border border-border bg-card shadow-(--shadow-card)">
          <div className="border-b border-border px-5 py-4"><div className="h-4 w-44 rounded-button bg-border" /></div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-divider px-5 py-3 last:border-b-0">
              <div className="h-8 flex-1 rounded-button bg-divider" />
              <div className="h-4 w-20 rounded-button bg-divider" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-card border border-border bg-card shadow-(--shadow-card)">
              <div className="border-b border-border px-5 py-4"><div className="h-4 w-36 rounded-button bg-border" /></div>
              {[0, 1, 2].map((j) => (
                <div key={j} className="flex flex-col gap-1.5 border-b border-divider px-5 py-3 last:border-b-0">
                  <div className="h-3 w-32 rounded-button bg-divider" />
                  <div className="h-3.5 w-full rounded-button bg-divider" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
