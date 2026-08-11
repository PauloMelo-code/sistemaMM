/** Esqueleto do Estoque — 4 KPIs, chips e 6 linhas, na geometria final. */
export default function CarregandoEstoque() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy aria-label="Carregando estoque">
      <header className="flex flex-col gap-1.5">
        <div className="h-6 w-36 rounded-button bg-border" />
        <div className="h-4 w-80 rounded-button bg-divider" />
      </header>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-card border border-border bg-card px-5 py-4">
            <div className="h-3 w-24 rounded-button bg-divider" />
            <div className="h-7 w-12 rounded-button bg-border" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-8 w-32 rounded-button bg-divider" />)}
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="h-9 bg-table-head" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 border-t border-divider px-4 py-3">
            <div className="h-8 flex-1 rounded-button bg-divider" />
            <div className="h-3.5 w-10 rounded-button bg-divider" />
            <div className="h-3.5 w-24 rounded-button bg-divider" />
            <div className="h-3.5 w-16 rounded-button bg-divider" />
            <div className="h-5 w-24 rounded-pill bg-divider" />
          </div>
        ))}
      </div>
    </div>
  );
}
