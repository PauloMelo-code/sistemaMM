/**
 * A identidade que assina as escritas automaticas.
 *
 * POR QUE PRECISA EXISTIR: toda tabela desta base tem `modified_by` NOT NULL com
 * FK para `usuarios` — a regra de rastreabilidade (RN-002) nao abre excecao. Mas
 * webhook e worker nao tem usuario logado. Sem uma identidade de sistema,
 * NENHUMA escrita de integracao consegue gravar: o INSERT viola a FK.
 *
 * A alternativa seria tornar `modified_by` nullable, e ai "ninguem sabe quem
 * fez" volta a ser um estado possivel em toda a base. Um usuario dedicado
 * mantem a coluna obrigatoria e ainda torna a trilha mais legivel: da para
 * separar o que o Anderson fez do que o robo fez, filtrando por este id.
 *
 * O UUID e FIXO e nasce na migracao. Nao pode ser gerado em runtime: um id novo
 * a cada ambiente quebraria a FK em HML/PRD, e um `SELECT` para descobri-lo a
 * cada escrita seria uma ida ao banco em todo caminho de integracao.
 */

/**
 * UUID do usuario de sistema. Criado pela migracao `0004`.
 *
 * Sequencia toda-zeros com sufixo `...0001` de proposito: e obviamente
 * artificial ao bater o olho num log ou numa trilha de auditoria — ninguem
 * confunde com um usuario de verdade.
 */
export const USUARIO_SISTEMA_ID = "00000000-0000-0000-0000-000000000001";

/** E o robo, e nao uma pessoa, quem assinou este registro? */
export function ehUsuarioSistema(userId: string | null | undefined): boolean {
  return userId === USUARIO_SISTEMA_ID;
}
