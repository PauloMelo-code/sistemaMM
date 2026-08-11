/**
 * Executor de tarefa de anuncio na OLX.
 *
 * ⚠️ AQUI "PAUSAR" SIGNIFICA **APAGAR**. A OLX nao tem estado pausado; a unica
 * forma de tirar o anuncio do ar e `operation: "delete"`, e reanunciar depois e
 * um anuncio novo. Por isso a acao passa por `podeDeletarNaOlx()` — enquanto o
 * Anderson nao decidir, a tarefa fica na fila em vez de apagar.
 *
 * `reativar_anuncio` NAO e implementado de proposito: reativar na OLX seria um
 * `insert` completo (titulo, corpo, preco, CEP, telefone, ate 20 imagens), o que
 * e republicar o anuncio, nao reverter uma pausa. Isso depende da RN-120, que
 * esta aberta.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { anuncios } from "@/lib/db/schema/anuncios";

import { importarOlx } from "./client";
import { podeDeletarNaOlx } from "./politica";
import { ErroPermanente } from "../retentativa";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";
import type { TarefaParaExecutor } from "../executores";

export async function executarAnuncioOlx(tarefa: TarefaParaExecutor): Promise<void> {
  if (tarefa.tipo !== "pausar_anuncio") {
    throw new ErroPermanente(
      `Na OLX so existe apagar. "${tarefa.tipo}" nao tem equivalente: reanunciar e um \`insert\` ` +
        "completo, que depende da RN-120 (⚠️ decisao do Anderson) e de todos os dados do anuncio.",
    );
  }

  const idExterno = tarefa.payload.id_externo;
  if (typeof idExterno !== "string" || idExterno.trim() === "") {
    throw new ErroPermanente(
      `Tarefa ${tarefa.id} nao tem \`id_externo\` — o anuncio nunca foi publicado na OLX.`,
    );
  }

  // Rede de seguranca. Na pratica este executor nem chega a ser registrado com
  // a delecao desligada (ver `executores.ts`) — mas uma acao IRREVERSIVEL sobre
  // anuncio real do cliente nao pode depender de um unico ponto de checagem.
  // Se alguem registrar este executor por outro caminho, a trava continua aqui.
  if (!podeDeletarNaOlx()) {
    throw new ErroPermanente(
      `Apagar anuncio na OLX esta DESLIGADO (OLX_DELETAR_AO_VENDER != "true"). A OLX nao tem ` +
        '"pausar": cumprir a RN-104 la significa apagar, e reanunciar depois perde id, posicao ' +
        "e visibilidade. Precisa da decisao do Anderson antes de ligar.",
    );
  }

  // Lote de um: a fila ja serializa, e agrupar tarefas de vendas diferentes
  // faria uma recusa da OLX derrubar o lote inteiro sem dizer qual anuncio
  // causou. Um por vez troca eficiencia por diagnostico — do jeito certo, para
  // uma operacao irreversivel.
  await importarOlx([{ id: idExterno, operation: "delete" }]);

  // A OLX ACEITOU o pedido; a remocao em si e assincrona (moderacao). Marcamos
  // `pausado` porque e o estado que pedimos e o mais proximo que o nosso enum
  // tem — mas a confirmacao real exigiria consultar o status da importacao pelo
  // `token`, que ainda nao fazemos (registrado em known-issues).
  if (tarefa.referenciaId) {
    await db
      .update(anuncios)
      .set({ status: "pausado", updated_at: new Date(), modified_by: USUARIO_SISTEMA_ID })
      .where(and(eq(anuncios.id, tarefa.referenciaId), eq(anuncios.is_deleted, false)));
  }
}
