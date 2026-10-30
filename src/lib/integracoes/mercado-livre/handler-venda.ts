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
 *  4. **O banco e quem garante** (ADR-0002). A venda baixa `itens.quantidade`
 *     no mesmo commit do pedido, e o `CHECK (quantidade >= 0)` recusa vender
 *     unidade que nao existe (23514) — tratado como "sem estoque", nao 500.
 *     So a venda que ZERA o item o marca como vendido e pausa os outros canais.
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
import { custoNaVenda, resultadoDaVenda } from "@/lib/pricing";

import { atualizarPedidoML } from "./atualizacao-envios";
import { chamarML } from "./client";
import { lerPedidoML, STATUS_PAGO, type PedidoML } from "./pedido-ml";
import { enfileirar, type NovaTarefa } from "../tarefas";
import { ErroPermanente, codigoPostgres } from "../retentativa";
import { USUARIO_SISTEMA_ID } from "../usuario-sistema";
import type { EventoParaHandler } from "../handlers";

/** Códigos do Postgres: violacao de indice unico e de CHECK. */
const VIOLACAO_UNICO = "23505";
const VIOLACAO_CHECK = "23514";

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
    .select({ itemId: anuncios.item_id, anuncioId: anuncios.id, contadoAte: anuncios.contado_ate })
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
        .select({
          id: itens.id,
          custo: itens.custo,
          situacao: itens.situacao,
          quantidade: itens.quantidade,
        })
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

      // RN-124: venda ANTERIOR a importacao que gerou este item. A quantidade
      // veio do ML ja sem ela — baixar de novo tiraria unidade que existe.
      // Vira pedido (historico, relatorio do mes), sem baixa e sem pausar nada.
      const jaContada = local.contadoAte !== null && pedido.vendidoEm <= local.contadoAte;

      // RN-112, camada 2: com a linha travada, a conta e exata. Faltando
      // unidade, outra venda chegou antes — e nao ha o que dar baixa.
      if (!jaContada && item.quantidade < pedido.quantidade) {
        throw new VendaIgnorada(
          `Estoque insuficiente para o pedido ${pedido.numero}: pediu ${pedido.quantidade}, ` +
            `restam ${item.quantidade}. Venda concorrente — decisao COMERCIAL: cancelar no ` +
            "canal perdedor e avisar o Anderson (RN-112).",
        );
      }

      // RN-114: o custo e CONGELADO aqui, ja multiplicado pelas unidades.
      // Corrigir `itens.custo` amanha nao pode reescrever um mes ja fechado.
      const custoDoPedido = custoNaVenda(item.custo, pedido.quantidade);
      if (!custoDoPedido) {
        throw new Error(`Custo do item ${item.id} nao forma numero valido (${item.custo}).`);
      }
      const restante = item.quantidade - pedido.quantidade;

      const [criado] = await tx
        .insert(pedidos)
        .values({
          numero: pedido.numero,
          item_id: item.id,
          canal: "mercado_livre",
          vendido_em: pedido.vendidoEm,
          quantidade: pedido.quantidade,
          // RN-126: cancelar so devolve sozinho a unidade que esta venda tirou.
          baixou_estoque: !jaContada,
          custo_na_venda: custoDoPedido,
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

      if (jaContada) return "registrada" as const;

      // RN-112, camada 1: a baixa e `quantidade - N` NO BANCO, nao o numero
      // calculado acima. Se algo furou a trava da linha, o resultado negativo
      // esbarra no CHECK e o Postgres recusa (23514, tratado abaixo).
      //
      // RN-104: quando zera, baixa E saida do site publico no MESMO update.
      // Tirar do site e operacao INTERNA (`itens.exibir_no_site`), sem API de
      // terceiro — entao pertence a esta transacao, nao ao outbox. Enfileirar
      // como tarefa criava uma janela com o item vendido e AINDA NA VITRINE.
      await tx
        .update(itens)
        .set({
          quantidade: sql`${itens.quantidade} - ${pedido.quantidade}`,
          ...(restante === 0 ? { situacao: "vendido" as const, exibir_no_site: false } : {}),
          updated_at: new Date(),
          modified_by: USUARIO_SISTEMA_ID,
        })
        .where(eq(itens.id, item.id));

      // Ainda ha unidades: os outros canais continuam vendendo (ADR-0002).
      if (restante > 0) return "registrada" as const;

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
    // A garantia final, quando a serializacao falhou por qualquer motivo.
    //
    // `codigoPostgres` anda a cadeia de `cause`: o drizzle EMBRULHA o erro do
    // driver, entao `erro.code` no topo e undefined e o codigo mora la embaixo.
    // Testar so o topo deixava a violacao escapar como erro generico.
    const codigo = codigoPostgres(erro);

    // 23514 = o CHECK de `itens.quantidade` recusou ficar negativo: a ultima
    // unidade foi para outra venda (RN-112). Vira erro tratado e sai da fila.
    if (codigo === VIOLACAO_CHECK) {
      throw new VendaIgnorada(
        `Item do anuncio ${pedido.idAnuncio} sem unidades — venda concorrente em outro canal. ` +
          "Decisao COMERCIAL: cancelar no canal perdedor e avisar o Anderson (RN-112).",
      );
    }
    // 23505 so vem de `idx_pedidos_canal_numero`: o MESMO pedido processado em
    // paralelo. O outro processo ja registrou — e reentrega, nao venda nova.
    if (codigo === VIOLACAO_UNICO) return "ja_registrada";
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

  // Pedido que JA existe aqui: a notificacao e de mudanca (envio, entrega,
  // cancelamento). Atualiza o status e para — nao e venda nova.
  if ((await atualizarPedidoML(pedido.numero, { lane: "urgente", pedidoBruto: bruto })) !== "ausente") {
    return;
  }

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

  // Grava o envio e o status de saida. Falhar aqui NAO desfaz a venda (ja
  // comitada): a conferencia de 15 min corrige na proxima passada.
  await atualizarPedidoML(pedido.numero, { lane: "urgente", pedidoBruto: bruto }).catch((erro) =>
    console.warn(`[venda-ml] pedido ${pedido.numero}: status de envio fica para a conferencia`, erro),
  );
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
