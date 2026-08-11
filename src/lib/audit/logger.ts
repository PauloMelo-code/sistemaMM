/**
 * Trilha de auditoria — quem, o que, quando (RN-002).
 *
 * A tabela `auditoria` existe desde a migracao 0000, com indices e RBAC, e ate
 * hoje **nenhuma linha do sistema escrevia nela**. Este modulo e o que faltava.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ RECEBE A TRANSACAO, e isso e o ponto do desenho.
 *
 * O template-ouro da casa grava a auditoria DEPOIS da mutacao, em duas idas ao
 * banco. Uma falha entre as duas (processo morto, conexao caida, deploy no meio)
 * deixa o dado alterado e o registro do que aconteceu perdido — e o buraco
 * aparece exatamente no caso em que a trilha mais importa, que e quando algo deu
 * errado. Aqui a escrita vai DENTRO da mesma transacao: ou as duas acontecem, ou
 * nenhuma.
 *
 * Por isso toda funcao recebe `bd` em vez de importar `db` direto — quem chama
 * passa a transacao aberta.
 * ---------------------------------------------------------------------------
 *
 * `detalhes` e NOT NULL de proposito: obriga quem grava a escrever a frase que
 * um humano vai ler no Dashboard. "atualizou o registro" nao serve; "alterou o
 * custo de R$ 3.300 para R$ 4.100" e o que responde a pergunta seis meses
 * depois.
 */
import type { db as ClienteBanco } from "@/lib/db";
import { auditoria } from "@/lib/db/schema/auditoria";

/**
 * Aceita tanto o client normal quanto uma transacao aberta.
 *
 * O tipo sai do proprio `db.transaction` para nao desencostar dele: se o
 * drizzle mudar a assinatura, isto quebra no typecheck em vez de em producao.
 */
export type Executor =
  | typeof ClienteBanco
  | Parameters<Parameters<typeof ClienteBanco.transaction>[0]>[0];

export type AcaoAuditada = "criar" | "atualizar" | "excluir";

export interface EntradaAuditoria {
  /** Quem executou. Sai da sessao — nunca de parametro vindo do cliente. */
  userId: string;
  acao: AcaoAuditada;
  /** Nome FISICO da tabela, como no banco (ex.: "itens"). */
  tabela: string;
  registroId: string;
  /** Frase legivel por humano. Ver o comentario do cabecalho. */
  detalhes: string;
  dadosAnteriores?: unknown;
  dadosNovos?: unknown;
}

/**
 * Serializa o retrato do registro.
 *
 * ⚠️ NAO FILTRA CUSTO, e e proposital: a trilha e para o administrador (a
 * matriz do RBAC so da `auditoria: ler` a administrador e consultoria). Filtrar
 * aqui esconderia justamente a alteracao de custo, que e a que mais precisa de
 * rastro. O sigilo da RN-107 se resolve em quem LE a trilha, nao em quem grava.
 */
function retrato(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  return JSON.stringify(valor);
}

/** Grava uma linha na trilha. Chame DENTRO da transacao da mutacao. */
export async function registrarAuditoria(bd: Executor, entrada: EntradaAuditoria): Promise<void> {
  await bd.insert(auditoria).values({
    user_id: entrada.userId,
    acao: entrada.acao,
    tabela: entrada.tabela,
    registro_id: entrada.registroId,
    detalhes: entrada.detalhes,
    dados_anteriores: retrato(entrada.dadosAnteriores),
    dados_novos: retrato(entrada.dadosNovos),
  });
}

/**
 * Descreve o que mudou, campo a campo, para o `detalhes`.
 *
 * Produz "custo: 3300.00 → 4100.00; nome: Autorrefrator → Autorrefrator TX-20".
 * Sem isto cada action inventaria a propria frase, e metade delas diria so
 * "atualizou" — que e o mesmo que nao registrar.
 */
export function descreverMudancas(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  campos: readonly string[],
): string {
  const mudancas = campos
    .filter((campo) => String(antes[campo] ?? "") !== String(depois[campo] ?? ""))
    .map((campo) => `${campo}: ${antes[campo] ?? "—"} → ${depois[campo] ?? "—"}`);

  return mudancas.length > 0 ? mudancas.join("; ") : "nenhum campo alterado";
}
