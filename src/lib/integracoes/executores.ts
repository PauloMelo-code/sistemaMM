/**
 * Registro de executores de tarefa — quem sabe realizar cada acao do outbox.
 *
 * Mesmo desenho do `HANDLERS` dos eventos, e pela mesma razao: o worker filtra
 * a fila pelos pares `(canal, tipo)` que TEM executor, entao tarefa sem dono nao
 * queima tentativa. Ela espera, visivel, ate alguem escrever o executor.
 *
 * ESTADO HOJE: existe executor para o **Mercado Livre**. Nao existe para a
 * **OLX** — a conta da MM nem tem acesso confirmado a API deles
 * (docs/known-issues.md 🔴), entao qualquer coisa que eu escrevesse seria chute
 * sobre um endpoint que ninguem viu.
 *
 * Consequencia pratica que vale saber: a venda que chega pelo ML gera tarefa
 * para pausar na OLX — ou seja, o caso mais comum e justamente o que ainda nao
 * executa. O executor do ML cobre o caminho inverso (vendeu na OLX ou no
 * WhatsApp, pausa no ML).
 */
import type { Canal } from "@/lib/pricing";
import type { TipoTarefa } from "./chave-tarefa";
// Import estatico e seguro: `politica.ts` e puro (so le `process.env`).
import { podeDeletarNaOlx } from "./olx/politica";

export interface TarefaParaExecutor {
  id: string;
  canal: Canal;
  tipo: TipoTarefa;
  /** Alvo interno — normalmente `anuncios.id`. */
  referenciaId: string | null;
  /** O que foi gravado no enfileiramento. */
  payload: Record<string, unknown>;
  tentativas: number;
}

export type Executor = (tarefa: TarefaParaExecutor) => Promise<void>;

/** Chave do registro: quem executa depende do canal E do que fazer. */
export function chaveExecutor(canal: string, tipo: string): string {
  return `${canal}:${tipo}`;
}

export const EXECUTORES = new Map<string, Executor>();

// Pausar e reativar anuncio no Mercado Livre.
//
// `import` DINAMICO pelo mesmo motivo do `handlers.ts`: o executor importa `db`
// e o cliente do ML, e importar `db` instancia um Pool na avaliacao do modulo —
// este arquivo precisa continuar carregavel sem banco no ar.
for (const tipo of ["pausar_anuncio", "reativar_anuncio"] as const) {
  EXECUTORES.set(chaveExecutor("mercado_livre", tipo), async (tarefa) => {
    const { executarAnuncioML } = await import("./mercado-livre/executor-anuncio");
    await executarAnuncioML(tarefa);
  });
}

// Tirar anuncio do ar na OLX — SO quando a delecao estiver autorizada.
//
// ⚠️ Na OLX, pausar SIGNIFICA APAGAR: a API de autoupload tem `insert` e
// `delete`, e nada entre os dois. Reanunciar depois e um anuncio novo, sem o id,
// a posicao e a visibilidade do antigo.
//
// O REGISTRO E CONDICIONAL, e isso importa mais do que parece. Se o executor
// estivesse sempre registrado e apenas recusasse enquanto a decisao nao vem, a
// tarefa seria reivindicada, queimaria as cinco tentativas e viraria
// **esgotada** — e no dia em que o Anderson decidisse, o pedido de pausa daquela
// peca ja estaria morto na fila, sem ninguem para reexecutar. Fora do registro,
// a tarefa espera intacta (`tentativas = 0`) e aparece em `aguardandoExecutor`.
//
// So `pausar_anuncio`: reativar na OLX seria um `insert` completo — republicar,
// nao desfazer uma pausa. Depende da RN-120 (⚠️ aberta).
if (podeDeletarNaOlx()) {
  EXECUTORES.set(chaveExecutor("olx", "pausar_anuncio"), async (tarefa) => {
    const { executarAnuncioOlx } = await import("./olx/executor-anuncio");
    await executarAnuncioOlx(tarefa);
  });
}
