# ADR-0002: Item com quantidade, e a trava de venda vira "nunca negativo"

- **Status**: Aceito
- **Data**: 2026-10-29
- **Decisores**: Paulo

## Contexto

O modelo partia de "todo item e peca unica de leilao": um item, uma venda. A
garantia contra vender duas vezes (RN-112) era um indice unico parcial,
`idx_pedidos_item_ativo`, que permitia **um** pedido ativo por item.

A importacao dos 67 anuncios da conta do ML (RN-123) mostrou que a operacao
nao e so peca unica: o rele tem 19 unidades disponiveis, e varios anuncios ja
venderam 3 ou 4 vezes. Com o indice, a segunda venda do rele seria recusada
como "venda concorrente", e o Estoque precisaria de 19 linhas iguais para
representa-lo.

## Decisao

`itens` ganha `quantidade` (inteiro, `>= 0`, padrao 1) e `pedidos` ganha
`quantidade` (`>= 1`, padrao 1). O indice `idx_pedidos_item_ativo` sai. No
lugar dele, a garantia de banco passa a ser `CHECK (quantidade >= 0)` em
`itens`, e o handler de venda baixa a quantidade no mesmo commit em que grava o
pedido. Quando a quantidade zera, o item vira `vendido` e os outros canais sao
pausados, como antes.

Itens ja `vendido` na migracao recebem `quantidade = 0`; os demais, 1. Nada
muda para peca unica.

## Alternativas Consideradas

- **Um item por unidade**: mantem o indice e as regras, mas o SKU deixa de ser
  unico por item (o indice `idx_itens_sku_ativo` teria de cair), e o rele vira
  19 linhas identicas no Estoque. Troca uma trava por outra e piora a tela.
- **Manter o indice e criar "itens irmaos"**: complexidade sem ganho; continua
  sendo um item por unidade com outro nome.
- **Trigger que baixa a quantidade em todo INSERT de pedido**: daria garantia
  de banco mesmo fora do handler, mas a importacao do historico (bloco D)
  precisa justamente gravar pedido SEM baixar, porque o ML ja descontou. A
  regra ficaria escondida num trigger e cheia de excecao.

## Consequencias

### Positivas
- O Estoque representa o que a conta do ML tem, com uma linha por SKU.
- Peca unica continua funcionando igual (`quantidade = 1`).
- A disputa pela ultima unidade continua barrada no banco (`23514`), e nao so
  na aplicacao.

### Negativas / Trade-offs
- **A garantia de banco ficou mais fraca.** O indice barrava qualquer segundo
  pedido, viesse de onde viesse. O `CHECK` so barra se quem grava o pedido
  tambem baixar a quantidade. Hoje so o handler de venda grava pedido, e ele
  baixa. Codigo novo que grave pedido precisa fazer o mesmo, ou explicar por
  que nao (ver RN-112).
- **Cancelamento nao devolve a unidade.** Antes, cancelar liberava o item pelo
  indice; agora seria preciso somar a quantidade de volta, e nao existe fluxo
  de cancelamento. Registrado em known-issues.
- A migracao remove um indice (`DROP INDEX`). Nao apaga dado.

### Neutras
- `pedidos.custo_na_venda` passa a ser custo unitario x quantidade, calculado
  em `pricing.ts` (`custoNaVenda`).
