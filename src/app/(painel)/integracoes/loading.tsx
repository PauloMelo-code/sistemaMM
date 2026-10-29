/**
 * Esqueleto da tela Integracoes — mesma geometria do conteudo final (grid de 2
 * colunas a partir de `md`, cinco cards, bloco de fila no fim), para a pagina
 * nao dar salto quando os dados chegam.
 */
export default function CarregandoIntegracoes() {
  return (
    <div
      className="flex animate-pulse flex-col gap-5"
      aria-busy
      aria-label="Carregando integrações"
    >
      <header className="flex flex-col gap-1.5">
        <div className="h-6 w-56 rounded-button bg-border" />
        <div className="h-4 w-80 rounded-button bg-divider" />
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-card border border-border bg-card shadow-(--shadow-card) p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="h-4 w-56 rounded-button bg-border" />
              <div className="h-5 w-24 rounded-pill bg-divider" />
            </div>
            <div className="h-3 w-full rounded-button bg-divider" />
            <div className="h-3 w-4/5 rounded-button bg-divider" />
            <div className="mt-1 flex flex-col gap-1.5">
              <div className="h-3 w-2/3 rounded-button bg-divider" />
              <div className="h-3 w-1/2 rounded-button bg-divider" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-border bg-card shadow-(--shadow-card) p-5">
        <div className="h-4 w-40 rounded-button bg-border" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-3 w-28 rounded-button bg-divider" />
              <div className="h-6 w-10 rounded-button bg-border" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
