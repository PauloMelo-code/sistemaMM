/**
 * Registro de notificacao de canal — o unico efeito do request de webhook
 * (RN-117).
 *
 * Regra que organiza este arquivo: o caminho do ack NUNCA pode falhar. Se o
 * handler devolve erro ou demora, o marketplace reentrega; depois de falhas
 * seguidas, suspende as notificacoes da aplicacao inteira e vendas e perguntas
 * param de entrar EM SILENCIO. Entao aqui nao ha chamada externa, nao ha
 * `SELECT` antes do `INSERT` e nem corpo malformado derruba a gravacao.
 */
import { db } from "@/lib/db";
import { integracoesEventos } from "@/lib/db/schema/integracoes-eventos";
import type { Canal } from "@/lib/pricing";

import { USUARIO_SISTEMA_ID } from "./usuario-sistema";
import { chaveEvento, extrairEnvelope } from "./envelope";

/**
 * A identidade do evento e a leitura do envelope moram em `./envelope.ts`, que e
 * PURO. Este arquivo importa `db`, e importar `db` cria um Pool do Postgres na
 * avaliacao do modulo — o que faria um teste daquelas funcoes precisar de banco
 * no ar. Reexportado aqui para quem consome o modulo nao precisar saber disso.
 */
export {
  TAMANHO_MAXIMO_CORPO,
  chaveEvento,
  extrairEnvelope,
  type Envelope,
} from "./envelope";

export interface EntradaEvento {
  canal: Canal;
  /** O corpo exatamente como chegou no request. */
  corpoCru: string;
}

export interface ResultadoEvento {
  /** `false` = reentrega; a linha ja existia e nada mais deve executar. */
  novo: boolean;
  chave: string;
}

/**
 * Grava a notificacao. Reentrega nao levanta erro: devolve `novo: false`.
 *
 * `ON CONFLICT DO NOTHING RETURNING` e a decisao central — nao e estilo. Duas
 * entregas SIMULTANEAS do mesmo evento (que e justamente quando o marketplace
 * reentrega) passariam as duas por um `SELECT` seguido de `INSERT`, pela janela
 * entre a leitura e a escrita. Aqui quem resolve o empate e o indice unico, e
 * so um dos dois recebe linha de volta.
 */
export async function registrarEvento({ canal, corpoCru }: EntradaEvento): Promise<ResultadoEvento> {
  const chave = chaveEvento(corpoCru);

  // Corpo que nao e JSON nao derruba o ack: entra embrulhado, sem perder nada.
  // A coluna e `jsonb` e o canal, um dia, pode mandar texto puro ou lixo — e um
  // 500 aqui viraria reentrega e, no limite, suspensao das notificacoes.
  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru);
  } catch {
    corpo = { _nao_json: corpoCru };
  }

  const { topico, recurso } = extrairEnvelope(corpo);

  const linhas = await db
    .insert(integracoesEventos)
    .values({
      canal,
      topico,
      recurso,
      chave_evento: chave,
      corpo,
      // Escrita de robo: sem isto o INSERT viola a FK de `modified_by`.
      modified_by: USUARIO_SISTEMA_ID,
    })
    .onConflictDoNothing({
      target: [integracoesEventos.canal, integracoesEventos.chave_evento],
    })
    .returning({ id: integracoesEventos.id });

  return { novo: linhas.length > 0, chave };
}
