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
import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { integracoesEventos } from "@/lib/db/schema/integracoes-eventos";
import type { Canal } from "@/lib/pricing";

import { USUARIO_SISTEMA_ID } from "./usuario-sistema";

/**
 * Teto do corpo aceito, em bytes.
 *
 * Validacao de fronteira: a URL e publica, e sem teto qualquer um enche a tabela
 * (e a memoria do processo) com um POST grande. Envelope de notificacao e
 * pequeno — dezenas de bytes, nao dezenas de KB —, entao 64 KB e folga larga.
 */
export const TAMANHO_MAXIMO_CORPO = 64 * 1024;

/**
 * A identidade do evento para fins de reentrega: SHA-256 do corpo CRU.
 *
 * POR QUE HASH, E NAO UM CAMPO DO PAYLOAD: usar um id vindo do envelope exigiria
 * saber qual campo do canal identifica a NOTIFICACAO. Se escolhessemos errado e
 * pegassemos o id do RECURSO, dois eventos diferentes sobre o mesmo pedido
 * (pagou -> enviou) teriam a mesma chave e o segundo seria descartado como
 * "reentrega". Perder notificacao real e pior do que gravar duplicata: hash do
 * corpo nao corre esse risco, porque conteudo diferente sempre gera chave
 * diferente.
 *
 * Usa o TEXTO como chegou, nao o JSON reserializado — reserializar pode reordenar
 * chaves e a mesma entrega geraria hashes diferentes.
 *
 * O QUE ISTO NAO COBRE: reentrega em que o canal muda algum campo (um timestamp
 * de envio, um contador de tentativa) gera corpo diferente, logo chave diferente,
 * logo uma segunda linha. Por isso o processamento la na frente TAMBEM precisa
 * ser idempotente — a trava do banco cobre a entrega, nao o efeito.
 */
export function chaveEvento(corpoCru: string): string {
  return createHash("sha256").update(corpoCru, "utf8").digest("hex");
}

export interface Envelope {
  topico: string | null;
  recurso: string | null;
}

/**
 * Le topico e recurso do envelope, quando estiverem la.
 *
 * **Melhor esforco, e so isso.** Sao colunas informativas — servem para alguem
 * olhar a tabela e entender o que chegou. Nada de negocio depende delas: o dado
 * real vem de um GET na API do canal (RN-117). Por isso aceita as grafias em
 * ingles e portugues sem drama e devolve nulo quando nao acha: envelope
 * desconhecido nao pode derrubar a gravacao.
 */
export function extrairEnvelope(corpo: unknown): Envelope {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) {
    return { topico: null, recurso: null };
  }

  const registro = corpo as Record<string, unknown>;
  const texto = (...chaves: string[]): string | null => {
    for (const chave of chaves) {
      const valor = registro[chave];
      if (typeof valor === "string" && valor.trim() !== "") return valor;
    }
    return null;
  };

  return {
    topico: texto("topic", "topico", "type"),
    recurso: texto("resource", "recurso", "path"),
  };
}

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
