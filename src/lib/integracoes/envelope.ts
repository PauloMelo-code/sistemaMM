/**
 * Parte PURA do registro de notificacao de canal (RN-117): identidade do evento
 * e leitura do envelope.
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO DE `eventos.ts`:
 * `eventos.ts` importa `db`, e importar `db` **cria um Pool do Postgres e exige
 * DATABASE_URL na avaliacao do modulo**. Um teste destas funcoes — que so mexem
 * com string e objeto — passaria a precisar de banco no ar e deixaria conexao
 * pendurada. Mesma razao pela qual `pricing.ts` e puro.
 *
 * Regra pratica: **o que tem teste em `node:test` nao pode depender de `db` nem
 * do alias `@/`** — o type-stripping do `node --test` nao aplica os `paths` do
 * tsconfig. Ver docs/back.md.
 *
 * Modulo PURO: so `node:crypto`. Nao importa banco, nem React, nem env.
 */
import { createHash } from "node:crypto";

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
