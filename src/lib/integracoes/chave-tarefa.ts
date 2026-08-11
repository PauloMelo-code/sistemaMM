/**
 * A chave de idempotencia do outbox — a parte PURA.
 *
 * Separada de `tarefas.ts` pelo mesmo motivo de `envelope.ts` e `retentativa.ts`:
 * aquele arquivo importa `db`, e importar `db` instancia um Pool do Postgres na
 * avaliacao do modulo. Um teste desta funcao passaria a exigir banco no ar.
 */

export type TipoTarefa = "pausar_anuncio" | "reativar_anuncio" | "tirar_do_site";

export interface IdentidadeTarefa {
  tipo: TipoTarefa;
  /** Alvo interno — normalmente `anuncios.id`. */
  referenciaId: string;
  /**
   * Por que esta tarefa existe (ex.: `pedido:<uuid>`).
   *
   * Sem o motivo, "pausar o anuncio X" seria a MESMA tarefa para sempre: a
   * venda de hoje e a revenda daqui a tres meses colidiriam, e a segunda pausa
   * nunca aconteceria. Com ele, reprocessar o MESMO evento colide (desejado) e
   * um evento novo passa.
   */
  motivo: string;
}

/**
 * Descreve a INTENCAO, nunca o instante.
 *
 * Se levasse timestamp, toda reentrega do webhook criaria uma tarefa nova e a
 * RN-104 pausaria o mesmo anuncio varias vezes — que e o que ela proibe por
 * nome ("reprocessar o mesmo evento nao pode pausar duas vezes").
 */
export function chaveTarefa({ tipo, referenciaId, motivo }: IdentidadeTarefa): string {
  return `${tipo}:${referenciaId}:${motivo}`;
}
