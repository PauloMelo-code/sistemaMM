/**
 * Executor de tarefa de anuncio no Mercado Livre — pausar e reativar.
 *
 * Confirmado na documentacao oficial (2026-08-10):
 *   PUT https://api.mercadolibre.com/items/{ITEM_ID}   body: {"status":"paused"}
 * Reativar e a mesma chamada com `"active"`. Valores em minusculo, case
 * sensitive. Nunca `"closed"` — ver `status-anuncio.ts`.
 *
 * A ORDEM AQUI IMPORTA: primeiro o canal confirma, so depois o nosso banco
 * muda. Marcar `anuncios.status = 'pausado'` antes da confirmacao faria o
 * painel mentir na direcao perigosa — dizer "pausado" enquanto o anuncio segue
 * no ar e vendendo a peca que ja saiu do estoque.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { anuncios } from "@/lib/db/schema/anuncios";

import { chamarML, ErroML } from "./client";
import { statusLocalParaTipo, statusParaTipo, type StatusAnuncioML } from "./status-anuncio";
import { ErroPermanente } from "../retentativa";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";
import type { TarefaParaExecutor } from "../executores";

interface ItemML {
  id?: string;
  status?: string;
}

/**
 * Idempotencia SEM adivinhar a mensagem de erro do canal.
 *
 * Pausar o que ja esta pausado precisa contar como sucesso — a RN-104 exige que
 * reprocessar nao cause efeito colateral, e reentrega e rotina. Mas nao da para
 * depender do texto que o ML devolve num 400: texto de erro nao e contrato e
 * muda sem aviso.
 *
 * Entao: se o PUT falhar com 4xx, fazemos UM GET e olhamos o estado real. Se ja
 * esta como queriamos, a tarefa cumpriu o proposito dela. A chamada extra so
 * acontece no caminho de erro — o caminho feliz continua com uma requisicao.
 */
async function jaEstaNoEstado(idExterno: string, desejado: StatusAnuncioML): Promise<boolean> {
  try {
    const item = await chamarML<ItemML>(`/items/${idExterno}`, { lane: "urgente" });
    return item.status === desejado;
  } catch {
    // Nao conseguimos confirmar: devolve false para a tarefa ser retentada.
    // Dizer "ja estava" sem ter olhado seria marcar como feito algo que talvez
    // nao tenha acontecido.
    return false;
  }
}

export async function executarAnuncioML(tarefa: TarefaParaExecutor): Promise<void> {
  const desejado = statusParaTipo(tarefa.tipo);
  const statusLocal = statusLocalParaTipo(tarefa.tipo);
  if (!desejado || !statusLocal) {
    throw new ErroPermanente(
      `Tarefa do tipo "${tarefa.tipo}" nao mexe em anuncio do ML — executor errado para ela.`,
    );
  }

  const idExterno = tarefa.payload.id_externo;
  if (typeof idExterno !== "string" || idExterno.trim() === "") {
    // Anuncio que nunca foi publicado no canal (id_externo nulo). Nao ha o que
    // pausar la fora, e tentar de novo nao vai criar o id. Permanente.
    throw new ErroPermanente(
      `Tarefa ${tarefa.id} nao tem \`id_externo\` no payload — o anuncio nunca foi publicado ` +
        "no Mercado Livre, entao nao ha nada a pausar do lado de la.",
    );
  }

  try {
    await chamarML(`/items/${idExterno}`, {
      metodo: "PUT",
      corpo: { status: desejado },
      // Venda nao espera atras de varredura: pausar anuncio de peca ja vendida
      // e justamente o que impede a segunda venda.
      lane: "urgente",
    });
  } catch (erro) {
    // 4xx pode ser "ja esta assim" — que para nos e sucesso. Conferimos olhando,
    // nao interpretando texto de erro.
    if (erro instanceof ErroML && erro.status >= 400 && erro.status < 500) {
      if (!(await jaEstaNoEstado(idExterno, desejado))) throw erro;
    } else {
      throw erro;
    }
  }

  // So agora o nosso banco muda — o canal ja confirmou.
  if (tarefa.referenciaId) {
    await db
      .update(anuncios)
      .set({ status: statusLocal, updated_at: new Date(), modified_by: USUARIO_SISTEMA_ID })
      .where(and(eq(anuncios.id, tarefa.referenciaId), eq(anuncios.is_deleted, false)));
  }
}
