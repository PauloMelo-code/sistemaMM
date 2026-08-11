/**
 * A politica que decide se o sistema pode APAGAR anuncio na OLX — parte PURA.
 *
 * POR QUE ISTO EXISTE COMO DECISAO EXPLICITA:
 *
 * A RN-104 manda **pausar** o anuncio nos outros canais quando o item vende. Na
 * OLX **nao existe pausar**: as operacoes da API de autoupload sao `insert` e
 * `delete`. Tirar do ar significa APAGAR, e reanunciar depois e um `insert`
 * novo — o anuncio perde id, posicao e a visibilidade que acumulou.
 *
 * Ou seja: cumprir a RN-104 na OLX exige uma acao mais destrutiva do que a
 * regra descreve. Isso e decisao do Anderson, nao do codigo — e casa com a
 * RN-120 (⚠️ aberta): se a venda for cancelada, o anuncio da OLX nao "volta",
 * tem que ser recriado do zero.
 *
 * Enquanto a decisao nao vier, a delecao fica DESLIGADA. A tarefa continua
 * pendente e visivel em `aguardandoExecutor` — atraso e recuperavel, anuncio
 * apagado por engano nao e.
 */

/**
 * O sistema esta autorizado a apagar anuncio na OLX ao vender?
 *
 * Falha FECHADA: qualquer coisa que nao seja o literal `"true"` — variavel
 * ausente, vazia, "1", "sim", "TRUE" com espaco — significa NAO. Numa acao
 * irreversivel sobre anuncio real do cliente, exigir a palavra exata e barato;
 * aceitar "quase" nao e.
 */
export function podeDeletarNaOlx(valor = process.env.OLX_DELETAR_AO_VENDER): boolean {
  return valor === "true";
}
