/** Esqueleto da tela Anuncios — mesma geometria (chips + 6 linhas de tabela). */
export default function CarregandoAnuncios() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy aria-label="Carregando anúncios">
      <header className="flex flex-col gap-1.5">
        <div className="h-6 w-40 rounded-button bg-border" />
        <div className="h-4 w-64 rounded-button bg-divider" />
      </header>
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 w-24 rounded-button bg-divider" />
        ))}
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-(--shadow-card)">
        <div className="h-9 bg-table-head" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 border-t border-divider px-4 py-3">
            <div className="h-3.5 flex-1 rounded-button bg-divider" />
            <div className="h-3.5 w-10 rounded-button bg-divider" />
            <div className="h-3.5 w-16 rounded-button bg-divider" />
            <div className="h-3.5 w-12 rounded-button bg-divider" />
            <div className="h-5 w-20 rounded-pill bg-divider" />
          </div>
        ))}
      </div>
    </div>
  );
}
