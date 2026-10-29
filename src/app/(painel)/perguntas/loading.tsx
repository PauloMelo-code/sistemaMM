/**
 * Esqueleto da tela Perguntas — a MESMA geometria do conteudo final (grid
 * 1.4fr 1fr, cards de 4 linhas), para a pagina nao dar salto quando os dados
 * chegam.
 *
 * "MESMA geometria" inclui os breakpoints: se `page.tsx` empilha as colunas
 * abaixo de `lg`, aqui tem que empilhar no mesmo ponto. Esqueleto que nao
 * acompanha o layout real vira a causa do salto que ele existe para evitar —
 * foi o que aconteceu quando a responsividade entrou so na tela.
 */
export default function CarregandoPerguntas() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy aria-label="Carregando perguntas">
      <header className="flex flex-col gap-1.5">
        <div className="h-6 w-40 rounded-button bg-border" />
        {/* `w-96` sozinho sao 384px: estoura a largura util de um aparelho de
            375px e faz a PAGINA rolar de lado. Com `max-w` ele encolhe. */}
        <div className="h-4 w-full max-w-96 rounded-button bg-divider" />
      </header>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-card border border-border bg-card shadow-(--shadow-card)">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 border-b border-divider px-5 py-4 last:border-b-0">
              {/* Espelha o `flex-wrap` da linha canal+pill do conteudo real:
                  no estreito a pill cai para a linha de baixo, e o esqueleto
                  precisa ter a mesma altura que o conteudo vai ter. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="h-3 w-56 max-w-full rounded-button bg-divider" />
                <div className="h-5 w-32 rounded-pill bg-divider" />
              </div>
              <div className="h-4 w-3/4 rounded-button bg-divider" />
              <div className="mt-1 flex gap-2">
                <div className="h-7 w-24 rounded-button bg-divider" />
                <div className="h-7 w-28 rounded-button bg-divider" />
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-card border border-border bg-card shadow-(--shadow-card)">
          <div className="border-b border-border px-5 py-4">
            <div className="h-4 w-44 rounded-button bg-border" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5 border-b border-divider px-5 py-[13px] last:border-b-0">
              <div className="h-3.5 w-40 rounded-button bg-divider" />
              <div className="h-3 w-full rounded-button bg-divider" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
