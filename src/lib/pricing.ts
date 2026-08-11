/**
 * FONTE UNICA DE CALCULO DE PRECO DO SISTEMA (RN-100).
 *
 * Toda tela que calcula dinheiro IMPORTA daqui. Copiar esta logica para dentro
 * de um componente, de uma server action ou de uma query e **bug de dinheiro** —
 * duas copias divergem em silencio e o sistema passa a sugerir preco que da
 * prejuizo. Se faltar algo, estenda este arquivo; nao reescreva a formula em
 * outro lugar.
 *
 * COBERTURA HOJE: preco sugerido (Calculadora, "preco alvo" do Estoque) e lance
 * maximo no leilao. AINDA NAO COBERTO: a margem liquida de um anuncio que ja tem
 * preco (RN-103, coluna Margem da tela de Anuncios: verde >=30%, ambar abaixo).
 * E a inversao `margem = 1 - taxa - COMISSAO - base/preco`. Quando a tela de
 * Anuncios entrar, essa funcao nasce AQUI — nunca no componente.
 *
 * Formula (RN-100):
 *   base  = custo + freteEntrada + freteSaida
 *   d     = 1 - taxa_canal - COMISSAO - margem
 *   preco = base / d          (somente se d > D_MINIMO; senao a UI exibe "—")
 *   lucro = preco * margem
 *
 * DOIS FRETES, e eles NAO sao a mesma coisa:
 *   - `freteEntrada` — trazer o lote do leilao ate o galpao. Custo de aquisicao,
 *     acontece sempre, independe de canal e de haver venda.
 *   - `freteSaida`   — enviar a peca ao comprador, QUANDO a MM paga. No Mercado
 *     Livre, item acima de R$ 79 entra em frete gratis e quem paga a etiqueta e
 *     o VENDEDOR: o ML desconta do repasse. Num autorrefrator de ~40 kg saindo
 *     de Maringa isso e R$ 400 a R$ 900 — em equipamento pesado, come de 10% a
 *     30% do lucro que a tela mostra.
 *
 * Os dois entram na base porque os dois saem do bolso da MM. Se o comprador e
 * quem paga o envio (retirada em maos, combinado no WhatsApp), `freteSaida` e 0.
 *
 * ⚠️ Quem decide se `freteSaida` e 0 e o CHAMADOR, nao este modulo. Em qual
 * canal a MM absorve o frete e decisao do Anderson e ainda esta em aberto
 * (docs/known-issues.md). Por isso o campo e OBRIGATORIO: sem valor padrao,
 * nenhuma tela consegue esquecer dele sem o TypeScript reclamar.
 *
 * Modulo PURO: nao importa banco, nao importa React, nao le env. So numero.
 */

/**
 * Canais de venda. Os literais sao os MESMOS do enum `canal` do banco
 * (src/lib/db/schema/anuncios.ts, compartilhado por anuncios, perguntas e
 * pedidos) — de proposito: assim `calcularPreco({ canal: pedido.canal })`
 * compila direto, sem de-para. Um de-para escrito dentro de componente ou
 * action seria regra de dinheiro duplicada, que e o que a RN-100 proibe.
 *
 * "whatsapp" e a venda direta. Na TELA o rotulo e "Venda direta/WhatsApp"
 * (handoff README:68) — rotulo e texto de UI, nao identificador.
 */
export type Canal = "mercado_livre" | "olx" | "whatsapp";

/**
 * Taxa que cada canal retem sobre o preco de venda (RN-102).
 *
 * ⚠️ PENDENTE (docs/known-issues.md): os 14% do Mercado Livre NAO estao
 * confirmados — a taxa do ML varia por categoria e por tipo de anuncio
 * (classico x premium). Enquanto o Anderson nao confirmar se 14% cobre o
 * catalogo da MM, este valor e uma aproximacao.
 *
 * ⚠️ Estes numeros (e COMISSAO) devem virar CONFIGURACAO — tabela de
 * parametros + tela de edicao — assim que existir a tela. Ate la ficam aqui,
 * em um lugar so, nunca espalhados como literal pelo codigo.
 */
export const TAXA_CANAL: Record<Canal, number> = {
  mercado_livre: 0.14,
  olx: 0.05,
  whatsapp: 0, // venda direta: nenhum marketplace retem taxa
};

/** Comissao da agencia: 4% sobre toda venda, em qualquer canal (RN-102). */
export const COMISSAO = 0.04;

/**
 * Piso do divisor. Com d <= 0.05 o preco explode (base/0.01 = 100x a base) e o
 * numero deixa de ter sentido comercial — a UI mostra "—" em vez de um preco
 * absurdo. Nao e erro do usuario: e margem pedida alta demais para o canal.
 */
export const D_MINIMO = 0.05;

/** O que a UI mostra quando o calculo nao e possivel. */
export const SEM_VALOR = "—";

export interface EntradaPreco {
  /** Custo de arremate do item, em reais. */
  custo: number;
  /** Frete de ENTRADA: trazer o lote do leilao ate o galpao. */
  freteEntrada: number;
  /** Frete de SAIDA: enviar ao comprador, quando a MM paga. 0 se o comprador paga. */
  freteSaida: number;
  /** Margem desejada, de 0 a 1 (0.25 = 25%). */
  margem: number;
  canal: Canal;
}

export interface EntradaLance {
  /** Preco de venda que se pretende praticar, em reais. */
  preco: number;
  /** Frete de ENTRADA: trazer o lote do leilao ate o galpao. */
  freteEntrada: number;
  /** Frete de SAIDA estimado para este canal. 0 se o comprador paga. */
  freteSaida: number;
  /** Margem desejada, de 0 a 1. */
  margem: number;
  canal: Canal;
}

/**
 * Uniao discriminada: quando `disponivel` e false, `preco` e `lucro` sao
 * `null` — nunca NaN, nunca excecao. A UI so precisa de
 * `formatarBRL(resultado.preco)`, que ja devolve "—".
 */
export type ResultadoPreco =
  | { disponivel: true; preco: number; lucro: number }
  | { disponivel: false; preco: null; lucro: null };

const INDISPONIVEL: ResultadoPreco = { disponivel: false, preco: null, lucro: null };

/** Valor monetario valido: finito e nao negativo. */
const valorValido = (v: number): boolean => Number.isFinite(v) && v >= 0;

/** Margem valida: fracao em [0, 1). Margem >= 1 nao existe nesta formula. */
const margemValida = (m: number): boolean => Number.isFinite(m) && m >= 0 && m < 1;

/** O divisor `d` da RN-100. Unico ponto onde taxa, comissao e margem se somam. */
function divisor(canal: Canal, margem: number): number {
  return 1 - TAXA_CANAL[canal] - COMISSAO - margem;
}

/**
 * Preco sugerido e lucro para um custo, frete, margem e canal (RN-100).
 *
 * RN-101 — `lucro = preco * margem` ESTA CORRETO. Parece faltar descontar custo
 * e taxas, mas nao falta: de `preco * (1 - t - c - m) = base` sai
 * `preco - base - preco*t - preco*c = preco*m`. O lado esquerdo E o lucro
 * liquido. Quem "corrigir" para `preco - custo - frete - taxas` passa a
 * descontar duas vezes e mostra lucro errado. Nao mexa — o teste
 * `identidade RN-101` existe para travar isso.
 *
 * Entrada invalida (NaN, negativa, margem fora de [0,1)) devolve indisponivel
 * em vez de propagar NaN para a tela de dinheiro.
 */
export function calcularPreco({
  custo, freteEntrada, freteSaida, margem, canal,
}: EntradaPreco): ResultadoPreco {
  if (
    !valorValido(custo) ||
    !valorValido(freteEntrada) ||
    !valorValido(freteSaida) ||
    !margemValida(margem)
  ) {
    return INDISPONIVEL;
  }

  const d = divisor(canal, margem);
  // `!(d > D_MINIMO)` e nao `d <= D_MINIMO`: pega tambem d = NaN, que acontece
  // quando chega um canal fora de TAXA_CANAL por um caminho sem tipo — payload
  // de webhook, JSON de action, cast. Sem isso, NaN vazaria para a tela como
  // um preco "disponivel".
  if (!(d > D_MINIMO)) return INDISPONIVEL;

  const preco = (custo + freteEntrada + freteSaida) / d;
  // As parcelas podem ser finitas e a SOMA estourar para Infinity. Sem
  // esta guarda o tipo mentiria: `disponivel: true` com preco Infinity. Nao e
  // realista num leilao, mas o contrato deste modulo e "disponivel => numero
  // valido", e quem consumir o resultado (somar, comparar, gravar preco_alvo)
  // confia nele.
  if (!Number.isFinite(preco)) return INDISPONIVEL;

  return { disponivel: true, preco, lucro: preco * margem };
}

/**
 * LEITURA INVERSA — o uso comercial mais importante da formula: dado o preco de
 * venda que o mercado aceita, qual e o LANCE MAXIMO no leilao (custo maximo de
 * arremate) que ainda entrega a margem desejada.
 *
 * Isola `custo` na RN-100:  custo = preco * d - freteEntrada - freteSaida
 *
 * OS DOIS FRETES ENTRAM AQUI. Esquecer o de saida infla o lance maximo: o
 * Anderson daria um lance mais alto do que a peca aguenta e descobriria no
 * extrato. Em equipamento pesado a diferenca e de centenas de reais por item.
 *
 * Devolve `null` (a UI mostra "—") quando o calculo nao existe:
 * - `d <= D_MINIMO` (margem alta demais para o canal);
 * - custo maximo negativo — nem de graca o item fecha essa margem com esses
 *   fretes, ou seja, nao ha lance viavel.
 */
export function lanceMaximo({
  preco, freteEntrada, freteSaida, margem, canal,
}: EntradaLance): number | null {
  if (
    !valorValido(preco) ||
    !valorValido(freteEntrada) ||
    !valorValido(freteSaida) ||
    !margemValida(margem)
  ) {
    return null;
  }

  const d = divisor(canal, margem);
  if (!(d > D_MINIMO)) return null; // idem calcularPreco: cobre d = NaN

  const custoMaximo = preco * d - freteEntrada - freteSaida;
  return custoMaximo >= 0 ? custoMaximo : null;
}

/**
 * MARGEM DE UM ANUNCIO QUE JA TEM PRECO (RN-103) — a leitura inversa da RN-100.
 *
 * `calcularPreco` responde "por quanto anunciar para ter margem X". Esta
 * responde o contrario: "dado que esta anunciado por Y, que margem sobra?".
 *
 *   preco * (1 - taxa - COMISSAO - margem) = base
 *   =>  margem = 1 - taxa - COMISSAO - base/preco
 *
 * ⚠️ MARGEM E DADO DERIVADO DE CUSTO. Quem nao pode ver custo nao pode ver
 * margem (RN-107) — o numero revela o custo por aritmetica simples. O filtro e
 * de SERVIDOR: ver `podeVerCusto` em `src/lib/auth/rbac.ts`.
 *
 * ⚠️ A `base` que voce passar decide se o numero e honesto. Hoje o sistema NAO
 * guarda frete por item (lacuna registrada em known-issues), entao a tela de
 * Anuncios passa so o custo — e o resultado **superestima** a margem, em
 * equipamento pesado por varios pontos. Nao "arredonde para bonito": mostre o
 * numero com a ressalva, que e o que permite alguem cobrar o frete que falta.
 *
 * Devolve `null` quando a conta nao existe (preco zero ou invalido) — a UI
 * mostra "—" em vez de um percentual inventado.
 */
export function margemDoAnuncio({
  preco,
  base,
  canal,
}: {
  /** Preco anunciado. */
  preco: number;
  /** Custo + fretes que a MM banca. Ver a ressalva acima. */
  base: number;
  canal: Canal;
}): number | null {
  if (!valorValido(preco) || !valorValido(base)) return null;
  // Preco zero nao e "margem zero": e divisao por zero. A tela mostra "—".
  if (preco <= 0) return null;

  const taxa = TAXA_CANAL[canal];
  if (!Number.isFinite(taxa)) return null; // canal fora da tabela, vindo sem tipo

  const margem = 1 - taxa - COMISSAO - base / preco;
  return Number.isFinite(margem) ? margem : null;
}

/** Piso da RN-103: margem >= 30% e verde; abaixo, ambar. */
export const MARGEM_SAUDAVEL = 0.3;

/**
 * O dinheiro REALIZADO de uma venda que ja aconteceu.
 *
 * Nao confundir com `calcularPreco`: aquela responde "por quanto devo anunciar";
 * esta responde "quanto sobrou desta venda". Sao perguntas diferentes e as duas
 * moram aqui pelo mesmo motivo — se a subtracao do liquido for reescrita dentro
 * do handler de venda ou da tela de Pedidos, e bug de dinheiro por duplicacao.
 *
 *   taxa     = o que o CANAL informou; sem informacao, valor x TAXA_CANAL
 *   comissao = valor x COMISSAO (4%)
 *   liquido  = valor - taxa - comissao - freteSaida
 *
 * ⚠️ DUAS PREMISSAS EM ABERTO, e as duas mexem no numero:
 *
 * 1. **Base da comissao** (RN-108 🔴). A comissao aqui incide sobre o BRUTO,
 *    que e o que o rodape do prototipo sugere (R$ 38.400 -> R$ 1.536). Se o
 *    Anderson confirmar que e sobre o liquido de taxas, muda ESTA linha e mais
 *    nenhuma — foi para isso que a conta saiu de dentro do handler.
 * 2. **Taxa do ML** (RN-102 🔴). Os 14% nao estao confirmados e variam por
 *    categoria. Por isso `taxaInformada` tem precedencia: numero do canal vale
 *    mais que suposicao nossa, sempre. Quando ele falta, `taxaEstimada` sai
 *    `true` — e o pedido nasce como "a conferir" em vez de virar verdade.
 */
export interface EntradaVenda {
  /** Valor bruto da venda, como o canal cobrou do comprador. */
  valor: number;
  canal: Canal;
  /**
   * Frete de saida efetivamente pago pela MM. OBRIGATORIO pelo mesmo motivo do
   * resto do modulo: no ML, item acima de R$ 79 tem a etiqueta descontada do
   * repasse, e esquecer isso infla o liquido em centenas de reais por venda.
   */
  freteSaida: number;
  /** A taxa que o canal informou nesta venda. `null` quando ele nao informa. */
  taxaInformada?: number | null;
}

export interface ResultadoVenda {
  taxa: number;
  comissao: number;
  liquido: number;
  /** `true` = a taxa saiu da NOSSA suposicao, nao do canal. Nasce "a conferir". */
  taxaEstimada: boolean;
}

export function resultadoDaVenda({
  valor,
  canal,
  freteSaida,
  taxaInformada = null,
}: EntradaVenda): ResultadoVenda | null {
  if (!valorValido(valor) || !valorValido(freteSaida)) return null;

  const informouTaxa = taxaInformada !== null && valorValido(taxaInformada);
  const taxa = informouTaxa ? (taxaInformada as number) : valor * TAXA_CANAL[canal];
  if (!Number.isFinite(taxa)) return null; // canal fora de TAXA_CANAL por um caminho sem tipo

  const comissao = valor * COMISSAO;

  return {
    taxa,
    comissao,
    liquido: valor - taxa - comissao - freteSaida,
    taxaEstimada: !informouTaxa,
  };
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formatador pt-BR SEM CENTAVOS (design-system.md: dinheiro em Archivo, pt-BR
 * sem centavos). Aceita `null` e devolve "—", para a UI nao repetir ternario a
 * cada celula.
 */
export function formatarBRL(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return SEM_VALOR;
  // `valor === 0` normaliza o zero negativo: sem isso `formatarBRL(-0)` sai
  // "-R$ 0" e a tela mostra prejuizo onde nao ha nada. E alcancavel — margem
  // -0 (que `JSON.parse("-0")` produz) faz `lucro = preco * -0 = -0`.
  return BRL.format(valor === 0 ? 0 : valor);
}
