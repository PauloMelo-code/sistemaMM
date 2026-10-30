/**
 * QUARENTENA: tudo o que este sistema presume sobre o FORMATO do pedido do
 * Mercado Livre esta neste arquivo, e em nenhum outro.
 *
 * ⚠️ NAO VERIFICADO CONTRA UM PEDIDO REAL. A documentacao oficial do ML bloqueia
 * leitura automatizada (403) e nao existe credencial para buscar um pedido de
 * verdade. Os nomes de campo abaixo sao a melhor leitura disponivel, nao fato
 * confirmado. **Na primeira conexao real, confira este arquivo contra um pedido
 * de verdade antes de confiar no numero.**
 *
 * POR ISSO A VALIDACAO E ESTRITA. Campo obrigatorio ausente ou com tipo errado
 * faz `lerPedidoML` LANCAR, e o evento fica na fila com erro. A alternativa —
 * aceitar o que veio e gravar zero em `valor` ou `vendido_em` — produziria uma
 * venda que parece certa no painel e nao existe no extrato. Falhar alto e
 * recuperavel; dinheiro errado gravado em silencio, nao.
 *
 * Modulo PURO: nao chama rede, nao chama banco. So recebe JSON e devolve dados
 * ou excecao — por isso da para testar cada formato quebrado sem ML nenhum.
 */

/** O que o handler de venda precisa saber de um pedido do ML. */
export interface PedidoML {
  /** Numero do pedido no canal. Vira `pedidos.numero`. */
  numero: string;
  /** Id do anuncio (MLB...). E por ele que achamos o nosso item. */
  idAnuncio: string;
  /** Unidades compradas (ADR-0002). E o que a venda baixa do estoque. */
  quantidade: number;
  /** Quando a venda aconteceu NO CANAL — nunca a hora da nossa gravacao. */
  vendidoEm: Date;
  /** Bruto cobrado do comprador. */
  valor: number;
  /** Taxa que o ML informou. `null` quando o payload nao traz. */
  taxaInformada: number | null;
  /** Id do vendedor no ML — para descartar pedido de outra conta. */
  idVendedor: string | null;
  /** Status cru, como veio. O handler decide o que fazer com cada um. */
  status: string;
}

export class PedidoMLInvalidoError extends Error {
  constructor(motivo: string) {
    super(
      `Pedido do Mercado Livre em formato inesperado: ${motivo}. ` +
        "O mapeamento vive em src/lib/integracoes/mercado-livre/pedido-ml.ts e NAO foi " +
        "verificado contra um pedido real — confira o payload antes de mexer no resto.",
    );
    this.name = "PedidoMLInvalidoError";
  }
}

/** Status em que a venda esta paga e vale registrar pedido. */
export const STATUS_PAGO = "paid";

type Json = Record<string, unknown>;

const objeto = (v: unknown): Json | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

/** Numero utilizavel como dinheiro: finito e nao negativo. */
const numero = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

const texto = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim() !== "") return v;
  // O ML manda id como numero em varios lugares; virar string aqui evita
  // comparacao de tipos diferentes la na frente.
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

/**
 * Le e valida o payload. Lanca `PedidoMLInvalidoError` no que nao servir.
 *
 * MULTI-ITEM E RECUSADO de proposito. O modelo da casa e um pedido = um item
 * (`pedidos.item_id` e NOT NULL), com `quantidade` unidades dele (ADR-0002).
 * Um pedido com dois ANUNCIOS diferentes nao tem representacao aqui, e
 * "processar so o primeiro" perderia uma venda em silencio. Recusar deixa o
 * evento na fila com erro visivel, para alguem decidir.
 */
export function lerPedidoML(payload: unknown): PedidoML {
  const raiz = objeto(payload);
  if (!raiz) throw new PedidoMLInvalidoError("o corpo nao e um objeto JSON");

  const numeroPedido = texto(raiz.id);
  if (!numeroPedido) throw new PedidoMLInvalidoError("sem `id`");

  const status = texto(raiz.status);
  if (!status) throw new PedidoMLInvalidoError("sem `status`");

  const itens = Array.isArray(raiz.order_items) ? raiz.order_items : null;
  if (!itens || itens.length === 0) {
    throw new PedidoMLInvalidoError("sem `order_items`");
  }
  if (itens.length > 1) {
    throw new PedidoMLInvalidoError(
      `o pedido tem ${itens.length} itens e o sistema modela um pedido por peca ` +
        "(item de leilao e peca unica) — precisa de decisao de produto, nao de codigo",
    );
  }

  const linha = objeto(itens[0]);
  const anuncio = linha ? objeto(linha.item) : null;
  const idAnuncio = anuncio ? texto(anuncio.id) : null;
  if (!idAnuncio) throw new PedidoMLInvalidoError("sem `order_items[0].item.id`");

  // Obrigatoria: assumir 1 quando o campo falta baixaria o estoque errado num
  // pedido de varias unidades — e estoque errado e o que a RN-112 existe para
  // impedir.
  const quantidade = linha ? numero(linha.quantity) : null;
  if (quantidade === null || !Number.isInteger(quantidade) || quantidade < 1) {
    throw new PedidoMLInvalidoError("`order_items[0].quantity` ausente ou invalida");
  }

  const valor = numero(raiz.total_amount);
  if (valor === null) throw new PedidoMLInvalidoError("`total_amount` ausente ou invalido");

  // `date_closed` e quando a venda fechou; `date_created`, quando o pedido
  // nasceu. Preferimos a primeira e caimos na segunda — mas NUNCA em `now()`:
  // datar pela nossa gravacao joga a venda no mes errado e leva a comissao
  // junto (RN-114).
  const dataCrua = texto(raiz.date_closed) ?? texto(raiz.date_created);
  if (!dataCrua) throw new PedidoMLInvalidoError("sem `date_closed` nem `date_created`");
  const vendidoEm = new Date(dataCrua);
  if (Number.isNaN(vendidoEm.getTime())) {
    throw new PedidoMLInvalidoError(`data de venda ilegivel: ${dataCrua}`);
  }

  return {
    numero: numeroPedido,
    idAnuncio,
    quantidade,
    vendidoEm,
    valor,
    // OPCIONAL: sem ela o pedido nasce com taxa estimada e "a conferir", que e
    // um estado honesto. Por isso nao derruba a leitura.
    taxaInformada: linha ? numero(linha.sale_fee) : null,
    idVendedor: texto(objeto(raiz.seller)?.id),
    status,
  };
}
