/**
 * Handler de venda do Mercado Livre — RN-104, RN-112, RN-114, RN-115, RN-117.
 *
 * E o codigo mais perigoso do sistema: se ele errar, ou a mesma peca e vendida
 * duas vezes, ou uma venda some, ou o relatorio do mes mente. As garantias
 * estao em camadas, e nenhuma delas e opcional:
 *
 *  1. **O dado vem da API, nunca do corpo do webhook** (RN-117). A URL e
 *     publica; o POST so diz qual recurso olhar.
 *  2. **A conta precisa ser a nossa.** Pedido de outro vendedor e descartado.
 *  3. **Uma transacao, com `FOR UPDATE` no item** (RN-112). Dois webhooks
 *     simultaneos viram fila, nao corrida.
 *  4. **O indice unico e quem garante.** Se a serializacao falhar por qualquer
 *     motivo, o segundo INSERT levanta 23505 — e isso e tratado como
 *     "ja vendido", nao como erro 500.
 *  5. **A pausa nos outros canais vira TAREFA no mesmo commit** (RN-116), nunca
 *     chamada HTTP dentro da transacao.
 *  6. **Reprocessar e no-op** (RN-104): o mesmo pedido chegando de novo nao
 *     cria segunda venda nem pausa de novo.
 */
import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { anuncios } from "@/lib/db/schema/anuncios";
import { itens } from "@/lib/db/schema/itens";
import { pedidos } from "@/lib/db/schema/pedidos";
import { resultadoDaVenda } from "@/lib/pricing";

import { chamarML } from "./client";
import { lerPedidoML, STATUS_PAGO, type PedidoML } from "./pedido-ml";
import { enfileirar, type NovaTarefa } from "../tarefas";
import { ErroPermanente, codigoPostgres } from "../retentativa";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";
import type { EventoParaHandler } from "../handlers";

/** Código do Postgres para violacao de indice unico. */
const VIOLACAO_UNICO = "23505";

/**
 * Venda que o sistema olhou e decidiu nao registrar.
 *
 * Estende `ErroPermanente` porque nenhum destes casos muda por tentar de novo:
 * o vendedor continua sendo outro, o pedido continua nao pago, a peca continua
 * vendida. O worker marca como concluido com ressalva em vez de queimar as 5
 * tentativas e deixar ruido na lista do que precisa de gente.
 */
export class VendaIgnorada extends ErroPermanente {
  constructor(motivo: string) {
    super(motivo);
    this.name = "VendaIgnorada";
  }
}

/**
 * ⚠️ FRETE DE SAIDA = 0 ENQUANTO O ANDERSON NAO DECIDIR (RN-100 🔴).
 *
 * No ML, item acima de R$ 79 entra em frete gratis e o vendedor paga a
 * etiqueta — em equipamento de 40 kg saindo de Maringa, R$ 400 a R$ 900 que o
 * ML desconta do repasse. Gravar 0 deixa o `liquido` OTIMISTA nesse valor.
 *
 * Nao inventamos um numero: gravamos 0 e o pedido nasce com `conciliado_em`
 * nulo, ou seja, "a conferir". Assim a lacuna e visivel na tela em vez de virar
 * lucro imaginario no relatorio. Quando a politica for definida, o valor vem do
 * payload do ML e esta constante sai.
 */
const FRETE_SAIDA_ATE_DEFINIR = 0;

/** Onde o item foi parar: e o que decide se ha venda a registrar. */
async function localizarItem(idAnuncio: string) {
  const [achado] = await db
    .select({ itemId: anuncios.item_id, anuncioId: anuncios.id })
    .from(anuncios)
    .where(
      and(
        eq(anuncios.canal, "mercado_livre"),
        eq(anuncios.id_externo, idAnuncio),
        eq(anuncios.is_deleted, false),
      ),
    );
  return achado ?? null;
}

/**
 * Registra a venda. Idempotente: chamar duas vezes com o mesmo pedido nao cria
 * segundo registro nem enfileira segunda pausa.
 */
export async function registrarVendaML(pedido: PedidoML): Promise<"registrada" | "ja_registrada"> {
  const local = await localizarItem(pedido.idAnuncio);
  if (!local) {
    // Anuncio que nao e nosso, ou item que nunca foi sincronizado. Nao da para
    // adivinhar qual peca saiu do estoque — falhar e melhor que chutar.
    throw new Error(
      `Anuncio ${pedido.idAnuncio} nao encontrado em anuncios (canal mercado_livre). ` +
        "Sem o item nao ha o que dar baixa.",
    );
  }

  const dinheiro = resultadoDaVenda({
    valor: pedido.valor,
    canal: "mercado_livre",
    freteSaida: FRETE_SAIDA_ATE_DEFINIR,
    taxaInformada: pedido.taxaInformada,
  });
  if (!dinheiro) {
    throw new Error(`Valores da venda ${pedido.numero} nao formam numero valido.`);
  }

  try {
    return await db.transaction(async (tx) => {
      // SERIALIZA os webhooks concorrentes (RN-112, camada 2). Sem isto os dois
      // chegariam juntos no INSERT e um levaria 23505 — que funciona, mas vira
      // excecao onde cabia fila.
      const [item] = await tx
        .select({ id: itens.id, custo: itens.custo, situacao: itens.situacao })
        .from(itens)
        .where(and(eq(itens.id, local.itemId), eq(itens.is_deleted, false)))
        .for("update");

      if (!item) throw new Error(`Item ${local.itemId} nao existe ou foi excluido.`);

      // REPROCESSAMENTO: o mesmo pedido chegando de novo. Nao e erro — e o
      // comportamento normal de um canal que reentrega (RN-104).
      const [jaExiste] = await tx
        .select({ id: pedidos.id })
        .from(pedidos)
        .where(and(eq(pedidos.canal, "mercado_livre"), eq(pedidos.numero, pedido.numero)));
      if (jaExiste) return "ja_registrada" as const;

      const [criado] = await tx
        .insert(pedidos)
        .values({
          numero: pedido.numero,
          item_id: item.id,
          canal: "mercado_livre",
          vendido_em: pedido.vendidoEm,
          // RN-114: o custo e CONGELADO aqui. Corrigir `itens.custo` amanha nao
          // pode reescrever a margem de um mes ja fechado.
          custo_na_venda: item.custo,
          valor: pedido.valor.toFixed(2),
          taxa: dinheiro.taxa.toFixed(2),
          taxa_origem: pedido.taxaInformada === null ? null : pedido.taxaInformada.toFixed(2),
          comissao: dinheiro.comissao.toFixed(2),
          frete_saida: FRETE_SAIDA_ATE_DEFINIR.toFixed(2),
          liquido: dinheiro.liquido.toFixed(2),
          // conciliado_em fica NULO: a taxa pode ser estimada e a base da
          // comissao nao foi confirmada. Nasce "a conferir", nao como verdade.
          modified_by: USUARIO_SISTEMA_ID,
        })
        .returning({ id: pedidos.id });

      // RN-104: baixa no estoque E saida do site publico, no MESMO update.
      //
      // Tirar do site e operacao INTERNA (`itens.exibir_no_site`), sem API de
      // terceiro — entao ela pertence a esta transacao, nao ao outbox. Enfileirar
      // como tarefa (que foi o desenho inicial) criava uma janela em que o item
      // estava vendido e AINDA NO AR na vitrine, esperando um worker, sem motivo
      // nenhum. O outbox existe para o que sai para fora; o que e nosso resolve
      // aqui, atomico.
      await tx
        .update(itens)
        .set({
          situacao: "vendido",
          exibir_no_site: false,
          updated_at: new Date(),
          modified_by: USUARIO_SISTEMA_ID,
        })
        .where(eq(itens.id, item.id));

      // RN-104 + RN-116: o que precisa sair para OUTRO SISTEMA vira tarefa, no
      // mesmo commit. Nunca HTTP aqui dentro — transacao aberta esperando
      // terceiro segura lock de linha e envenena o pool.
      const outros = await tx
        .select({ id: anuncios.id, canal: anuncios.canal, idExterno: anuncios.id_externo })
        .from(anuncios)
        .where(
          and(
            eq(anuncios.item_id, item.id),
            ne(anuncios.canal, "mercado_livre"),
            eq(anuncios.is_deleted, false),
            ne(anuncios.status, "pausado"),
          ),
        );

      const motivo = `pedido:${criado.id}`;
      const tarefas: NovaTarefa[] = outros.map((a) => ({
        canal: a.canal,
        tipo: "pausar_anuncio" as const,
        referenciaId: a.id,
        motivo,
        payload: { id_externo: a.idExterno, item_id: item.id },
      }));

      await enfileirar(tx, tarefas);

      return "registrada" as const;
    });
  } catch (erro) {
    // CAMADA 4: a garantia final. Se a serializacao falhou por qualquer motivo,
    // o indice unico parcial `idx_pedidos_item_ativo` levanta 23505 — e isso
    // significa "esta peca ja foi vendida", nao falha de sistema. Vira erro
    // tratado e o evento sai da fila em vez de ficar retentando para sempre.
    //
    // `codigoPostgres` anda a cadeia de `cause`: o drizzle EMBRULHA o erro do
    // driver, entao `erro.code` no topo e undefined e o 23505 mora la embaixo.
    // Testar so o topo deixava a violacao escapar como erro generico.
    if (codigoPostgres(erro) === VIOLACAO_UNICO) {
      throw new VendaIgnorada(
        `Item do anuncio ${pedido.idAnuncio} ja tem pedido ativo — venda concorrente em outro ` +
          "canal. Decisao COMERCIAL: cancelar no canal perdedor e avisar o Anderson (RN-112).",
      );
    }
    throw erro;
  }
}

/**
 * O handler que o worker chama. Busca o pedido na API e delega.
 *
 * Lane `urgente`: venda nao espera atras de varredura de reputacao.
 */
export async function handlerVendaML(evento: EventoParaHandler): Promise<void> {
  if (!evento.recurso) {
    throw new Error("Evento de venda sem `recurso` — nao ha o que buscar na API do ML.");
  }

  const bruto = await chamarML<unknown>(evento.recurso, { lane: "urgente" });
  const pedido = lerPedidoML(bruto);

  // RN-117: descartar o que nao e da conta conectada. Sem esta checagem, um
  // POST forjado apontando para um pedido de OUTRO vendedor faria o sistema
  // dar baixa num item nosso por causa de uma venda que nao e nossa.
  const nossa = await contaConectada();
  if (nossa && pedido.idVendedor && pedido.idVendedor !== nossa) {
    throw new VendaIgnorada(
      `Pedido ${pedido.numero} e do vendedor ${pedido.idVendedor}, e a conta conectada e ${nossa}.`,
    );
  }

  // RN-115: so venda PAGA vira pedido. Os outros estados existem e chegam —
  // `payment_required`, `cancelled` — e cada um pede tratamento proprio, que
  // ainda nao foi desenhado. Ignorar explicitamente e melhor que registrar
  // venda que nao aconteceu.
  if (pedido.status !== STATUS_PAGO) {
    throw new VendaIgnorada(
      `Pedido ${pedido.numero} esta em "${pedido.status}", nao em "${STATUS_PAGO}".`,
    );
  }

  await registrarVendaML(pedido);
}

/** Id da conta do ML hoje conectada. `null` quando nao ha credencial. */
async function contaConectada(): Promise<string | null> {
  const [linha] = await db.execute<{ conta: string | null }>(sql`
    SELECT conta_externa_id AS conta
    FROM integracoes_credenciais
    WHERE canal = 'mercado_livre' AND is_deleted = false
    LIMIT 1
  `).then((r) => r.rows);

  return linha?.conta ?? null;
}
