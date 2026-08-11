# Sintese das quatro varreduras — Sistema MM Solucoes

**Data:** 2026-08-10 · **Base conferida:** `src/` inteiro, as 3 migracoes aplicadas, `docs/regras-negocio.md`, `docs/known-issues.md`, handoff.

---

## Nota do editor — o que eu joguei fora, e por que

Os analistas rodaram sobre uma foto **desatualizada** do repositorio. Descartei antes de comecar:

| Achado descartado | Motivo |
|---|---|
| "Duas vendas do mesmo item: o banco nao impede nada" (concorrencia #1) | **Falso hoje.** Ja existe `idx_pedidos_item_ativo` — unico parcial em `pedidos(item_id) WHERE is_deleted = false AND status <> 'cancelado'`, aplicado na migracao `0002_public_warpath.sql`, com `cancelado` adicionado ao enum em `0001`. Esta escrito como **RN-112** e provado em banco real por `scripts/db/prova-compra-simultanea.sql` (5/5). A premissa do caso ("indice comum, nao unico") nao se sustenta mais. |
| "Pedido cancelado nao tem estado" (implicito em varios) | Resolvido na mesma migracao. O `known-issues.md` ainda lista isso na secao 🟡 — **esse item precisa sair do doc**. |
| "Reprocessar webhook cria pedido duplicado" | Coberto por `idx_pedidos_canal_numero` (global, deliberado) e por `idx_perguntas_id_externo` / `idx_anuncios_id_externo`. O que sobra e outra coisa (caso 3 abaixo), nao isso. |
| "Taxa do ML pode nao ser 14%" | Ja e pendencia 🔴 registrada. Sobrou so o incremento novo (caso 5). |
| "Timestamps sem fuso" | Ja e pendencia 🟡 registrada. Sobrou so **qual instante** gravar (caso 9), que e problema diferente de **em que fuso**. |
| "Faltam `itens_fotos`, `site_leads`, prazo de despacho, frete/margem do preco alvo" | Ja registrados em 🟡. |
| Toda a lente "operacao" | **Nao chegou** — o JSON veio truncado no meio do 6o achado de "dinheiro". Se houver achados de operacao, eles nao foram avaliados aqui. |

Sobraram **14 casos verificados** — nenhum deles esta em `known-issues.md` nem em `regras-negocio.md` hoje. Todos foram conferidos abrindo o arquivo citado.

---

## Ranking — onde o dinheiro deve ir primeiro

| # | Caso | Gravidade | Custo p/ resolver AGORA | Depende do Anderson |
|---|---|---|---|---|
| 1 | Frete de saida nao existe em lugar nenhum | 🔴 critico | 1 coluna + 1 termo na formula | ⚠️ sim |
| 2 | O efeito colateral da RN-104 nao tem entrega garantida | 🔴 critico | 1 tabela (outbox) + worker | nao |
| 3 | O handler do webhook: ack rapido e idempotencia de verdade | 🔴 critico | 1 tabela + disciplina | nao |
| 4 | Nunca confiar no corpo do webhook | 🔴 critico | ~0 (e um invariante) | nao |
| 5 | O pedido nao congela custo nem data da venda | 🔴 critico | 3 colunas, migracao unica | nao |
| 6 | Item volta de "vendido" por evento fora de ordem | 🟠 alto | 1 coluna + 1 WHERE | nao |
| 7 | NF-e: timeout tratado como falha emite nota duplicada | 🟠 alto | 2 colunas + 1 unico | ⚠️ parcial |
| 8 | Reversao de venda nao existe — e nao e simetrica | 🟠 alto | 1 tabela + 1 action | ⚠️ sim |
| 9 | O relogio do SLA nasce da NOSSA hora de gravacao | 🟠 alto | 1 coluna | nao |
| 10 | Optimistic locking do CLAUDE.md nao funciona no schema atual | 🟠 alto | 1 coluna, vale p/ a base inteira | ⚠️ Lucas |
| 11 | Quem assina as escritas do robo (`modified_by NOT NULL`) | 🟠 alto | 1 seed na migracao | nao |
| 12 | Token do ML: nao ha onde guardar, e o refresh e de uso unico | 🟠 alto | 1 tabela + advisory lock | nao |
| 13 | Nada detecta notificacao perdida | 🟠 alto | 1 tabela + job | ⚠️ sim |
| 14 | A janela entre negociar e vender nao tem dono | 🟠 alto | depende da decisao | ⚠️ sim |

Casos 5, 6, 9, 10 e 11 sao **a mesma migracao**. O banco local e descartavel (`docker compose down -v`). Fazer os cinco juntos, agora, custa uma tarde; fazer depois de HML/PRD custa ALTER em producao.

---

## Os casos

### 1. O frete de saida nao existe — nem na formula, nem no pedido 🔴 ⚠️

**Cenario.** Anderson arremata um autorrefrator, custo rateado R$ 3.300. Abre a Calculadora, digita custo 3.300 e frete estimado 180 (o frete de **retirada do lote**), margem 35%, canal ML → preco sugerido ~R$ 7.553. Publica nesse valor. Item acima de R$ 79 no ML entra em frete gratis: quem paga a etiqueta e o vendedor, e o ML desconta do repasse. Autorrefrator de ~40 kg saindo de Maringa para Manaus: R$ 400 a R$ 900. Venda fechada, o painel grava valor 7.553, taxa 1.057, comissao 302, liquido 6.194. O que cai na conta e ~R$ 5.494.

**O que quebra hoje.** `src/lib/pricing.ts` tem UM campo `frete`, documentado na linha 71 como "Frete embutido no custo do item" — e o frete de **entrada**. Nao ha frete de saida em `EntradaPreco`/`EntradaLance` (linhas 68-85), e nenhuma das 7 tabelas tem coluna de frete: `pedidos` so tem `valor`/`taxa`/`comissao`/`liquido` (linhas 64-67), `itens` so tem `custo`/`preco_alvo`. Grep por "frete" em `src/` acha so `pricing.ts` e o teste dele.

**Consequencia.** Prejuizo silencioso e **proporcional ao peso** — justamente o catalogo da MM (encadernadora industrial, autorrefrator, baterias). A margem verde ≥30% da RN-103 vira falsa e o KPI "Margem media 41%" da Visao geral e ficcao. Nao aparece em tela nenhuma: aparece no extrato.

**Como prevenir.** Tres partes, nesta ordem: (a) o Anderson diz em qual canal a MM absorve frete, em qual cobra, e o que e retirada em maos; (b) se absorve, o frete de saida entra na base da RN-100 como termo proprio (`base = custo + frete_entrada + frete_saida_estimado`), estimado por faixa de peso — **nasce em `pricing.ts`**, nunca no componente (invariante 1); (c) `pedidos.frete_saida numeric(14,2)` gravado com o valor REAL descontado pelo canal, e `liquido = valor − taxa − comissao − frete_saida`.

**Camada.** Aplicacao para a formula, banco para a coluna. A regra comercial e humana.

---

### 2. O efeito colateral da RN-104 e HTTP externo — e nao tem entrega garantida 🔴

**Cenario.** 14h02 o comprador paga a Encadernadora no ML. O handler grava `pedidos`, marca `itens.situacao = 'vendido'`, chama a API do ML para pausar o anuncio de la (200 OK) e chama a API da OLX — que responde 500, ou pendura 8s ate o timeout. Duas saidas, as duas erradas: com rollback, a venda que EXISTE no ML some do painel e o item volta a "anunciado"; sem rollback, o anuncio da OLX fica no ar para um item vendido e ninguem reprocessa. Duas horas depois um segundo comprador fecha o mesmo item na OLX e paga.

**O que quebra hoje.** Nao existe `src/lib/actions/vendas.ts`, nao existe rota de webhook (`src/app/` so tem `(painel)`), nao existe fila (`package.json` nao tem `bullmq` nem `ioredis`; `docker-compose.yml` sobe so o servico `db`). `statusAnuncioEnum` (`anuncios.ts:25-29`) so tem `no_ar`/`negociando`/`pausado` — nao ha como representar "pausa solicitada, canal nao confirmou", e nao ha `sincronizado_em`. O padrao **nasce agora**: se nascer com `await fetch(...)` dentro do `db.transaction`, nasce errado — e ai o `Pool` de `src/lib/db/index.ts:24`, criado sem `max` (default 10 no `pg`), esgota com meia duzia de handlers presos, derrubando o painel no pico de venda.

**Consequencia.** E o dano exato que a RN-104 existe para impedir, chegando por um caminho que a RN-112 nao cobre: o indice unico impede **registrar** a segunda venda, nao impede a segunda venda **acontecer** no canal. Resultado pratico: o dinheiro entrou, o painel nao consegue gravar o pedido, alguem cancela — e cancelamento por falta de estoque e a falha que mais pesa na reputacao do ML.

**Como prevenir.** Transacao curta e **so de banco**: pedido + item + auditoria + **linha de tarefa** na mesma transacao. Commit. So depois o efeito externo, como job idempotente por anuncio. O detalhe que costuma passar batido: enfileirar **depois** do commit pode falhar e ninguem pausa nada; enfileirar **antes** dispara job para transacao que deu rollback. A solucao correta e **outbox** — tabela `integracoes_tarefas (canal, tipo, anuncio_id, tentativas, proxima_tentativa, status)` escrita na MESMA transacao, drenada por worker com `FOR UPDATE SKIP LOCKED`, backoff e limite de tentativas; tarefa estourada vira status `falha` e **aparece na tela Integracoes**, nao so no log. Em `anuncios`, separar `status` (o que o canal confirmou) de `status_desejado` (o que decidimos) + `sincronizado_em`: enquanto divergem, o painel mostra "pausa pendente na OLX" em ambar. Zero HTTP dentro de transacao. A invalidacao do cache do site publico (`revalidateTag('item:<id>')`) e responsabilidade **desse job**, nunca da requisicao do webhook — o webhook nao passa pela rota do site.

**Sobre a fila.** O CLAUDE.md manda BullMQ sobre Redis, e Redis nao existe aqui. Recomendo **fila em tabela Postgres** e nao e so economia: com Redis, gravar o pedido e enfileirar a pausa sao **dois sistemas**, e a janela entre um commit e o outro e exatamente o buraco que o outbox existe para fechar. Some-se que a politica de backup do CLAUDE.md so cobre `pg_dump` — fila em Redis e estado que o disaster recovery nao restaura. Como isso **contraria o padrao escrito da casa**, e decisao do Lucas e precisa virar ADR, nao excecao inventada no deploy. Decidir junto onde o worker roda (systemd na VPS de backend; `npm start` so sobe o Next).

**Camada.** Banco (a tabela) + aplicacao (a disciplina). ADR pendente.

---

### 3. Idempotencia do INSERT nao e idempotencia do handler 🔴

**Cenario.** O ML nao manda a venda no corpo do POST — manda um envelope (`{ resource: "/orders/2195160686", topic: "orders_v2", ... }`). Para saber o que aconteceu sao 4+ chamadas externas, dentro de um request que o ML espera respondido na ordem de meio segundo. Nao respondeu: o ML **reentrega**, e agora ha DUAS execucoes do mesmo handler ao mesmo tempo. Cada uma faz `SELECT ... WHERE canal='mercado_livre' AND numero='2000012345'` → nada (a outra ainda nao commitou) → as duas seguem: duas chamadas de pausa na OLX, duas linhas de auditoria, dois jobs. So entao uma leva 23505. Se o handler devolver 500, o ML reentrega de novo — e apos falhas seguidas **suspende as notificacoes da aplicacao inteira**.

**O que quebra hoje.** `idx_pedidos_canal_numero` (`pedidos.ts:92`) protege exatamente uma coisa: a LINHA de pedidos. Nao existe tabela de eventos recebidos em `src/lib/db/schema/` — entao nao da para distinguir reentrega de evento novo, nao ha replay, nao ha DLQ, e nao ha como investigar depois "por que a venda nao entrou". `auditoria` nao tem chave de idempotencia: reprocesso infla o "volume de erros por usuario" do Dashboard Owner.

**Consequencia.** Notificacoes suspensas pelo ML significam vendas e perguntas que param de entrar no painel **em silencio** — o pior modo de falha desta integracao, porque parece que so nao vendeu. A RN-105 estoura em serie em perguntas que o Anderson nunca viu.

**Como prevenir.** (a) O handler faz tres coisas e so: valida a origem, faz UM insert em `integracoes_eventos (canal, topico, recurso, payload_bruto, recebido_em, processado_em, tentativas)` com unico em `(canal, topico, recurso, sent)`, e retorna 200. Nada de API externa no request. (b) Nunca `SELECT` antes de `INSERT`: `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — se nao voltou linha, e reentrega, nao executa mais nada. E o que resolve a entrega **simultanea**, que check-then-act nao resolve nem com o unico no lugar. (c) Todo efeito colateral sai da requisicao (caso 2) com `jobId` deterministico (`venda:{canal}:{numero}`). Mora em `src/app/api/webhooks/mercado-livre/route.ts` (so POST) + `src/lib/integracoes/`.

Some a isso: `max` explicito no `Pool` com folga reservada para o painel, corpo rejeitado acima de poucos KB antes de ler, e `limit_req` **no nginx da VPS** — nunca contador em memoria do Node, que nao sobrevive a reload nem a duas instancias. Cuidado: os IPs do ML sao poucos e fixos; calibrar por burst, nao por taxa media, senao voce bloqueia o proprio ML.

**Camada.** Aplicacao + infra.

---

### 4. Qualquer um que descobrir a URL do webhook forja uma venda 🔴

**Cenario.** A URL do webhook e publica por natureza — fica no portal do ML, no log do nginx, no print da tela Integracoes. Se o handler confiar no CORPO do POST (o caminho obvio, ja que vem JSON pronto), da para injetar um pedido inexistente: marca `itens.situacao = 'vendido'`, pausa os anuncios reais nos tres canais e tira o item do site (RN-109). Vandalismo de estoque com um `curl`.

**O que quebra hoje.** Nao existe rota, segredo, allowlist nem assinatura. O `.env.example` preve `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (linha 35) mas **nenhum equivalente para o ML** (linhas 18-21) — a autenticidade do webhook do ML nao esta nem prevista como variavel.

**Consequencia.** Estoque zerado no painel e anuncios pausados nos tres canais sem venda nenhuma: perda de vitrine em plena operacao e retrabalho item a item para republicar.

**Como prevenir.** Quatro camadas, e a quarta torna as outras tres redundantes: caminho com segmento aleatorio + segredo comparado com `timingSafeEqual`; allowlist dos IPs do ML no nginx; assinatura HMAC se a aplicacao estiver configurada para receber; e o **invariante que fecha o caso: nunca acreditar no corpo**. O corpo so diz QUAL recurso olhar — os dados vem sempre de um GET na API do ML com o nosso token, e o evento e descartado se o recurso nao existe ou se o `user_id` nao bate com a conta conectada. Com isso, um POST forjado vira no maximo uma chamada desperdicada.

**Camada.** Aplicacao (o invariante) + infra (as tres primeiras).

---

### 5. O pedido nao congela nem o custo nem a data da venda 🔴

**Cenario A.** Marco: vende a encadernadora do Lote 11 por R$ 5.200; o relatorio mostra margem 38% e ela entra no "Top produtos por margem". Abril: alguem corrige o rateio do Lote 11 e `itens.custo` vai de 3.300 para 4.100. Ninguem tocou em marco — mas ao reabrir o relatorio de marco, a margem virou 22% e a ordem do Top mudou.

**Cenario B.** Dia 28/03 o Anderson fecha venda por WhatsApp de R$ 9.800 e so registra no dia 2/04. Ou: o token do ML expira na sexta, ninguem percebe, e na segunda entram de uma vez os pedidos de tres dias. Ou: venda fechada em 31/03 as 21h30, com o app em UTC gravando `timestamp without time zone` — cai em 01/04.

**O que quebra hoje.** `pedidos` (`src/lib/db/schema/pedidos.ts:52-74`) nao tem coluna de custo **nem** de data da venda. Qualquer margem por pedido so pode sair de join com `itens.custo`, que e mutavel por natureza. A unica data e `created_at` (linha 77), que e o instante de criacao da LINHA — entao "Vendas do mes", "Vendas por canal" e "Comissoes do mes" agrupam **por digitacao**. E as quatro colunas de dinheiro (`valor`, `taxa`, `comissao`, `liquido`) sao numeric independentes: nao ha CHECK amarrando a aritmetica, e nada diz se a `taxa` veio do canal ou foi estimada por `TAXA_CANAL.mercado_livre = 0.14` (`pricing.ts:50`, valor que o proprio arquivo marca como nao confirmado).

**Consequencia.** Fechamento de mes deixa de ser um fato — e o oposto do que a RN-004 exige. Faturamento de marco a menos e de abril a mais sem erro visivel; a comissao do dia 5 paga o mes errado; e quando o Anderson conferir o painel contra o extrato do ML por periodo, nunca vai bater e nao vai saber que a causa e a data. Com ~40 pedidos/mes de ticket alto, 2 a 5 pontos de diferenca na taxa sao milhares de reais entre o painel e a conta. O painel deixa de ser fonte de verdade financeira e ele volta para a planilha — que e o que o contrato se propos a eliminar.

**Como prevenir.** Uma migracao so: `custo_apurado numeric(14,2) NOT NULL` (snapshot do custo do item no fechamento, pela mesma razao que `taxa` e `comissao` ja sao gravadas e nao derivadas), `vendido_em` NOT NULL (o `date_closed` do canal, ou digitado na venda direta), `taxa_origem ('canal'|'estimada')` e `conciliado_em`. Regra dura junto: **relatorio de dinheiro soma colunas de `pedidos` e nunca faz join com `itens` para calcular margem**; todo agrupamento financeiro e por `vendido_em`, e `created_at` volta a ser so trilha. CHECK em banco de `liquido = valor − taxa − comissao − frete_saida`. Decidir junto com a pendencia de `timestamptz` ja aberta — e o mesmo ALTER.

**Camada.** Banco (colunas e CHECK) + aplicacao (a disciplina do relatorio). O fechamento da divergencia extrato-x-painel e **processo humano**: o Anderson bate uma vez por mes, o sistema so tem que listar o que nao bate.

---

### 6. Evento fora de ordem faz o item voltar de "vendido" para "anunciado" 🟠

**Cenario.** 10h00'00 o Anderson pausa o anuncio pelo app do ML no celular. 10h00'05 o item vende na OLX; marcamos "vendido" e enfileiramos a pausa. 10h00'12 a notificacao do ML — atrasada por retry do lado deles, ou eco da nossa propria pausa — chega e o sync escreve `anuncios.status`/`itens.situacao` a partir do estado que leu antes. O item volta a "anunciado". Nenhum pedido novo foi criado, entao nada colide.

**O que quebra hoje.** `itens.situacao` (`itens.ts:49`) e `anuncios.status` (`anuncios.ts:46`) sao enums escalares sem versao nem instante da FONTE. Nao existe `fonte_atualizado_em` em nenhum schema; `updated_at` e do NOSSO write, nao do evento, e nao serve para ordenar eventos externos. E nao ha maquina de estados: nada proibe a transicao `vendido → anunciado`.

**Consequencia.** Peca ja vendida reabre no ML, na OLX e no site. A defesa da RN-112 nao alcanca isso: o indice unico impede o segundo **registro**, nao a segunda **compra** — o comprador paga no ML e nos nao conseguimos gravar. Mesmo prejuizo do caso 2, chegando por outra porta.

**Como prevenir.** (a) Compare-and-set monotonico: `fonte_atualizado_em timestamptz` por recurso externo, e todo UPDATE vindo de integracao leva `AND (fonte_atualizado_em IS NULL OR fonte_atualizado_em < $instante_do_evento)` no WHERE. E atomico numa instrucao so, torna a ordem de chegada irrelevante e **dispensa fila FIFO por item** — mais barato que serializar. (b) Estado terminal: de "vendido" so se sai por cancelamento explicito, nunca por sync. Um CHECK nao expressa isso (nao enxerga o valor antigo); ou vira trigger `BEFORE UPDATE`, ou fica como `AND situacao <> 'vendido'` no WHERE de um unico ponto de sync. Honestamente: com 2 usuarios e um caminho de codigo, o WHERE resolve; o trigger e o que resolve quando alguem corrigir dado na mao em producao.

**Camada.** Aplicacao (banco se virar trigger).

---

### 7. NF-e: timeout tratado como falha emite nota duplicada 🟠 ⚠️

**Cenario.** O worker chama o emissor fiscal para o pedido 1042. O emissor leva 30s (SEFAZ lenta e rotina). Nosso cliente corta em 10s, o job marca falha e agenda retry. Dois minutos depois o retry emite a **segunda** nota do mesmo pedido — a primeira tinha sido autorizada, so nao voltou a tempo. Variante: a SEFAZ **rejeita** (CFOP, cadastro do destinatario, certificado A1 vencido). O operador abre Expedicao de manha, ve o stepper parado na primeira etapa, conclui que ainda nao chegou a vez, gera etiqueta, embala e entrega para a coleta — mercadoria saindo sem nota.

**O que quebra hoje.** `pedidos.nfe_chave` (`pedidos.ts:71`) e `text` nullable **sem indice unico** — nada impede duas chaves para o mesmo pedido, nem dois workers emitindo em paralelo. Nao ha coluna para reivindicar a emissao antes de chamar o emissor. E `nfe_emitida boolean` (linha 68) + `etapa_expedicao = 'aguardando_nfe'` (linha 72) so conseguem dizer "ainda nao": "nunca tentou", "tentando" e "rejeitada ha tres dias" sao visualmente a mesma coisa, e nenhum CHECK impede `etapa_expedicao` avancar para `etiqueta`/`embalado`/`coletado` com `nfe_emitida = false`. (O `known-issues.md` registra a **duplicidade** boolean-x-etapa; nao registra a ausencia de estado de **erro** nem a duplicacao por retry.)

**Consequencia.** Nota duplicada = problema fiscal com prazo curto para cancelar; fora do prazo vira ajuste contabil e conversa com contador. Nota rejeitada silenciosa = mercadoria despachada sem documento. Nos dois casos o stepper trava e o despacho atrasa — atraso e falha de reputacao no ML pela RN-106.

**Como prevenir.** Tres mecanicas somadas: (a) chave de idempotencia enviada ao emissor — a referencia externa e `pedidos.id`; todo emissor brasileiro aceita um `ref` proprio, e reenviar a mesma referencia devolve a nota ja emitida em vez de criar outra; (b) reivindicar a linha ANTES da chamada, deixando o banco decidir quem emite: `UPDATE pedidos SET nfe_emissao_iniciada_em = now() WHERE id = ? AND nfe_emissao_iniciada_em IS NULL RETURNING id` — quem nao recebe linha nao chama o emissor; (c) unico em `nfe_chave` entre nao deletados, mais `nfe_status` com valor de rejeicao e `nfe_motivo`, e CHECK impedindo `etapa_expedicao > aguardando_nfe` sem nota. **A regra que fecha o caso: timeout NUNCA e falha, e DESCONHECIDO** — ao expirar, o proximo passo e CONSULTAR o emissor pela referencia, jamais reemitir.

**Camada.** Banco (colunas, unico, CHECK) + aplicacao (a regra do timeout). O cancelamento de uma nota duplicada que escapar e **processo humano** e o operador precisa da instrucao escrita.

---

### 8. Reversao de venda nao existe — e nao e simetrica 🟠 ⚠️

**Cenario.** Comprador do ML cancela seis dias depois; a NF-e ja foi emitida e o item ja saiu do galpao. Uma semana depois o equipamento volta. Anderson quer: item de volta no estoque, reanunciado no ML e na OLX, venda fora do faturamento do mes e a situacao fiscal resolvida.

**O que quebra hoje.** Tres buracos, alem do `status = 'cancelado'` que ja existe. (a) **Fiscal:** `nfe_chave` e UM campo e `nfe_emitida` e UM booleano — a devolucao exige um SEGUNDO documento (nota de entrada de devolucao, ou cancelamento se dentro do prazo) e nao ha onde guardar a segunda chave nem o motivo. (b) **Estoque:** a RN-104 descreve so a ida. A volta **nao e simetrica**: reanunciar no ML gera um MLB novo, e `idx_anuncios_item_canal_ativo` (`anuncios.ts:64-66`, unico em `(item_id, canal) WHERE is_deleted = false`) impede um segundo anuncio ativo no mesmo canal — a volta obriga a soft-deletar o anuncio antigo antes de criar o novo, sequencia que ninguem definiu e que, fora de transacao, deixa a peca unica vendavel em dois canais. (c) **Enum:** ha `cancelado`, nao ha `devolvido` — e sao coisas diferentes (uma nunca saiu, a outra saiu e voltou).

**Consequencia.** Mercadoria que voltou sem contra-nota e risco fiscal concreto (a saida ficou registrada, a entrada nao). Item unico anunciado em duplicidade e venda dupla. E o faturamento do mes fica inflado por uma venda que nao existiu.

**Como prevenir.** Trocar o par `nfe_emitida`/`nfe_chave` por `pedidos_notas (tipo saida|devolucao|cancelamento, chave, status, emitida_em, motivo)` — um pedido pode ter N documentos fiscais. Adicionar `devolvido` ao enum. E uma unica action transacional e idempotente `reverterVenda(pedidoId)` fazendo o inverso exato da RN-104, com a mesma disciplina de idempotencia do webhook. **Antes de qualquer codigo**, o Anderson precisa dizer: item volta ao mesmo preco? conta como venda no mes? a comissao volta?

**Camada.** Banco + aplicacao. A regra e decisao humana.

---

### 9. O relogio do SLA nasce da NOSSA hora de gravacao 🟠

**Cenario.** Comprador pergunta as 09:00 no ML. O worker esta atrasado, ou o token estava expirando, ou houve reentrega: a pergunta entra no nosso banco as 09:40. Com `prazo_sla` calculado na insercao (09:40 + 4h = 13:40), o painel promete 4h que o ML nao esta contando — o relogio real venceu as 13:00. A pill fica neutra quando ja deveria estar ambar. O operador responde 12:50 achando que sobrou uma hora.

**O que quebra hoje.** `perguntas.prazo_sla` (`perguntas.ts:39`) e `timestamp NOT NULL` sem default e sem indicacao de origem — o comentario do arquivo diz "instante limite ja calculado **na entrada** da pergunta", e "entrada" hoje significa a nossa insercao. Nao existe coluna com o instante da pergunta no canal. E o KPI contamina junto: `src/lib/actions/perguntas.ts:66-68` calcula `segundosAteResposta` como `respondida_em − created_at`, e `created_at` e `defaultNow()` da NOSSA gravacao — o "Tempo medio de resposta" da Visao geral mede o nosso tempo interno, nao o que o comprador esperou. Todo atraso de ingestao **some da metrica**.

**Consequencia.** O sistema mente para o proprio operador na unica tela cuja tarefa e nao estourar prazo, e o relatorio fica sistematicamente otimista — o Anderson acha que o SLA esta saudavel enquanto a reputacao cai. Nao aparece em teste nenhum porque em dev a ingestao e instantanea.

**Como prevenir.** Coluna `criada_em_canal` gravada pelo worker a partir do payload buscado na API. `prazo_sla = criada_em_canal + meta`, nunca `now() + meta`. O KPI passa a sair de `respondida_em − criada_em_canal`. `created_at` continua sendo nossa hora, e a **diferenca entre as duas vira metrica util**: e o atraso de ingestao, o alarme antecipado de que a integracao esta engasgando. Casa com a pendencia de fuso ja registrada, mas e problema diferente — la e sobre o fuso do instante, aqui e sobre QUAL instante.

**Camada.** Banco (coluna) + aplicacao (a conta).

---

### 10. O optimistic locking exigido pelo CLAUDE.md nao funciona no schema atual 🟠 ⚠️ Lucas

**Cenario.** 9h00 o Anderson abre a ficha do item para corrigir o preco alvo. 9h01 o operador abre a mesma ficha para preencher o local do galpao. 9h03 o operador salva. 9h04 o Anderson salva. Pelo padrao "Controle de Colisao" do CLAUDE.md, o save do Anderson deveria falhar.

**O que quebra hoje. Dois motivos independentes.** (1) Nenhum schema em `src/lib/db/schema/` tem `.$onUpdate(...)` e a migracao nao cria trigger algum (grep confirmado): `updated_at` e `timestamp DEFAULT now()` e mais nada. Se o UPDATE esquecer de setar `updated_at` na mao, a coluna NUNCA muda e o `WHERE updated_at = $original` casa sempre — last-write-wins silencioso, com a auditoria mentindo sobre quando a linha mudou. O arquivo-ouro `templates/schema.ts:28` tem o mesmo defeito, entao **toda tabela criada por `/criar-tabela` nasce assim, em todos os projetos da casa**. (2) Pior e deterministico: `updated_at` guarda microssegundos (vindos de `now()`), e o parser do driver (`node_modules/postgres-date/index.js:33`, `ms = 1000 * parseFloat(ms)`) entrega isso ao construtor `Date`, que **trunca** para milissegundo. O valor que a tela devolve no WHERE **nunca** e igual ao gravado quando ha microssegundos — ou seja, conflito FALSO em praticamente toda primeira edicao.

**Consequencia.** Ou os dois usuarios se sobrescrevem em silencio — o preco alvo corrigido pelo Anderson some, num sistema cuja razao de existir e margem — ou, pelo motivo (2), o sistema acusa conflito onde nao ha, e em duas semanas o operador aprende a ignorar o aviso. Aviso que cria lobo mau morre como mecanismo.

**Como prevenir.** O robusto e o mais barato: coluna `versao integer NOT NULL DEFAULT 1`, com `SET versao = versao + 1 ... WHERE versao = $original` — inteiro monotonico nao tem precisao nem fuso para dar errado. As alternativas parciais: `timestamp("updated_at", { precision: 3 })` para o valor caber num `Date`, mais `.$onUpdate(() => new Date())` ou trigger `BEFORE UPDATE` (a versao que o BANCO garante e que sobrevive a UPDATE feito fora do Drizzle). Se a escolha for `versao`, muda `templates/schema.ts` e vale para todos os projetos — **decisao do Lucas, nao do Anderson**. Mesma migracao da pendencia de `timestamptz` ja aberta, e a janela e agora.

**Camada.** Banco.

---

### 11. Nenhuma escrita de integracao consegue gravar hoje: `modified_by` e NOT NULL com FK 🟠

**Cenario.** O worker termina de processar a venda e vai gravar `db.insert(pedidos)`. Falta `modified_by`. Nao ha sessao — quem disparou foi o Mercado Livre, nao uma pessoa. O insert quebra por NOT NULL, ou alguem resolve na pressa apontando para o usuario do Anderson, e a partir dai a trilha afirma que ele gravou pedidos as 03:14 da manha.

**O que quebra hoje.** As 6 tabelas de dominio tem `modified_by uuid NOT NULL` com FK RESTRICT para `usuarios.id`, e `auditoria.user_id` idem. Nao existe usuario de sistema. O `known-issues.md` registra o bootstrap de `usuarios.modified_by` sem FK, mas por **outro motivo** (auto-referencia) — quem assina as escritas automaticas nao esta registrado em lugar nenhum, e isso bloqueia a **primeira linha** de codigo de integracao.

**Consequencia.** Ou a integracao nao grava, ou a trilha passa a mentir sobre autoria. Auditoria com autoria falsa e pior que auditoria faltando, porque parece confiavel — e e ela que sustenta o Dashboard Owner e a defesa do "sumiu coisa".

**Como prevenir.** Usuario-semente com UUID fixo criado na migracao inicial (papel proprio ou `administrador` com `ativo = false` para nunca logar), constante em `src/lib/integracoes/usuario-sistema.ts`, usado por todo worker. A auditoria de acao automatica ganha `detalhes` com a origem ("webhook ML pedido 2195160686"). Resolve de quebra o bootstrap do primeiro usuario ja registrado em 🟡.

**Camada.** Banco (seed) + aplicacao (a constante).

---

### 12. Token do ML: nao ha onde guardar, e o refresh e de uso unico 🟠

**Cenario.** O access token do ML vive ~6h. As 06:00 expira; nesse instante o job de reconciliacao acorda e o worker esta processando uma pergunta. Os dois levam 401 e chamam `/oauth/token` com o MESMO refresh_token. O ML invalida o refresh no primeiro uso e devolve um novo — a segunda chamada falha e, dependendo da ordem de escrita, o perdedor sobrescreve o token bom com lixo. Nao ha recuperacao por codigo: alguem precisa abrir o navegador e reautorizar o app na conta de vendedor da MM.

**O que quebra hoje.** Nao existe lugar para guardar token — nenhuma das 7 tabelas tem coluna de credencial, e o `.env.example` (linhas 18-21) so preve `ML_CLIENT_ID`/`ML_CLIENT_SECRET`/`ML_REDIRECT_URI`/`ML_WEBHOOK_URL`. Variavel de ambiente **nao serve** para um valor que rotaciona a cada 6h: trocar exigiria redeploy. Nao ha `src/lib/integracoes/`.

**Consequencia.** Janela cega de horas ate alguem perceber, e o unico sintoma e a tela Integracoes — que, pelo proprio `known-issues.md`, nao tem estado de erro nem botao de reconectar. Perguntas nao chegam (SLA estourando em serie), vendas nao chegam (RN-104 nao dispara).

**Como prevenir.** Tabela `integracoes_credenciais (canal, conta_externa_id, access_token, refresh_token, expira_em, escopo + auditoria)`, **token cifrado em repouso** — quem le esse registro publica e despublica anuncio na conta do cliente. A troca roda sob `pg_advisory_xact_lock(hashtext('ml_refresh'))`: quem pega o lock refaz o token, quem perde espera e le o novo — single-flight sem Redis. Refresh **proativo** por job em ~80% da vida do token, com o 401 virando excecao e nao rotina. Alarme quando `expira_em` passa sem renovacao.

**Camada.** Banco.

---

### 13. Sem marca d'agua de sincronizacao, notificacao perdida so aparece quando o segundo comprador paga 🟠 ⚠️

**Cenario.** O ML fica instavel por duas horas na terca e uma notificacao de venda simplesmente nao chega — nenhum marketplace garante 100% de entrega. Ninguem percebe: o painel nao tem como saber que **nao** recebeu algo. O item continua "anunciado", continua no ar na OLX e continua no site. Na quinta um comprador da OLX fecha o mesmo item.

**O que quebra hoje.** Nenhuma coluna diz quando cada anuncio ou pedido foi conferido contra o canal pela ultima vez — `anuncios` tem `updated_at` (que muda por edicao nossa, nao por confirmacao do canal) e nada mais. Nao ha tabela de sincronizacao com watermark. A tela Integracoes e so leitura e o log do prototipo e mock.

**Consequencia.** Mesmo dano do caso 2, por um caminho que **nenhuma idempotencia pega** — nao da para ser idempotente sobre um evento que nunca chegou. Sem reconciliacao, o unico detector e o cliente reclamando.

**Como prevenir.** Job periodico (15-30 min, na lane de varredura) que lista pedidos do ML desde a ultima marca d'agua e o status dos anuncios ativos, compara com o local e registra a divergencia. `integracoes_sincronizacoes (canal, recurso, ultimo_sucesso_em, ate_qual_instante, resultado)` da o watermark e alimenta o alarme de obsolescencia: passou X minutos sem sincronizacao bem-sucedida, o card fica vermelho — que e o estado de erro que hoje nao existe no desenho. **Decisao do Anderson:** a reconciliacao CORRIGE sozinha ou so REPORTA? Corrigir automaticamente uma divergencia que ninguem entendeu pode pausar anuncio certo por leitura errada. Recomendacao: reportar por padrao, e auto-corrigir so o caso "canal diz vendido e nos nao sabiamos" — o unico sentido em que o erro e seguro.

**Camada.** Aplicacao.

---

### 14. A janela entre negociar e vender nao tem dono 🟠 ⚠️

**Cenario A (WhatsApp).** 15h00 o lead ve a lampada de fenda na vitrine e clica "Consultar disponibilidade" (RN-111). 15h20 fecha com o Anderson por R$ 5.000 e diz que vai fazer o Pix. 15h35 o mesmo item vende no ML pelo preco cheio. 16h10 o Anderson registra a venda do WhatsApp — item ja vendido. **Ninguem errou:** os 50 minutos entre o aperto de mao e o registro sao invisiveis para qualquer transacao ou constraint.

**Cenario B (boleto/Pix pendente).** 22h10 o comprador clica comprar no ML e escolhe boleto. O ML cria o pedido NA HORA; o dinheiro pode entrar em minutos, em tres dias, ou nunca. Nesse intervalo o item segue "anunciado" na OLX e no site. 22h40 outra pessoa compra e paga na hora. No dia seguinte o boleto e pago. Duas vendas pagas — e nenhuma pode ser chamada de erro do sistema, porque ninguem definiu que a primeira reservava.

**O que quebra hoje.** `situacao_item` (`itens.ts:18-24`) tem **`reservado`** e NENHUM caminho do sistema o atribui. Nao existe `reservado_ate` nem job de expiracao, e `status_pedido` comeca em `aguardando_envio` — estado que ja afirma que a venda esta fechada e o pagamento resolvido. O KPI "Reservados 2" da tela Estoque **nao tem de onde sair**. Nao existe acao de registrar venda direta (`src/lib/actions/` so tem `perguntas.ts`, e so leitura).

**Consequencia.** As duas escolhas custam dinheiro e a decisao e comercial, nao tecnica: NAO reservar significa aceitar venda dupla ocasional de peca de ticket alto; reservar significa tirar do mercado por ate 3 dias uma peca de um negocio que ja e de giro lento, por um boleto que pode nunca ser pago.

**Como prevenir.** A mecanica ja esta desenhada: a transicao para `reservado` passa pelo MESMO caminho da venda (transacao + `FOR UPDATE` no item), senao uma reserva e uma venda correm entre si; `reservado_ate` + job que devolve para "anunciado" por compare-and-set (`WHERE situacao = 'reservado' AND reservado_ate < now()`) para nao desfazer uma reserva que virou venda no meio da varredura. A venda direta usa a mesma action e, quando perde, precisa devolver **quem ganhou e quando** — "vendido no Mercado Livre as 15h35, pedido 2000012345" — para o Anderson agir enquanto o comprador ainda esta no telefone.

**O que NAO da para automatizar:** a regra. Pagamento pendente reserva ou nao? Por quanto tempo? O operador pode reservar durante negociacao no WhatsApp? Se a resposta for "nao reserva", **a janela continua aberta e o sistema so consegue DETECTAR o conflito depois, nunca preveni-lo** — e vale dizer isso com todas as letras em vez de fingir que um lock resolve. Hoje o enum promete um estado que o sistema nao sabe usar.

**Camada.** Processo humano decide; aplicacao executa.

---

### Menores (verificados, baixo custo, sem RN propria)

- **Duas respostas na mesma pergunta.** A tela e `force-dynamic` e a RN-105.1 poe a mais urgente no topo — **por desenho, os dois usuarios atacam a mesma pergunta primeiro**. No ML resposta e publica; duas respostas divergentes num item de R$ 5.000 (um dos modelos previstos e "Negociacao de preco") e vexame, e o painel guarda so uma das duas. Correcao barata, e vale como **padrao da casa** para todo botao de acao unica: compare-and-set numa instrucao — `UPDATE perguntas SET status='respondida', resposta=$1, ... WHERE id=$3 AND status='pendente' AND is_deleted=false RETURNING id`. Quem recebe a linha e o dono e so ele chama a API; o outro recebe "ja respondida por X as 14h02". Nao precisa de transacao nem `FOR UPDATE`: o row lock do proprio UPDATE serializa.
- **429 do ML e do app inteiro, nao da chamada.** Sendo honesto: com ~50 itens e 2 usuarios o trafego normal nao chega perto da cota. Quem estoura e o **proprio codigo** — varredura em massa disparada por um clique, loop de reentrega, retry cego em erro que nao e 429. Um unico portao (`src/lib/integracoes/mercado-livre/client.ts`, ninguem chama `fetch` direto — mesma disciplina do `pricing.ts`) com duas lanes: URGENTE (disparado por webhook) sempre na frente de VARREDURA (reputacao, visitas, reconciliacao). Em 429, pausar o portao compartilhado, nao so a chamada. Nunca retry de 4xx que nao seja 429/401. Nao cravar numero de cota por chute.
- **O canal que avisa que o SLA vai estourar tambem pode falhar calado.** 23h30 de sexta, alerta por WhatsApp falha (template nao aprovado, janela de 24h fechada, credito acabado) e morre num log. Tabela `notificacoes (destinatario, canal, motivo, referencia, tentativas, enviado_em, erro)` — alerta enviado e fato auditavel, nao `console.log`; falha de entrega vira badge no painel, para o **proprio painel ser o fallback** que nao depende de terceiro; deduplicacao por (pergunta, faixa de urgencia) para o job de 1 minuto nao mandar 60 mensagens. Parte disso e honestamente processo: se o Anderson silencia o WhatsApp a noite, nenhuma arquitetura resolve — vale combinar horario de cobertura.

---

## Regras novas — texto pronto para `docs/regras-negocio.md`

> **Atencao a numeracao:** o pedido dizia "a partir de RN-112", mas **RN-112 ja existe** (compra simultanea, implementada e provada). Comeco em **RN-113**.

### RN-113 - Frete de saida faz parte do preco e do resultado da venda ⚠️
- **Definida por**: ⚠️ pendente de confirmacao do Anderson
- **Data**: 2026-08-10
- **Modulo**: Precificacao, Pedidos, Relatorios
- **Descricao**: o `frete` da RN-100 e o frete de **entrada** (retirada do lote). O frete de **saida** — a etiqueta que o vendedor paga em item acima de R$ 79 no ML, ou o envio combinado na venda direta — nao existe hoje em lugar nenhum e sai inteiro da margem.
- **Comportamento esperado**: `base = custo + frete_entrada + frete_saida_estimado`, com o novo termo nascendo em `src/lib/pricing.ts` (invariante 1). Em `pedidos`, gravar `frete_saida` com o valor REAL descontado pelo canal, e `liquido = valor − taxa − comissao − frete_saida`.
- **⚠️ A confirmar com o Anderson**: em qual canal a MM absorve o frete, em qual cobra do comprador, e o que e retirada em maos. Sem isso a formula nao pode mudar.
- **Impacto se descumprida**: prejuizo proporcional ao peso, invisivel na tela e visivel so no extrato. Item de 40 kg pode perder ~25% do lucro previsto, e a margem verde ≥30% da RN-103 vira falsa.

### RN-114 - O pedido e um retrato, nao um ponteiro
- **Definida por**: Paulo (sintese de auditoria)
- **Data**: 2026-08-10
- **Modulo**: Pedidos, Relatorios, Equipe
- **Descricao**: `pedidos` grava o realizado da venda, mas hoje nao guarda o custo do item nem a data em que a venda aconteceu. Corrigir o custo de um lote em abril muda a margem de marco; registrar uma venda de WhatsApp com 5 dias de atraso joga o faturamento para o mes seguinte.
- **Comportamento esperado**: gravar no fechamento `custo_apurado` (snapshot do custo do item), `vendido_em` (instante informado pelo canal, ou digitado na venda direta) e `taxa_origem` ('canal' | 'estimada'). **Todo agrupamento financeiro e por `vendido_em`**; `created_at` volta a ser so trilha. Relatorio de dinheiro soma colunas de `pedidos` e **nunca** faz join com `itens` para calcular margem. CHECK em banco: `liquido = valor − taxa − comissao − frete_saida`.
- **Impacto se descumprida**: fechamento de mes deixa de ser reproduzivel (contraria a RN-004), comissao do dia 5 paga o mes errado, e o painel nunca bate com o extrato do ML — o dono volta para a planilha.

### RN-115 - "Vendido" e estado terminal: sincronizacao nunca reabre um item
- **Definida por**: Paulo (sintese de auditoria)
- **Data**: 2026-08-10
- **Modulo**: Estoque, Anuncios, Integracoes
- **Descricao**: notificacoes de canal chegam fora de ordem (retry do marketplace, eco da nossa propria acao). Um evento atrasado pode escrever um estado antigo por cima do atual e devolver um item vendido para "anunciado".
- **Comportamento esperado**: (a) todo UPDATE vindo de integracao carrega o instante do evento e so grava se ele for **mais novo** que o ultimo aplicado (`AND fonte_atualizado_em < $instante_do_evento`); (b) de `situacao = 'vendido'` so se sai por cancelamento/devolucao explicitos — jamais por sync.
- **Impacto se descumprida**: peca ja vendida reabre nos tres canais. A RN-112 nao alcanca este caminho: o indice impede o segundo **registro**, nao a segunda **compra** — o comprador paga e nos nao conseguimos gravar.

### RN-116 - O efeito colateral da RN-104 e tarefa persistida, nao chamada solta
- **Definida por**: Paulo (sintese de auditoria)
- **Data**: 2026-08-10
- **Modulo**: Integracoes, Estoque, Site
- **Descricao**: a RN-104 termina em chamadas HTTP a terceiros (pausar na OLX, pausar no ML, tirar do site). Terceiro cai, demora ou devolve 500. Chamada externa nao faz rollback, e transacao aberta esperando HTTP trava o banco.
- **Comportamento esperado**: **zero chamada externa dentro de transacao de banco**. Na MESMA transacao que grava o pedido, gravar N linhas de tarefa (`integracoes_tarefas`) — commit atomico. Worker separado drena com `FOR UPDATE SKIP LOCKED`, backoff e limite de tentativas; tarefa estourada vira `falha` e **aparece na tela Integracoes**. Em `anuncios`, separar `status` (confirmado pelo canal) de `status_desejado` (decidido por nos) + `sincronizado_em`; enquanto divergem, o painel mostra "pausa pendente" em ambar. A invalidacao do cache do site publico e responsabilidade do worker, nunca da requisicao.
- **Impacto se descumprida**: a RN-104 executa pela metade — item vendido segue anunciado num canal e ninguem reprocessa. E o dano que a RN-104 existe para impedir, com o agravante de parecer que deu certo.

### RN-117 - Webhook: responder rapido, nunca confiar no corpo
- **Definida por**: Paulo (sintese de auditoria)
- **Data**: 2026-08-10
- **Modulo**: Integracoes
- **Descricao**: o marketplace envia um envelope com o ID do recurso, espera 200 em fracao de segundo e **reentrega** se demorar; apos falhas seguidas, suspende as notificacoes da aplicacao inteira. A URL e publica e vaza com facilidade.
- **Comportamento esperado**: o handler faz tres coisas — valida a origem, insere UMA linha em `integracoes_eventos` (com unico natural do evento) e retorna 200. Nada de API externa no request. Nunca `SELECT` antes de `INSERT`: usar `ON CONFLICT DO NOTHING RETURNING` — se nao voltou linha, e reentrega e nada mais executa. **Os dados vem sempre de um GET na API do canal com o nosso token**; o corpo do POST so diz qual recurso olhar, e o evento e descartado se o recurso nao existir ou se a conta nao bater com a do vendedor conectado.
- **Impacto se descumprida**: notificacoes suspensas pelo ML = vendas e perguntas param de entrar **em silencio**, e parece que so nao vendeu. E um POST forjado pausa os anuncios reais nos tres canais sem venda nenhuma.

### RN-118 - O SLA conta do instante em que o comprador perguntou
- **Definida por**: Paulo (sintese de auditoria)
- **Data**: 2026-08-10
- **Modulo**: Perguntas, Relatorios
- **Descricao**: hoje `prazo_sla` e o KPI de tempo de resposta saem da nossa hora de gravacao. Atraso de ingestao (worker parado, token expirando, reentrega) desaparece da conta e o painel promete um prazo que o marketplace nao esta contando.
- **Comportamento esperado**: gravar `criada_em_canal` a partir do payload do canal. `prazo_sla = criada_em_canal + meta`, nunca `now() + meta`. O KPI sai de `respondida_em − criada_em_canal`. A diferenca entre `created_at` e `criada_em_canal` vira metrica propria: e o atraso de ingestao, e serve de alarme antecipado.
- **Impacto se descumprida**: o sistema mente para o operador na unica tela cuja tarefa e nao estourar prazo, e o relatorio fica sistematicamente otimista enquanto a reputacao cai.

### RN-119 - Reserva durante negociacao ⚠️
- **Definida por**: ⚠️ pendente de decisao do Anderson
- **Data**: 2026-08-10
- **Modulo**: Estoque, Pedidos, Site
- **Descricao**: existe uma janela entre "combinado" e "registrado" — o Pix prometido no WhatsApp, o boleto do ML que so compensa em tres dias. Nesse intervalo a peca unica continua anunciada nos outros canais. O enum `situacao_item` ja tem `reservado` e **nada no sistema o atribui**; o KPI "Reservados 2" da tela Estoque nao tem de onde sair.
- **⚠️ A confirmar com o Anderson**: (a) pagamento pendente no ML reserva o item? por quanto tempo? (b) o operador/dono pode reservar manualmente durante negociacao no WhatsApp? (c) o que acontece quando a reserva expira?
- **Comportamento esperado (se a resposta for "reserva")**: a transicao para `reservado` passa pelo MESMO caminho da venda (transacao + `FOR UPDATE` no item); `reservado_ate` + job de expiracao por compare-and-set. Se a resposta for "nao reserva", **registrar explicitamente que a janela e aceita** — o sistema so conseguira detectar o conflito depois, nunca preveni-lo, e a venda direta deve pelo menos informar quem ganhou e quando.
- **Impacto se descumprida**: duas vendas pagas da mesma peca sem que nenhuma seja erro de software — ou peca de giro lento fora do mercado por tres dias por um boleto que nunca sera pago.

### RN-120 - Reversao de venda: devolucao nao e o inverso automatico da venda ⚠️
- **Definida por**: ⚠️ pendente de decisao do Anderson
- **Data**: 2026-08-10
- **Modulo**: Pedidos, Estoque, Anuncios, Fiscal
- **Descricao**: comprador cancela depois da NF-e emitida e do item despachado; o equipamento volta. A RN-104 descreve so a ida, e a volta nao e simetrica — reanunciar gera um ID novo no canal, e o unico `idx_anuncios_item_canal_ativo` impede um segundo anuncio ativo no mesmo canal enquanto o antigo existir.
- **Comportamento esperado**: `pedidos_notas` (um pedido pode ter N documentos fiscais: saida, devolucao, cancelamento), valor `devolvido` no enum de status, e uma unica action transacional e idempotente `reverterVenda(pedidoId)` que soft-deleta o anuncio antigo antes de criar o novo, devolve o item ao estoque e reabre o site — tudo na mesma transacao.
- **⚠️ A confirmar com o Anderson**: item volta a ser anunciado pelo mesmo preco? a venda revertida conta no faturamento do mes? a comissao de 4% volta?
- **Impacto se descumprida**: mercadoria de volta sem contra-nota e risco fiscal (a saida ficou registrada, a entrada nao); item unico anunciado em duplicidade e venda dupla; e o faturamento do mes fica inflado por uma venda que nao existiu.

### RN-121 - NF-e: timeout nao e falha, e desconhecido
- **Definida por**: Paulo (sintese de auditoria)
- **Data**: 2026-08-10
- **Modulo**: Expedicao, Fiscal
- **Descricao**: emissor fiscal depende da SEFAZ e demorar 30s e rotina. Tratar timeout como falha e reemitir gera **duas notas** para uma venda — e desfazer isso tem prazo legal curto. No outro extremo, nota **rejeitada** e hoje visualmente identica a "ainda nao emitida", e nada impede o despacho seguir sem documento.
- **Comportamento esperado**: (a) enviar `pedidos.id` como referencia de idempotencia ao emissor — reenviar a mesma referencia devolve a nota ja emitida; (b) reivindicar a linha antes da chamada (`UPDATE ... SET nfe_emissao_iniciada_em = now() WHERE nfe_emissao_iniciada_em IS NULL RETURNING id`): quem nao recebe linha nao chama o emissor; (c) unico em `nfe_chave` entre nao deletados, mais `nfe_status`/`nfe_motivo` com estado de rejeicao visivel na tela, e CHECK impedindo `etapa_expedicao` avancar sem nota. **Ao expirar um timeout, o proximo passo e CONSULTAR pela referencia, jamais reemitir.**
- **Impacto se descumprida**: nota duplicada vira ajuste contabil e conversa com contador; nota rejeitada em silencio vira mercadoria despachada sem documento e despacho atrasado — falha de reputacao pela RN-106.

---

## O que fazer com o que nao vira RN

Estes sao mecanica, nao regra de negocio — vao para `docs/known-issues.md` e/ou ADR, nao para `regras-negocio.md`:

- **Optimistic locking quebrado** (caso 10) → 🟡 known-issues + **ADR**, porque muda `templates/schema.ts` e vale para todos os projetos da casa. Decisao do Lucas.
- **Usuario-semente para escritas automaticas** (caso 11) → 🟡 known-issues, fundido com o item de bootstrap do `usuarios.modified_by` que ja esta la.
- **Fila em Postgres em vez de BullMQ/Redis** (dentro do caso 2) → **ADR obrigatorio**: contraria o padrao escrito do CLAUDE.md. Decidir junto onde o worker roda e como sobe.
- **Tabela de credenciais do ML com refresh sob advisory lock** (caso 12) → 🟡 known-issues, ligado ao item "Credenciais do Mercado Livre".
- **Reconciliacao periodica** (caso 13) → 🟡 known-issues com a pergunta ⚠️ "reporta ou corrige?" para o Anderson.
- **`max` no Pool, `limit_req` no nginx, lanes de prioridade, tabela `notificacoes`** (menores) → 🟡 known-issues.
- **Sair do known-issues (ja resolvido):** o item "Pedido cancelado nao tem estado — e vira soft delete". O enum tem `cancelado` desde a migracao `0001` e o indice parcial da `0002` ja o usa.

---

## (a) O que da para implementar JA, no schema/codigo atual

Uma migracao unica, com o banco local ainda descartavel. Nao depende de integracao nem de decisao:

| Item | Onde | Caso |
|---|---|---|
| `pedidos.custo_apurado`, `vendido_em`, `taxa_origem`, `conciliado_em` | migracao + `schema/pedidos.ts` | 5 |
| CHECK `liquido = valor − taxa − comissao − frete_saida` | migracao | 5 |
| `perguntas.criada_em_canal` + corrigir `segundosAteResposta` em `actions/perguntas.ts:66-68` | migracao + action | 9 |
| `fonte_atualizado_em` em `itens` e `anuncios` | migracao | 6 |
| `versao integer` (ou `precision: 3` + `$onUpdate`) em todas as tabelas | migracao + `templates/schema.ts` | 10 |
| Usuario-semente com UUID fixo | migracao inicial + `src/lib/integracoes/usuario-sistema.ts` | 11 |
| Unico em `nfe_chave`, `nfe_emissao_iniciada_em`, `nfe_status`, `nfe_motivo` | migracao | 7 |
| `max` explicito no `Pool` | `src/lib/db/index.ts:24` | 3 |
| Padrao "primeiro clique ganha" (CAS numa instrucao) documentado | `docs/back.md` | menores |
| Decidir junto com a pendencia de `timestamptz` ja aberta | mesma migracao | — |

E a tarde mais barata deste projeto. Depois de HML/PRD, cada uma dessas linhas vira ALTER em producao.

## (b) O que so nasce junto da integracao

Nao adianta construir antes de existir credencial e URL publica — mas **precisa estar desenhado antes da primeira linha**, porque define o formato de todo o codigo de integracao:

- `integracoes_eventos` (ack rapido, idempotencia real, replay, DLQ) — caso 3
- `integracoes_tarefas` (outbox da RN-104) + worker + `status_desejado`/`sincronizado_em` em `anuncios` — caso 2
- `integracoes_credenciais` cifrada + refresh sob advisory lock — caso 12
- `integracoes_sincronizacoes` (watermark) + job de reconciliacao — caso 13
- Cliente unico do ML com duas lanes e tratamento de 429 — menores
- `pedidos_notas` + `reverterVenda()` — caso 8
- `notificacoes` com falha de entrega visivel no painel — menores
- Autenticidade do webhook: variavel de segredo no `.env.example` (hoje o ML nao tem nenhuma), allowlist no nginx, e o invariante "os dados vem do GET" — caso 4

## (c) O que e decisao humana — nenhuma linha de codigo antes da resposta

| Pergunta | Para quem | Trava o que |
|---|---|---|
| Em qual canal a MM absorve o frete de saida? Quanto e retirada em maos? | **Anderson** | RN-113, a formula de preco inteira |
| Pagamento pendente reserva o item? Por quanto tempo? O operador pode reservar durante negociacao? | **Anderson** | RN-119, o estado `reservado` orfao, o KPI da tela Estoque |
| Devolucao: item volta ao mesmo preco? conta no faturamento? a comissao volta? | **Anderson** | RN-120, `pedidos_notas` |
| A reconciliacao corrige sozinha ou so reporta? | **Anderson** | caso 13 |
| `versao` no lugar de `updated_at` para optimistic locking — muda o template da base? | **Lucas** | caso 10, todos os projetos da casa |
| Fila em tabela Postgres em vez de BullMQ/Redis — abre excecao ao CLAUDE.md? Onde roda o worker? | **Lucas** | caso 2, ADR |
| Base da comissao (bruto x liquido) e taxa real do ML | **Anderson** | ja registrado, mas agora bloqueia tambem a RN-114 |

E a parte honesta: no caso 14, se a resposta do Anderson for "nao reserva", **nenhuma arquitetura fecha a janela**. O sistema so vai conseguir detectar o conflito depois. Vale escrever isso na regra em vez de fingir que um lock resolve.

---

# Anexo — lente OPERACAO (nao passou pela sintese)

> Esta lente completou os 11 casos, mas o JSON chegou truncado no agregador e
> **nao foi deduplicada nem verificada** como as outras. Tratar como material
> bruto: alguns casos ja estao resolvidos (a trava de compra simultanea da
> RN-112 e o status cancelado, ambos aplicados nas migracoes 0001/0002).
> Os dois primeiros foram conferidos manualmente e **procedem**.

## [critico] Dois compradores, dois canais, um item so — o banco deixa passar

**Cenario.** Sabado 14h02: um comprador fecha a 'Encadernadora industrial' no Mercado Livre. 14h02m40s: outro fecha o MESMO item na OLX — ninguem pausou nada ainda, porque a pausa depende do webhook do ML chegar, ser processado e a chamada a API da OLX ter sucesso. Os dois webhooks batem quase juntos, possivelmente em instancias diferentes do Next. Cada um insere um pedido, cada um marca o item como vendido. Os dois passam, sem erro nenhum.

**Quebra hoje.** src/lib/db/schema/pedidos.ts: o unico indice unico e `idx_pedidos_canal_numero` em (canal, numero), que so impede reprocessar o MESMO evento. Nao existe indice unico em item_id — `idx_pedidos_item` e indice comum. Pior: o comentario do `statusPedidoEnum` afirma textualmente 'E e ele que libera o item para ser revendido (ver indice de item ativo)' — esse indice nao existe nem no schema nem em src/lib/db/migrations/0000_far_loners.sql. A garantia esta prometida em comentario e ausente no banco, o que e pior que nao ter comentario: o proximo dev le e confia. Nenhuma action de venda existe, entao tambem nao ha lock de aplicacao.

**Consequencia.** Item unico vendido duas vezes. Um dos compradores e cancelado, e cancelamento por falta de estoque e a falha que mais pesa na reputacao do vendedor no ML: derruba posicao do anuncio e ameaca o selo. Numa operacao de ticket alto e giro lento, e uma venda de milhares de reais que vira reclamacao — e o item continua parado no galpao.

**Prevencao.** BANCO (garantia real): indice unico parcial `CREATE UNIQUE INDEX idx_pedidos_item_ativo ON pedidos (item_id) WHERE status <> 'cancelado' AND is_deleted = false`. A segunda venda estoura 23505 e vira 'item ja vendido' em vez de segundo pedido. APLICACAO (evita a corrida antes de chegar la): a acao de venda abre com `SELECT ... FROM itens WHERE id = $1 FOR UPDATE`, serializando as duas requisicoes concorrentes antes de decidir, e trata 23505 como resultado de negocio, nao como erro 500. Mora numa migracao nova + `src/lib/actions/vendas.ts` (ainda inexistente). Depende do caso do enum `cancelado` ser resolvido antes — o predicado do indice usa esse valor.

*Camada: banco*

---

## [critico] A venda quebra no meio: o que vai na transacao e o que nunca pode ir

**Cenario.** O webhook do ML avisa a venda. O handler faz: 1) insere o pedido, 2) marca o item como vendido, 3) chama a API da OLX para pausar o anuncio, 4) tira do site / avisa no WhatsApp, 5) grava auditoria. Na etapa 3 a OLX responde 502 depois de 20 segundos. Se tudo estiver numa transacao, ela da rollback: o pedido some do sistema, mas a OLX pode ter pausado antes de estourar. Se nao houver transacao nenhuma, o pedido entra, o item fica vendido e o anuncio da OLX segue no ar — e o item volta ao caso da venda dupla.

**Quebra hoje.** Nao existe `src/lib/actions/vendas.ts` nem rota de webhook. `src/lib/db/index.ts` exporta `db` e nada no projeto usa `db.transaction` — o unico consumidor e `src/lib/actions/perguntas.ts`, que so le. O Pool e criado sem `max` (`new Pool({ connectionString })`), ou seja, 10 conexoes por processo: uma transacao aberta esperando 20s por HTTP externo segura conexao e lock de linha, e uma dezena de webhooks lentos trava o painel inteiro.

**Consequencia.** Ou venda que nao aparece no relatorio — dinheiro invisivel no fechamento mensal e na comissao do dia 5 (RN-108) —, ou anuncio vivo num canal onde o item ja nao existe, que e o dano de reputacao da RN-104. Em qualquer dos dois o Anderson descobre pelo comprador e conferencia vira trabalho manual canal a canal.

**Prevencao.** Fronteira explicita. DENTRO de uma transacao: insert do pedido, update do item, update do status LOCAL dos anuncios, insert da auditoria e o insert de uma linha de outbox por efeito externo pretendido. FORA, nunca dentro: toda chamada HTTP (ML, OLX, WhatsApp, NF-e). O motivo e concreto: chamada externa nao tem rollback — se a transacao abortar depois do POST, o mundo externo ja mudou e o banco finge que nao; e o tempo de rede vira tempo de lock e de conexao ocupada. A entrega fica com um worker que le a outbox, chama a API com chave de idempotencia, faz retry com backoff e manda para DLQ apos N tentativas (BullMQ + Redis, ja prescrito no CLAUDE.md). Como a API pode ter sucesso sem a gente saber, um job diario de reconciliacao compara o status dos nossos anuncios com o do canal. O banco garante so a atomicidade do par (venda + intencao de efeito); o resto e aplicacao.

*Camada: aplicacao*

---

## [alto] O status `cancelado` existe no TypeScript e nao existe no banco

**Cenario.** Anderson cancela um pedido devolvido. A action roda `update(pedidos).set({ status: 'cancelado' })`. O TypeScript compila sem reclamar — o enum do Drizzle tem o valor. O Postgres devolve 22P02 `invalid input value for enum status_pedido: "cancelado"`. O erro so aparece no primeiro cancelamento real, em producao.

**Quebra hoje.** src/lib/db/schema/pedidos.ts declara `statusPedidoEnum` com 4 valores (aguardando_envio, em_transporte, concluido, cancelado). A migracao aplicada src/lib/db/migrations/0000_far_loners.sql:7 cria o tipo com 3 — sem `cancelado` — e meta/0000_snapshot.json idem. O schema foi editado sem rodar `npm run db:generate`. Nada detecta: scripts/check-compliance.mjs so valida colunas de auditoria dentro de pgTable, .github/workflows/deploy.yml roda lint/typecheck/test/build e nenhum deles olha migracao, e scripts/db/prova-constraints.sql testa o banco (que esta certo em relacao ao SQL) e nao a diferenca entre TS e SQL. O docs/known-issues.md ainda registra 'pedido cancelado nao tem estado' como pendencia aberta, entao o proprio doc esta atras do codigo.

**Consequencia.** Falha em runtime no exato momento em que ela mais atrapalha — cancelamento e o caminho de devolver o item ao estoque. E ha um efeito em cascata: o indice unico que protege contra venda dupla (caso 1) precisa do predicado `status <> 'cancelado'`, ou seja, a protecao mais critica do sistema depende de um valor que o banco nao conhece.

**Prevencao.** BANCO, com trava no CI. Correcao imediata: gerar a migracao 0001 com `ALTER TYPE status_pedido ADD VALUE 'cancelado'` (no PG16 roda em bloco de transacao, mas o valor novo nao pode ser usado na mesma transacao — a migracao que criar o indice parcial precisa ser separada). Trava permanente: passo no job `ci` do .github/workflows/deploy.yml que roda `drizzle-kit generate` num checkout limpo e falha se `git status --porcelain` sair sujo. Assim drift de schema deixa de ser honra e vira quebra de build — e o mesmo passo protege todos os projetos que usam esta base.

*Camada: banco*

---

## [alto] RN-107: o vazamento nao e a coluna `custo`, e o numero que se deriva dela

**Cenario.** O operador abre o Estoque. O servidor removeu a coluna `custo` — a regra parece cumprida. Mas a tela mostra `preco_alvo`, que saiu de `calcularPreco` com uma margem padrao. Como preco = (custo+frete)/d, o operador inverte de cabeca: com margem 35% no ML, custo+frete = preco_alvo x 0,47. Item com preco alvo de R$ 7.000 entrega custo de arremate ~R$ 3.290. Na tela de Lotes e ainda mais direto: o card mostra o valor anunciado e uma barra de '% do custo recuperado' — custo_total = anunciado / percentual, sem nenhuma conta dificil.

**Quebra hoje.** Nao existe camada de leitura por papel. `src/lib/actions/perguntas.ts` e a unica action e faz select com lista explicita de colunas (padrao correto), mas nada impede a proxima fazer `db.select().from(itens)` e devolver o tipo `Item`, que inclui `custo` — e o tipo nao acusa nada. `src/lib/db/schema/itens.ts` guarda `preco_alvo` como resultado (o frete e a margem que o produziram nao sao gravados), e `src/lib/pricing.ts` e modulo puro sem `import "server-only"`: a formula e TAXA_CANAL sao publicas por design. Caminhos de plumbing que um dev cria sem perceber, todos ja presentes no formato do codigo atual: (1) Server Component busca a linha inteira e passa para um Client Component — o objeto vai serializado no payload RSC, legivel no ver-codigo-fonte e na aba Network mesmo sem ser renderizado; o par src/app/(painel)/perguntas/page.tsx -> _components/lista-perguntas.tsx e exatamente esse formato, hoje inofensivo porque pergunta nao tem custo; (2) `console.error(error)` num boundary, como em src/app/(painel)/perguntas/error.tsx:21 — em desenvolvimento o Next entrega mensagem e stack ao cliente, e erro do Drizzle carrega query e parametros; (3) cache de rota servindo ao operador o HTML renderizado para o administrador (a tela de Perguntas ja precisou de `force-dynamic` por outro motivo — as de custo precisam por este); (4) export CSV/PDF e geracao de etiqueta no servidor, que passam por fora do componente que 'esconde' a coluna.

**Consequencia.** O operador em treinamento fica sabendo quanto o Anderson pagou no leilao. E a informacao que define o negocio inteiro — sai da empresa junto com a pessoa e reaparece como concorrencia no proximo leilao. E o vazamento nao deixa rastro: nenhuma dessas rotas grava nada.

**Prevencao.** APLICACAO. Uma camada de leitura por papel: funcoes em `src/lib/actions/*` com `import "server-only"` no topo, devolvendo DTOs explicitos (`ItemParaOperador`) em vez do tipo `Item` — nunca `select()` sem lista de colunas em tabela com custo. Regra de revisao que casa com a invariante 5 do CLAUDE.md: se o tipo que cruza a fronteira servidor->cliente vem de `$inferSelect`, esta errado por construcao. Reforco de BANCO, se valer o custo: role do Postgres sem SELECT em itens.custo/lotes.custo_total e conexao por papel — caro para 2 usuarios, mas e o unico jeito de a regra sobreviver a um dev distraido. DECISAO DO ANDERSON, e ela e o no do caso: `preco_alvo` conta como preco de venda (o operador precisa dele para trabalhar) ou como derivado do custo (nao pode ver)? A RN-107 nao responde, e enquanto nao responder qualquer implementacao esta chutando. O mesmo vale para a barra de % do lote.

*Camada: aplicacao · depende de decisao humana*

---

## [alto] Nada obriga a auditoria a acontecer — e `detalhes NOT NULL` bloqueia o unico mecanismo que obrigaria

**Cenario.** Tres meses depois do go-live o Anderson pergunta: quem apagou o item MM-OFT-1401? Foram escritos 30 fluxos de escrita; 26 chamam o registro de auditoria e 4 nao — os 4 que alguem escreveu com pressa. O item 1401 esta num dos 4.

**Quebra hoje.** src/lib/db/schema/auditoria.ts existe e esta bem desenhada (append-only, FK RESTRICT em user_id, indices para o dashboard), mas NENHUMA linha do projeto escreve nela: nao existe `src/lib/audit/`, nao existe wrapper obrigatorio, nao existe trigger. O scripts/check-compliance.mjs valida colunas dentro de pgTable, nao chamadas de funcao — nao ha como ele pegar a omissao. Alem disso: `modified_by` e notNull em 6 tabelas mas nada verifica que o uuid passado e o da sessao (sem autenticacao, known-issues 🔴, qualquer valor passa), e a aplicacao conecta como dono do banco — 'append-only' e comentario, um `DELETE FROM auditoria` roda normalmente.

**Consequencia.** A trilha e a defesa contratual quando o cliente diz 'sumiu coisa' e e a base do Dashboard Owner/Admin prometido (erros por usuario, registros deletados). Trilha com buracos vale menos que trilha nenhuma, porque cria confianca falsa: o Anderson consulta, nao acha nada e conclui que ninguem mexeu.

**Prevencao.** Honestidade sobre as tres opcoes. So o BANCO garante 100%: trigger AFTER INSERT/UPDATE/DELETE por tabela gravando to_jsonb(OLD)/to_jsonb(NEW), com o autor lido de `current_setting('app.user_id', true)`, que a aplicacao seta com `SET LOCAL app.user_id = '...'` na abertura de cada transacao. Pega inclusive o psql manual e a migracao — os dois casos em que o dev 'nao lembrou'. FRICCAO CONCRETA: `auditoria.detalhes` e text NOT NULL e um trigger nao sabe redigir 'alterou preco de X para Y'; ou `detalhes` vira nullable, ou o unico mecanismo enforcavel nao cabe no schema atual — e uma decisao de schema, nao de codigo. A APLICACAO cobre o texto legivel: uma unica funcao `registrar()` chamada DENTRO da mesma transacao da escrita, nunca depois (senao a auditoria sobrevive a um rollback, ou some junto com ele). Independente das duas: `REVOKE UPDATE, DELETE ON auditoria FROM <role_da_app>`, para o append-only deixar de ser comentario.

*Camada: banco · depende de decisao humana*

---

## [alto] O job de SLA nao tem onde rodar, e sem coluna de 'alerta enviado' ele alerta a mesma pergunta para sempre

**Cenario.** 11h: entra uma pergunta do ML com prazo para as 15h. As 14h05 o job de SLA precisa disparar o alerta por WhatsApp. Ele roda de 5 em 5 minutos. As 14h10 roda de novo, a pergunta continua pendente, e ele alerta de novo. As 14h15, de novo. As 15h30 o Anderson ja silenciou a conversa e o alerta parou de existir na pratica. Em paralelo, o `pm2 reload` subiu a app em cluster com 2 instancias, e as duas tem o mesmo timer rodando.

**Quebra hoje.** Nao existe agendador em lugar nenhum do projeto: sem node-cron, sem BullMQ, sem systemd timer, sem schedule no .github/workflows. O caminho de LEITURA esta pronto — src/lib/db/schema/perguntas.ts tem `prazo_sla` e o indice parcial `idx_perguntas_sla_pendente` — mas nao existe nenhuma coluna que distinga 'vencendo' de 'vencendo e ja avisado'. E .github/workflows/deploy.yml:96 e :156 chamam `pm2 reload ecosystem.config.js`, arquivo que nao existe no repositorio: o numero de instancias, que e justamente o que decide se o timer duplica, esta indefinido (e o deploy PRD ainda vai falhar nessa linha, depois de ja ter rodado a migracao).

**Consequencia.** Alerta repetido e alerta ignorado, e o alerta de SLA e parte explicita do que foi contratado (RN-105) porque atraso de resposta derruba a reputacao no ML. Se a integracao acabar sendo WhatsApp Cloud API, cada disparo repetido ainda custa por conversa iniciada — o sistema paga para ser ignorado.

**Prevencao.** ONDE RODA (infra): fora do processo web. Um systemd timer/cron na VPS de backend chamando uma rota interna protegida por segredo, ou um worker BullMQ com job repetivel (padrao ja prescrito no CLAUDE.md) — nunca um setInterval dentro do Next, que morre a cada `pm2 reload` e duplica em cluster. O QUE IMPEDE O DISPARO DUPLO (banco, nao agendador): coluna `alerta_sla_enviado_em timestamp` em perguntas e a reivindicacao feita como escrita atomica — `UPDATE perguntas SET alerta_sla_enviado_em = now() WHERE id = ... AND alerta_sla_enviado_em IS NULL RETURNING id`; quem receber a linha manda o alerta, quem nao receber nao manda. Duas instancias podem rodar a mesma varredura sem consequencia. Um `pg_advisory_xact_lock` na varredura inteira serve de cinto extra. DECISAO DO ANDERSON: quantos escaloes de aviso (so uma vez? de novo a 25% da meta? quando vencer?) — cada escalao vira uma coluna ou uma linha de historico, e isso muda o schema.

*Camada: infra · depende de decisao humana*

---

## [critico] Backup so existe quando alguem da push na master — e o dump inteiro da producao vira artifact do GitHub

**Cenario.** PRD entra no ar em setembro. Anderson opera sozinho e nao ha release nova por tres semanas. No dia 22 o disco da VPS de backend corrompe. O ultimo backup e o do deploy de tres semanas atras: perdem-se tres semanas de pedidos, perguntas respondidas, custos de lote e a trilha de auditoria do periodo.

**Quebra hoje.** .github/workflows/deploy.yml faz pg_dump apenas dentro do job `deploy-prd`, disparado por push em master (linha 104). A politica 'Diario, retencao 30 dias' do CLAUDE.md nao tem NENHUMA implementacao: nao ha cron, nao ha script em scripts/, nao ha .github/workflows/backup.yml. Tres defeitos somados no mesmo job: (1) o dump e escrito em ~/Documents/DB_backups NO MESMO HOST do banco (linhas 126-131), o que a propria regra proibe; a unica copia off-server e um actions/upload-artifact (139-144) — dump completo de producao, sem criptografia, baixavel por qualquer pessoa com acesso de leitura ao repositorio, retido 90 dias; (2) `PRD_DATABASE_URL` vai inteira na linha de comando do pg_dump executado por SSH (linha 129), entao usuario e senha ficam visiveis em `ps` para qualquer processo do host durante o dump; (3) o restore nunca foi executado — 'backup testado = restore executado com sucesso em HML' esta no CLAUDE.md e nao aconteceu, e o dump e `--clean --if-exists`: apontado para o banco errado, ele DROPA o destino antes de recriar.

**Consequencia.** Perda real de dados numa operacao onde cada registro e uma peca unica de ticket alto: nao da para reconstruir o custo de arremate de um lote a partir do ML nem do OLX, porque esse numero so existe aqui. E o vetor inverso e igualmente concreto: quem tiver leitura no repositorio leva a base de custos, margens e contatos da MM para casa, sem precisar de acesso a nenhum servidor.

**Prevencao.** INFRA, integralmente — a aplicacao nao resolve nada disto. pg_dump agendado por systemd timer na VPS de backend, destino em object storage fora do provedor (S3/R2/B2 via rclone), retencao 30/90 alinhada a politica, criptografia em repouso, e um alerta se o backup mais recente tiver mais de 26h (backup silencioso que parou de rodar e o modo classico de descobrir na hora errada). A credencial sai da linha de comando e vai para PGPASSWORD/.pgpass ou arquivo de servico do libpq. O artifact do Actions so continua se for cifrado com chave que nao esta no repositorio. E um restore de verdade em HML, agendado (mensal), porque backup nao verificado nao e backup — e e ele que sustenta o procedimento de rollback do CLAUDE.md, que hoje tambem nunca foi executado.

*Camada: infra*

---

## [critico] O deploy apaga as fotos dos produtos, e o pg_dump nao as tem

**Cenario.** Anderson fotografa 40 itens do lote novo pelo CMS ao longo de uma semana. Depois entra uma correcao qualquer na master. O deploy roda `git fetch --all; git reset --hard origin/master` na VPS. Se as fotos foram gravadas dentro do diretorio da aplicacao — e o caminho natural num Next e public/uploads — o reset apaga tudo que nao esta versionado. O site publico fica com 40 cards sem imagem, e pela RN-109 esses itens nem deveriam mais aparecer.

**Quebra hoje.** .github/workflows/deploy.yml linhas 91-92 (HML) e 152-153 (PRD) fazem `git reset --hard origin/<branch>`. Nao existe definicao de storage (registrado em known-issues como lacuna, mas sem a consequencia de deploy), nao existe tabela itens_fotos nem coluna exibir_no_site, e o unico backup do pipeline e pg_dump — arquivo binario nao entra em dump de banco. Ou seja, a decisao default (salvar no disco da app) ja nasce com destruicao programada no deploy e sem nenhuma copia.

**Consequencia.** Foto e o que vende equipamento usado de alto valor: perder as fotos e perder a vitrine. Refotografar 40 itens no galpao sao dias de trabalho do operador, e nesse meio-tempo o site indexado serve paginas quebradas para leads que vieram do organico.

**Prevencao.** INFRA. As fotos moram FORA do diretorio de deploy e fora do ciclo de vida do build: S3/R2/MinIO com a URL guardada em `itens_fotos`, ou — se a prioridade for custo — um bind mount fixo tipo /var/mm/uploads que o git nunca toca, com rotina de backup propria (rsync/rclone), porque pg_dump nao cobre. APLICACAO complementa: a RN-109 le a EXISTENCIA da linha em itens_fotos para liberar o toggle 'Exibir no site', e um verificador periodico despublica o item se o arquivo sumir, em vez de servir card quebrado — falhar para 'oculto' e mais barato que falhar para 'vitrine sem foto'. A escolha do storage (custo x operacao) e decisao do Lucas e do Anderson.

*Camada: infra · depende de decisao humana*

---

## [alto] Item vendido: o link que o Google indexou e o QR da etiqueta impressa no galpao

**Cenario.** A 'Lampada de fenda MM-OFT-1401' fica 40 dias no site e o Google indexa a pagina. Ela vende no ML e sai do ar automaticamente (RN-104/RN-109). Dois dias depois um comprador clica no resultado do Google e cai numa pagina que nao existe mais; outro manda WhatsApp perguntando 'ainda tem a lampada de fenda?' e o operador nao consegue localizar o item, porque ele saiu da listagem. Em paralelo, o item e excluido logicamente e o SKU MM-OFT-1401 e reaproveitado num lote novo — a etiqueta impressa colada na caixa antiga, cujo QR aponta para a ficha desse SKU (RN-110), passa a abrir outro produto.

**Quebra hoje.** Nao existe rota publica nem regra de 'vendido' definida — a decisao esta em aberto e o comportamento default (404 ou remocao da rota) e o pior possivel. E src/lib/db/schema/itens.ts tem `idx_itens_sku_ativo` como indice PARCIAL (WHERE is_deleted = false), o que libera o SKU para reuso; o known-issues registra isso como pergunta de schema, mas nao liga o reuso a RN-110: a etiqueta e fisica, fica no galpao por meses e nao sabe que o SKU trocou de dono.

**Consequencia.** Lead qualificado vindo do organico — custo de midia zero, ticket alto — encontra beco sem saida em vez de virar conversa no WhatsApp. E QR de etiqueta apontando para o produto errado e erro de expedicao: item errado despachado, o que no ML vira devolucao e mais um golpe de reputacao, exatamente o que a RN-106 tenta proteger do outro lado.

**Prevencao.** APLICACAO. A pagina do item vendido nao some: vira estado 'Vendido' com HTTP 200 (ou 410 quando a intencao for tirar do indice de proposito), mantendo foto, especificacao, CTA de WhatsApp e sugestao de itens semelhantes — o link indexado continua convertendo em vez de morrer; nunca redirecionar para a home, que o Google trata como soft 404. O QR e a URL da ficha apontam para o `id` (uuid), nao para o SKU: isso torna a etiqueta imune ao reuso sem precisar mudar constraint. DECISAO DO ANDERSON, que muda o schema: SKU pode ser reaproveitado? Se nao puder, o unico de itens.sku volta a ser global e a exclusao de item passa a exigir outro tratamento.

*Camada: aplicacao · depende de decisao humana*

---

## [alto] O endpoint de webhook nasce publico, e e ele que da baixa no estoque

**Cenario.** A URL do webhook do ML precisa ser publica para o ML alcanca-la. Uma varredura automatica, ou alguem que viu a URL num print ou num log, manda um POST com {"topic":"orders_v2","resource":"/orders/123"}. Se o handler confiar no corpo da notificacao, ele cria pedido, marca item como vendido, pausa anuncios nos outros canais e tira o produto do site. Ninguem comprou nada.

**Quebra hoje.** A rota nao existe ainda — e por isso este e o momento de cravar a regra, porque o default do App Router e rota publica sem autenticacao nenhuma. .env.example ja preve ML_WEBHOOK_URL mas nao preve nenhum segredo de verificacao para ML ou OLX (so WHATSAPP_WEBHOOK_VERIFY_TOKEN, que e da Meta). docs/oauth.md e o known-issues tratam so do OAuth do painel; a superficie de entrada automatica nao esta coberta em lugar nenhum.

**Consequencia.** Estoque zerado por um POST anonimo, anuncios pausados nos tres canais e o Anderson descobrindo pelas mensagens dos compradores. Reconstruir o que aconteceu exige a trilha de auditoria, que hoje ninguem escreve — e a mesma rota, com dados validos porem repetidos, e o que a idempotencia da RN-104 precisa aguentar.

**Prevencao.** APLICACAO, em tres camadas. (1) O corpo da notificacao nunca e o dado: e so um ponteiro. O handler busca o recurso na API do ML com o token OAuth e confere que o seller_id e o da MM antes de qualquer escrita — quem falsifica o POST nao falsifica a resposta da API. Vale igual para a OLX. (2) Caminho com segredo na URL, allowlist de IP quando o canal publicar a faixa, e rate limit na rota. (3) O handler responde 200 rapido e apenas enfileira: o ML reentrega notificacoes e suspende o envio se o endpoint falhar de forma recorrente, entao processar em linha — com chamada externa dentro, ver o caso da transacao — e o caminho para perder notificacao de venda de verdade. A idempotencia do reprocessamento ja esta garantida pelo banco no unico (canal, numero) de pedidos; falta a de origem.

*Camada: aplicacao*

---

## [alto] Operador em treinamento: o que nao tem volta e tudo que sai do sistema

**Cenario.** Segunda semana de treinamento. O operador abre Perguntas, aplica o modelo 'Negociacao de precio' na pergunta errada e envia — a resposta aparece publica na pagina do anuncio do ML, visivel para todo comprador que abrir o item. Tentando corrigir, ele pausa o anuncio de um item que estava com tres negociacoes abertas. Nenhuma dessas duas acoes e exclusao de registro; o soft delete, o optimistic locking e o modal de 3 segundos nao protegem nada aqui.

**Quebra hoje.** O CLAUDE.md e toda a base tratam seguranca de dados como reversibilidade DENTRO do banco (soft delete, optimistic locking, modal block). Todos esses mecanismos param na borda do sistema. Nao existe conceito de acao que precisa de aprovacao, nem janela de arrependimento, nem distincao de papel na execucao: src/lib/actions/perguntas.ts, a unica action do projeto, nao recebe usuario nem verifica papel — e sem autenticacao (known-issues 🔴) nao teria como. A matriz de docs/rbac.md e rascunho nao validado.

**Consequencia.** Mensagem enviada ao comprador nao se apaga no ML e fica publica no anuncio; anuncio encerrado perde historico de visitas e posicao de busca; NF-e emitida tem janela curta de cancelamento e depois vira problema fiscal com custo de contador. Cada um custa dinheiro ou reputacao, e nenhum aparece na tela de 'registros deletados' do dashboard, porque nenhum e um delete.

**Prevencao.** E honesto dizer que a maior parte e processo, mas ha duas coisas concretas. APLICACAO: toda acao com efeito externo passa pelo mesmo outbox da transacao de venda, com `executar_apos = now() + 2 min` quando o autor tem papel `operador` — janela real de desfazer, que o modal de 3 segundos nao oferece (o modal protege contra o clique errado, nao contra a decisao errada). APLICACAO: a verificacao de papel mora na action, nunca na tela — botao escondido nao e controle de acesso — e as acoes irreversiveis (encerrar anuncio, emitir NF-e, publicar no site) ficam fora da lista do operador ate o Anderson liberar explicitamente. PROCESSO HUMANO: o julgamento nao se automatiza; a trilha de 5 semanas existe para isso, e o sistema so ajuda mostrando ao Anderson um feed do que o operador fez no dia — o que depende da auditoria existir de fato. DECISAO DO ANDERSON: quais acoes o operador pode executar sozinho e qual o limite de negociacao que ele pode aceitar sem ver o custo (ja registrado como pendencia, e sem essa resposta a lista de permissoes e chute).

*Camada: processo-humano · depende de decisao humana*

---

