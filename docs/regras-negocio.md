# Regras de Negocio do Cliente

## Como Usar Este Documento

Este arquivo e o registro oficial de TODAS as regras de negocio definidas pelo cliente.
Toda vez que uma regra nova for definida, ela DEVE ser adicionada aqui.
Agentes IA devem consultar este arquivo antes de implementar qualquer logica.

## Formato de Registro

Cada regra segue este formato:

```
### RN-[NUMERO] - [Titulo da Regra]
- **Definida por**: [Nome do cliente/stakeholder]
- **Data**: [YYYY-MM-DD]
- **Modulo**: [Qual parte do sistema]
- **Descricao**: [O que acontece]
- **Comportamento esperado**: [Como o sistema deve reagir]
- **Impacto se descumprida**: [O que da errado se nao seguir]
```

---

## Regras Globais (aplicam a todos os projetos)

### RN-001 - Exclusao Sempre Logica
- **Definida por**: Lucas Dettenborn
- **Data**: 2026-05-15
- **Modulo**: Todos
- **Descricao**: Nenhum registro pode ser excluido fisicamente do banco de dados
- **Comportamento esperado**: Ao excluir, marcar `is_deleted = true` e `deleted_at = now()`. Registro permanece no banco
- **Impacto se descumprida**: Perda de dados, impossibilidade de auditoria, cliente diz que "sumiu coisa"

### RN-002 - Rastreabilidade de Acoes
- **Definida por**: Lucas Dettenborn
- **Data**: 2026-05-15
- **Modulo**: Todos
- **Descricao**: Toda acao de criar, alterar ou excluir deve registrar quem fez e quando
- **Comportamento esperado**: Tabela de auditoria com user_id, acao, timestamp, dados anteriores e novos
- **Impacto se descumprida**: Impossibilidade de identificar origem de problemas

### RN-003 - Validacao Pre-Salvamento com Modal Block
- **Definida por**: Lucas Dettenborn
- **Data**: 2026-05-15
- **Modulo**: Lancamentos, Contratos, qualquer dado financeiro
- **Descricao**: Antes de salvar dados criticos, mostrar modal bloqueante por 3 segundos com resumo da acao
- **Comportamento esperado**: Modal aparece, tela bloqueia 3s, usuario le e confirma ou cancela
- **Impacto se descumprida**: Usuario salva dados errados sem perceber, gerando inconsistencias

### RN-004 - Versionamento de Documentos Gerados
- **Definida por**: Lucas Dettenborn
- **Data**: 2026-05-15
- **Modulo**: Relatorios, PDFs, Demonstrativos
- **Descricao**: Todo documento gerado (PDF, relatorio) deve ter versao incremental
- **Comportamento esperado**: v1, v2, v3... Sempre mostra ultima versao. Historico completo acessivel
- **Impacto se descumprida**: Cliente alega que dados mudaram sem prova do contrario

### RN-005 - Validacao de Categoria por Regex
- **Definida por**: Lucas Dettenborn
- **Data**: 2026-05-15
- **Modulo**: Lancamentos
- **Descricao**: Quando usuario lanca com categoria "Outros", validar por regex se a descricao corresponde a uma categoria existente
- **Comportamento esperado**: Sistema detecta que descricao "IPTU" deveria ser categoria IPTU, nao "Outros". Alerta o usuario
- **Impacto se descumprida**: Lancamentos ficam com categoria errada, relatorios ficam incorretos

---

## Regras Especificas do Projeto: Sistema MM Solucoes

> Origem: `design_handoff_sistema_mm/README.md` e o prototipo. Sao as regras que
> **ja estao desenhadas**. As marcadas com ⚠️ precisam de confirmacao do
> Anderson antes de virar codigo.
>
> **Estas regras nao se reinterpretam dentro de componente.** Calculo de dinheiro
> vive em `src/lib/pricing.ts` e e importado — nunca reescrito na tela.

### RN-100 - Formula unica de precificacao
- **Definida por**: handoff de design (contrato Orbital x MM Solucoes)
- **Data**: 2026-08-07
- **Modulo**: Calculadora, Anuncios, Estoque (preco alvo)
- **Descricao**: o preco sugerido por canal sai de uma unica formula:
  ```
  base   = custo + frete_entrada + frete_saida
  d      = 1 − taxa_canal − comissao − margem
  preco  = base / d          (se d > 0,05; senao exibir "—")
  lucro  = preco × margem
  ```
  **Sao DOIS fretes, e nao sao a mesma coisa** (corrigido em 2026-08-10):
  - `frete_entrada` — trazer o lote do leilao ate o galpao. Custo de aquisicao;
    acontece sempre, independe de canal e de haver venda.
  - `frete_saida` — enviar a peca ao comprador, **quando a MM paga**. No Mercado
    Livre, item acima de R$ 79 entra em frete gratis e quem paga a etiqueta e o
    **vendedor**: o ML desconta do repasse. Num equipamento de ~40 kg saindo de
    Maringa sao R$ 400 a R$ 900 — de 10% a 30% do lucro que a tela mostra.

  Os dois entram na base porque os dois saem do bolso da MM. Se o comprador paga
  o envio (retirada em maos, combinado no WhatsApp), `frete_saida` = 0.
  ⚠️ **Em qual canal a MM absorve o frete de saida ainda e decisao do Anderson.**
  Por isso o campo e entrada obrigatoria da funcao, sem valor padrao: nenhuma
  tela consegue esquecer dele sem o TypeScript reclamar.

  **Consequencia para a tela:** a Calculadora do prototipo tem UM campo "Frete
  estimado". Precisa de dois, ou de um campo com a politica por canal aplicada.
  E mudanca de layout — registrar antes de portar a tela.
- **Comportamento esperado**: implementada **uma vez** em `src/lib/pricing.ts`.
  Calculadora, tela de anuncio e preco alvo do estoque importam dela.
- **Impacto se descumprida**: duas copias divergem em silencio e o sistema passa
  a sugerir preco que da prejuizo — bug de dinheiro, o pior tipo aqui.

### RN-101 - `lucro = preco × margem` esta correto, nao e simplificacao
- **Definida por**: derivacao da RN-100
- **Data**: 2026-08-07
- **Modulo**: Calculadora
- **Descricao**: parece que falta descontar custo e taxas do lucro, mas nao
  falta. Da formula: `preco·(1−t−c−m) = base` → `preco − base − preco·t −
  preco·c = preco·m`. O lado esquerdo **e** o lucro liquido.
- **Comportamento esperado**: manter como esta.
- **Impacto se descumprida**: alguem "corrige" para
  `preco − custo − frete − taxas` e passa a mostrar lucro errado (duplicando o
  desconto).

### RN-102 - Taxas por canal e comissao
- **Definida por**: handoff de design
- **Data**: 2026-08-07
- **Modulo**: Precificacao, Pedidos, Relatorios
- **Descricao**: taxa Mercado Livre **14%**, OLX **5%**, venda direta/WhatsApp
  **0%**. Comissao da agencia **4%** sobre toda venda, em qualquer canal.
- **Comportamento esperado**: valores em **configuracao**, nao literais espalhados.
  ⚠️ A taxa do ML varia por categoria e tipo de anuncio (classico x premium) —
  confirmar se 14% e fixo para o catalogo da MM ou se precisa vir da API.
- **Impacto se descumprida**: margem exibida nao bate com o extrato do canal.

### RN-103 - Margem exibida ja desconta a taxa do canal
- **Definida por**: handoff (nota no rodape da tela Anuncios)
- **Data**: 2026-08-07
- **Modulo**: Anuncios, Relatorios
- **Descricao**: a coluna Margem mostra margem **liquida de taxa**, nao bruta.
  Verde ≥30%, ambar abaixo.
- **Impacto se descumprida**: o dono decide preco olhando numero inflado.

### RN-104 - Venda em um canal baixa o estoque e pausa os demais
- **Definida por**: handoff (tela Estoque)
- **Data**: 2026-08-07
- **Modulo**: Estoque, Anuncios, Integracoes, Site
- **Descricao**: item vendido em qualquer canal (ML, OLX, WhatsApp) da baixa
  automatica e **pausa o anuncio nos outros canais**; tambem sai do site publico.
  Com quantidade (RN-112, revista em 2026-10-29): cada venda baixa as unidades
  vendidas, e a pausa nos outros canais e a saida do site so acontecem quando
  a quantidade **zera**.
- **Comportamento esperado**: acao unica e idempotente, disparada pelo webhook de
  venda; registra na auditoria. Reprocessar o mesmo evento nao pode pausar duas
  vezes nem gerar erro.
- **Impacto se descumprida**: venda duplicada de item unico — o cliente fica sem
  o produto, cancela no ML e a reputacao cai.

### RN-105 - SLA de resposta a perguntas: 4 horas
- **Definida por**: handoff (tela Perguntas)
- **Data**: 2026-08-07
- **Modulo**: Perguntas, Notificacoes
- **Descricao**: meta de responder em ate 4h, **configuravel**. Pergunta com
  menos de 4h restantes marca pill vermelha; alerta sai por WhatsApp.
- **Impacto se descumprida**: reputacao no Mercado Livre cai e o anuncio perde
  posicao — impacto comercial direto.

### RN-105.1 - Escala de urgencia do SLA (cor da pill e ordem da lista)
- **Definida por**: Anderson (via Paulo)
- **Data**: 2026-08-10
- **Modulo**: Perguntas
- **Descricao**: o criterio "pill vermelha abaixo de 4h" do handoff **nao
  discrimina nada**: com meta de 4h, toda pergunta aberta esta, por definicao,
  abaixo de 4h. A urgencia passa a ser medida em **fracao da meta restante**,
  nao em horas cravadas — assim a escala sobrevive a meta ser reconfigurada.
- **Comportamento esperado**:

  | Restante | Estado | Com meta de 4h |
  |---|---|---|
  | > 50% da meta | `neutro` | mais de 2h |
  | 25% a 50% | `atencao` | 1h a 2h |
  | abaixo de 25% | `urgente` | menos de 1h |
  | prazo ja passou | `vencido` | — |
  | respondida | `respondida` | — |

  A lista **ordena por prazo**, nunca por canal: vencidas no topo, depois as
  pendentes da mais urgente para a menos, e as respondidas por ultimo. A cor
  reacende sozinha com a passagem do tempo — nao depende de recarregar a pagina.
- **Onde mora**: `src/lib/sla.ts`, fonte unica. Nenhum componente reimplementa
  os limites, pelo mesmo motivo que preco so vive em `pricing.ts` (RN-100).
- **Impacto se descumprida**: era exatamente o defeito do prototipo — a pergunta
  de 55min aparecia mais calma que a de 3h20. O operador atende na ordem errada e
  estoura o SLA da mais urgente, que e o unico jeito de essa tela falhar.

### RN-106 - Alerta de despacho a 24h do limite
- **Definida por**: handoff (nota da tela Expedicao)
- **Data**: 2026-08-07
- **Modulo**: Expedicao, Notificacoes
- **Descricao**: pedido que chega a 24h do prazo limite de despacho gera alerta.
- **Impacto se descumprida**: atraso conta como falha de reputacao no ML.

### RN-107 - Operador nao tem acesso a custo
- **Definida por**: handoff (tela Equipe)
- **Data**: 2026-08-07
- **Modulo**: RBAC, Estoque, Lotes, Calculadora, Pedidos, Relatorios
- **Descricao**: o papel Operador ve preco de venda e situacao, **nunca** custo de
  arremate, margem ou lucro.
- **Comportamento esperado**: filtrado **no servidor** — o campo nao pode chegar
  ao cliente nem escondido por CSS.
- **Impacto se descumprida**: vaza o custo de arremate para quem nao deve ver.

### RN-108 - Comissao de 4% com acerto no dia 5
- **Definida por**: handoff (tela Equipe)
- **Data**: 2026-08-07
- **Modulo**: Equipe, Relatorios
- **Descricao**: 4% por venda, listado por pedido, com fechamento mensal e acerto
  todo dia 5.
- **Comportamento esperado**: ⚠️ confirmar a base de calculo — 4% sobre o
  **faturamento bruto** ou sobre o **liquido de taxas**? O rodape da tela Pedidos
  sugere bruto (R$ 38.400 → R$ 1.536 = 4% do bruto). Confirmar com o Anderson.
- **Impacto se descumprida**: acerto de comissao errado todo mes.

### RN-109 - Item so aparece no site publico se tiver foto e estiver visivel
- **Definida por**: handoff (tela Site/CMS)
- **Data**: 2026-08-07
- **Modulo**: Site, CMS
- **Descricao**: a vitrine puxa do estoque, mas so publica item com foto e com o
  toggle "Exibir no site" ligado. Item vendido sai do ar automaticamente (RN-104).
- **Impacto se descumprida**: site mostra produto sem foto ou ja vendido, e o
  lead chega no WhatsApp para comprar o que nao existe.

### RN-110 - QR da etiqueta aponta para a ficha do item
- **Definida por**: handoff (tela Expedicao)
- **Data**: 2026-08-07
- **Modulo**: Expedicao, Estoque
- **Descricao**: no prototipo o QR e decorativo. Em producao gera QR real com a
  URL da ficha do item (SKU no padrao `MM-OFT-1401`).
- **Impacto se descumprida**: etiqueta impressa inutil no galpao.

### RN-111 - Conversao do site publico e por WhatsApp, nao carrinho
- **Definida por**: handoff (estrategia do site)
- **Data**: 2026-08-07
- **Modulo**: Site publico
- **Descricao**: publico de equipamento usado de alto valor negocia antes de
  comprar. O CTA e "Consultar disponibilidade" via WhatsApp; o formulario de
  leads captura interesse em novos lotes.
- **Comportamento esperado**: **nao** implementar checkout, carrinho ou gateway
  de pagamento sem decisao de produto.
- **Impacto se descumprida**: semanas gastas num fluxo que esse comprador nao usa.

### RN-112 - Nunca vender mais unidades do que existem (compra simultanea)
- **Definida por**: Paulo/Anderson (contrato Orbital x MM Solucoes)
- **Data**: 2026-08-10 · **revista em 2026-10-29** (ADR-0002)
- **Modulo**: Pedidos, Estoque, Integracoes
- **Descricao**: o item fica anunciado em varios canais ao mesmo tempo, e dois
  compradores podem fechar no mesmo instante. Ate 2026-10-29 todo item era
  **peca unica**; a importacao do ML mostrou que nao e: o rele tem 19 unidades,
  e varios anuncios ja venderam 3 ou 4. O item agora tem **`quantidade`**
  (unidades em estoque), e a regra passa a ser: **nenhuma venda deixa a
  quantidade negativa**. Peca unica e o caso `quantidade = 1`.
- **Comportamento esperado**: **tres camadas**, nesta ordem:
  1. **Banco (garantia).** `CHECK (quantidade >= 0)` em `itens`. A venda baixa
     a quantidade no MESMO commit em que grava o pedido. Se duas vendas
     disputarem a ultima unidade, a segunda leva a quantidade a -1 e o
     Postgres recusa (`23514`) — nao ha janela possivel.
  2. **Aplicacao (serializacao).** O handler de venda abre transacao e trava a
     linha do item com `SELECT ... FOR UPDATE`, confere se ha unidades
     suficientes e so entao grava. Os webhooks concorrentes viram fila.
  3. **Tratamento.** Sem unidades suficientes (ou `23514`), a resposta NAO e
     erro 500: e "estoque insuficiente — venda concorrente". O pedido perdedor
     precisa virar cancelamento no canal de origem e alerta para o Anderson —
     decisao comercial, nao tecnica.
- **Quando zera**: so na venda que leva a quantidade a **0** o item vira
  `vendido`, sai do site e os anuncios dos outros canais sao pausados (RN-104).
  Antes disso, cada venda so baixa unidades.
- **Custo congelado**: `pedidos.custo_na_venda` = custo unitario do item x
  quantidade vendida, calculado em `pricing.ts` (`custoNaVenda`).
- **O que a garantia NAO cobre**: ela depende de a gravacao do pedido andar
  junto com a baixa, e quem garante isso e o handler. Um `INSERT` em `pedidos`
  sem a baixa (como a importacao do historico, que nao deve baixar o que o ML
  ja descontou) passa pelo banco. O indice antigo, `idx_pedidos_item_ativo`,
  barrava qualquer segundo pedido, inclusive os legitimos, e por isso saiu.
- **Verificado**: `scripts/db/prova-compra-simultanea.sql`, reescrita para o
  modelo com quantidade.
- **Corolario**: cancelamento **nao e exclusao logica**. Pedido cancelado usa
  `status = 'cancelado'` e continua no relatorio. **Devolver a unidade ao
  estoque no cancelamento ainda nao existe** — nao ha fluxo de cancelamento.
- **Impacto se descumprida**: vender unidade que nao existe. Um comprador nao
  recebe, cancela no ML, e a reputacao — que e o ativo mais fragil da operacao —
  cai.

### RN-113 - A venda congela o custo e a propria data
- **Definida por**: Paulo (analise de corretude 2026-08-10)
- **Data**: 2026-08-10
- **Modulo**: Pedidos, Relatorios, Equipe (comissao)
- **Descricao**: um pedido guarda **o custo do item no momento da venda**
  (`custo_na_venda`) e **quando a venda aconteceu no canal** (`vendido_em`).
  Nenhum dos dois pode ser derivado depois:
  - `itens.custo` continua editavel — o rateio do lote e revisado, o Anderson
    corrige um valor. Se o relatorio lesse o custo do item, a margem de um mes
    **ja fechado** mudaria sozinha, sem ninguem saber explicar por que.
  - `created_at` e quando alguem **digitou**. Venda de marco lancada em abril
    cairia no mes errado, levando junto a comissao de 4% (RN-108) e o relatorio
    de vendas por canal.
- **Comportamento esperado**:
  - `vendido_em` e **NOT NULL e sem valor padrao**. `defaultNow()` reintroduziria
    o bug em silencio. ML e OLX trazem a data no payload; venda direta e o
    operador quem informa.
  - `custo_na_venda` e copiado de `itens.custo` **na mesma transacao** da venda.
  - Toda leitura de margem historica usa `custo_na_venda`. **Nunca**
    `itens.custo` — esse serve para precificar o que ainda esta a venda.
  - Todo agrupamento por periodo (mes fechado, comissao do dia 5, vendas por
    canal) usa `vendido_em`. Nunca `created_at`.
- **Verificado**: `scripts/db/prova-congelamento-venda.sql` (5/5 em banco real) —
  inclusive o caso de corrigir o custo do item depois da venda e a margem do mes
  fechado nao se mexer.
- **Limite conhecido**: `custo_na_venda` congela o que `itens.custo` continha. Se
  o rateio lote -> item estiver incompleto, congela um numero incompleto — o
  congelamento resolve a instabilidade, nao a completude (ver known-issues).
- **Impacto se descumprida**: relatorio que se reescreve sozinho e acerto de
  comissao no mes errado. Os dois destroem a confianca no numero, que e o unico
  produto deste sistema.

### RN-117 - Webhook: responder rapido, nunca confiar no corpo
- **Definida por**: Paulo (sintese de auditoria)
- **Data**: 2026-08-10
- **Modulo**: Integracoes
- **Descricao**: o marketplace envia um envelope com o ID do recurso, espera 200
  em fracao de segundo e **reentrega** se demorar; apos falhas seguidas, suspende
  as notificacoes da aplicacao inteira. A URL e publica e vaza com facilidade.
- **Comportamento esperado**: o handler faz tres coisas — valida a origem, insere
  UMA linha em `integracoes_eventos` (com unico natural do evento) e retorna 200.
  Nada de API externa no request. Nunca `SELECT` antes de `INSERT`: usar
  `ON CONFLICT DO NOTHING RETURNING` — se nao voltou linha, e reentrega e nada
  mais executa. **Os dados vem sempre de um GET na API do canal com o nosso
  token**; o corpo do POST so diz qual recurso olhar, e o evento e descartado se
  o recurso nao existir ou se a conta nao bater com a do vendedor conectado.
- **Implementado em**: `src/app/api/integracoes/webhook/[canal]/route.ts` e
  `src/lib/integracoes/eventos.ts`. O GET na API do canal **ainda nao existe** —
  depende de credencial (known-issues 🔴). Ate la o evento fica gravado e
  `processado_em` permanece nulo: nada e deduzido do corpo.
- **Impacto se descumprida**: notificacoes suspensas pelo ML = vendas e perguntas
  param de entrar **em silencio**, e parece que so nao vendeu. E um POST forjado
  pausa os anuncios reais nos tres canais sem venda nenhuma.


### RN-121
**Cadastro de lote e item e ato do administrador, e todo item nasce com custo.**

- **Contexto**: o ciclo do negocio comeca no leilao — o Anderson arremata um
  lote e cadastra as pecas. Ate 2026-08-11 nao existia nenhum caminho no sistema
  para isso: as telas mostravam estoque que so podia entrar por SQL manual.
- **A regra**:
  - `lotes` e `itens` sao criados, alterados e excluidos pelo painel, com
    trilha de auditoria na **mesma transacao** da gravacao.
  - **Todo item tem custo maior que zero.** A coluna e `NOT NULL` e o validador
    recusa vazio e zero: custo zero produziria margem de 100% em toda tela do
    sistema, e um numero errado com cara de certo e pior que a ausencia dele.
  - **Preco alvo e opcional** e nasce nulo. Vazio significa "ainda nao
    precificamos"; zero significaria "decidimos vender de graca".
  - **Segmento e gravado em minusculo.** O banco ja mostrou "Oftalmologia" e
    "oftalmologia" como segmentos separados — dois chips na tela Estoque e
    filtros que nao se encontram.
- **⚠️ QUEM PODE, e a contradicao que sobrou**: a matriz do RBAC da ao operador
  `itens: criar`, mas nega `itens_custo` e nega `lotes` por inteiro. Como custo e
  obrigatorio e o formulario exige escolher um lote, **pela matriz de hoje o
  operador tem permissao de criar um item e nenhum jeito de preencher o
  formulario**. Enquanto o Anderson nao decidir, o cadastro exige as duas
  permissoes — na pratica, administrador. Registrado em known-issues.
- **Impacto se descumprida**: item sem custo derruba a margem, o lance maximo
  (RN-100) e o custo congelado na venda (RN-114) de uma vez so.

### RN-122
**Exclusao logica so acontece quando nao deixa orfao nem mente sobre o mundo.**

- **Contexto**: todo delete da casa e logico, e soft delete **nao dispara chave
  estrangeira**. O banco deixaria passar; a regra vive na action.
- **A regra**:
  - **Lote com item ativo nao e excluido.** Sumiria da tela e os itens
    continuariam apontando para ele — orfaos com FK intacta, que e o pior tipo,
    porque nada no banco reclama.
  - **Item com pedido nunca e excluido.** O pedido e dinheiro que entrou: tem
    taxa, comissao e talvez NF-e amarradas. Excluir deixaria a venda apontando
    para o vazio no relatorio do mes.
  - **Item com anuncio no ar nao e excluido antes de o anuncio ser pausado.**
    Excluir aqui **nao tira o anuncio do canal**: so faz o painel esquecer que
    ele existe, e a peca continua a venda no Mercado Livre sem ninguem sabendo.
  - **Item vendido nao muda de custo pelo painel.** O pedido congelou
    `custo_na_venda` (RN-114), entao alterar depois nao reescreve o mes fechado
    — mas faria o custo do item divergir do que foi vendido sem nada explicando.
    Correcao se faz pelo pedido.
- **Impacto se descumprida**: a mais cara e a do anuncio — o painel diz que o
  item nao existe e o comprador continua conseguindo compra-lo.

### RN-123
**Importar os anuncios do Mercado Livre e so leitura, e anuncio importado nao vira item sem lote e custo.**

- **Definida por**: Paulo
- **Data**: 2026-10-29
- **Modulo**: Integracoes (Mercado Livre)
- **Contexto**: a conta da MM ja tem anuncios no ML que o painel nao conhece. O
  ML nao sabe de lote nem de custo de arremate, e um item sem custo quebra a
  RN-121.
- **A regra**:
  - A importacao faz **so GET** na API do ML. Nao pausa, nao edita e nao
    encerra nada na conta.
  - O que vem do ML fica em `integracoes_ml_anuncios`, **fora do Estoque**.
    Reimportar atualiza a linha do mesmo anuncio (chave: o id `MLB...`), nunca
    duplica.
  - Quantidade disponivel e vendida sao **registradas**, nao viram itens. Quantos
    itens um anuncio representa decide quem faz o vinculo (etapa 2).
  - As fotos ficam como **links do ML** ate o vinculo. So ai sao copiadas para o
    storage proprio.
  - **SKU duplicado entre anuncios e sinalizado** na tela. A conta ja tem
    `LEILAO-011` em dois produtos diferentes. (Revisto em 2026-10-29: no
    vinculo, o duplicado ganha sufixo em vez de bloquear — ver RN-124.)
- **Impacto se descumprida**: escrever na conta durante uma importacao pode
  pausar ou alterar anuncio com venda; criar item sem custo derruba margem e
  lance maximo (RN-100).

### RN-124
**Anuncio do ML vira item do Estoque por lote, com custo rateado.**

- **Definida por**: Paulo
- **Data**: 2026-10-29
- **Modulo**: Integracoes (Mercado Livre), Estoque, Lotes, Anuncios
- **Contexto**: os 67 anuncios importados (RN-123) nao tem lote nem custo, e
  todo item precisa dos dois (RN-121). O SKU da conta ja carrega o leilao de
  origem no prefixo: `LEILAO-009`, `L3-001`, `U-009`, `G-018`, `F-008`.
- **A regra**:
  - **Lote = prefixo do SKU** (o texto antes do primeiro `-`). Anuncio sem SKU
    vai para o lote `SEM-SKU`. Quem vincula da nome, segmento, data de arremate
    e **custo total** a cada lote; a data sugerida e a do anuncio mais antigo.
  - **Rateio do custo**: o custo total do lote e dividido na proporcao do preco
    de anuncio x unidades (disponiveis + ja vendidas, porque o lote pagou por
    todas). Custo unitario = custo total x preco / soma(preco x unidades). A
    conta mora em `pricing.ts` (`ratearCustoDoLote`), em centavos, com minimo de
    R$ 0,01 por unidade (RN-121 recusa custo zero).
  - **Quantidade do item = unidades disponiveis no ML**. Disponivel 0 vira item
    `vendido` com quantidade 0; ativo vira `anunciado`; pausado, inativo ou
    encerrado vira `pausado`.
  - **SKU repetido** (na conta ou ja no Estoque) ganha sufixo: o primeiro, na
    ordem do id do anuncio, fica com o SKU; os seguintes viram `-B`, `-C`...
    Anuncio sem SKU vira `ML-<id do anuncio>`.
  - **O anuncio do canal** (`anuncios`) nasce com o id `MLB...`, o preco e o
    status (`no_ar` se ativo, `pausado` se nao). As perguntas daquele anuncio
    ganham o item.
  - **Venda anterior a importacao nao baixa estoque.** A quantidade disponivel
    do ML ja desconta essas vendas. O anuncio guarda `contado_ate` (o instante da
    importacao usada no vinculo); venda com data ate esse instante e registrada
    como pedido, sem baixa e sem pausar nada.
  - **Fotos** sao copiadas para o storage proprio depois do vinculo, em passo
    separado: chamada de rede nao entra na transacao do vinculo.
- **⚠️ Efeito colateral**: a partir do vinculo a RN-104 vale para estes itens.
  Venda em outro canal **pausa o anuncio no ML** — a primeira escrita do sistema
  na conta.
- **Impacto se descumprida**: venda antiga baixando estoque de novo zera itens
  que ainda existem; rateio fora de `pricing.ts` vira segunda copia da regra de
  dinheiro (RN-100).

### RN-125
**Pergunta que deixou de existir no canal, ou que foi arquivada, sai da caixa e do SLA.**

- **Definida por**: Paulo
- **Data**: 2026-10-29
- **Modulo**: Perguntas (RN-105)
- **Contexto**: perguntas importadas do ML como pendentes continuavam na caixa
  depois de excluidas ou encerradas la, com o SLA vencido crescendo, sem existir
  em lugar nenhum.
- **A regra**:
  - Pendente que o ML da como **excluida, banida, encerrada sem resposta ou
    desativada** sai da caixa por exclusao logica, com trilha. A busca confere
    uma a uma as pendentes que ela nao devolveu: pergunta excluida some da busca
    do ML. **Em revisao** nao conta: e passageiro.
  - **Arquivar** (administrador e operador, `perguntas: atualizar`) tira uma
    pendente da caixa sem responder, com trilha de quem e quando. **Nao mexe no
    ML**: se ela ainda estiver aberta la, continua aberta.
  - **Respondida nunca sai**: e historico de atendimento.
- **Impacto se descumprida**: a caixa enche de pergunta fantasma com SLA
  vermelho, e a pill que existe para alertar vira paisagem.
