/** Esqueleto de Lotes — grid 2x2 de cards, na geometria final. */
export default function CarregandoLotes() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy aria-label="Carregando lotes">
      <header className="flex flex-col gap-1.5">
        <div className="h-6 w-52 rounded-button bg-border" />
        <div className="h-4 w-80 rounded-button bg-divider" />
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="h-4 w-48 rounded-button bg-border" />
              <div className="h-3 w-28 rounded-button bg-divider" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((j) => (
                <div key={j} className="flex flex-col gap-1.5">
                  <div className="h-3 w-16 rounded-button bg-divider" />
                  <div className="h-5 w-24 rounded-button bg-border" />
                  <div className="h-3 w-20 rounded-button bg-divider" />
                </div>
              ))}
            </div>
            <div className="h-2 w-full rounded-pill bg-divider" />
          </div>
        ))}
      </div>
    </div>
  );
}
