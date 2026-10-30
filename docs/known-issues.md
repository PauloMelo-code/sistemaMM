# Problemas conhecidos e pendencias — Sistema MM Solucoes

Lista viva de lacunas, decisoes pendentes e divergencias intencionais.
Atualizada a cada sync. Itens resolvidos saem daqui.

> Ultima sincronizacao: 2026-08-10 (5a rodada — frete, congelamento de venda,
> type:module e bisect do build). Analise longa em
> [analise-corretude-2026-08-10.md](analise-corretude-2026-08-10.md).

---

## 🔴 Bloqueia o inicio

### ✅ CORRIGIDO em 2026-08-11: o optimistic locking recusava TODA edicao legitima
- **Arquivo(s):** `src/lib/actions/{lotes,estoque}-mutacoes.ts`, `actions/estoque.ts`
- **O sintoma:** o Anderson cadastrava um lote, clicava em editar e levava
  *"Outra pessoa alterou este lote enquanto voce editava"* — **sozinho no
  sistema**. Permanente, nao intermitente. Editar lote ou item era impossivel.
- **Achado por agente de teste**, um dia depois de o CRUD entrar. Nao havia
  teste que pegasse: o formulario nunca foi exercitado ponta a ponta, e foi
  entregue com essa lacuna declarada.
- **Duas causas somadas**, as duas provadas contra o banco local:
  ```
  banco  : 2026-08-11 23:15:04.963399
  Date() : 2026-08-12T02:15:04.963Z
           └ perdeu .399 µs          └ e ganhou 3 horas
  ```
  1. A coluna e `timestamp(6)` e `now()` grava MICROSSEGUNDOS; o `Date` do JS so
     tem milissegundos. O `WHERE` procurava um instante que nao existe.
  2. `updated_at::text` sai sem fuso, `new Date()` le como hora LOCAL e o driver
     assume UTC — 3h com `TZ=America/Sao_Paulo`.
- **Como ficou:** o carimbo virou **token opaco**. A string exata do banco vai e
  volta sem nunca ser convertida (`updated_at::text = $n`). O cliente nao precisa
  saber que aquilo e uma data.
- **⚠️ NAO troque de volta para `eq(updated_at, new Date(x))`.** Guardado por
  regressao em dois lugares: `prova-mutacoes-crud.sql` casos 4c/4e e
  `travamento-otimista.test.ts`.

### 🟡 A MESMA coluna tem DOIS relogios — e agora da para ver
- **Descoberto ao corrigir o item acima.** Nao e teoria: reproduzido.
  ```
  created_at  (DEFAULT now(), relogio do Postgres)  23:18:51
  updated_at  (new Date(),    relogio do Node)      20:18:51
  -> o registro foi ATUALIZADO ANTES de ser criado
  ```
- **Por que acontece:** o container do Postgres roda em `Etc/UTC` e o processo
  Node em `America/Sao_Paulo`. `now()` grava num relogio, `new Date()` no outro,
  e a coluna e `timestamp` SEM fuso — ninguem reconcilia.
- **O que ja contamina:** o KPI "vendidos no mes" de `lerEstoque` compara
  `updated_at` (escrito pelo Node) com `date_trunc('month', now())` (relogio do
  Postgres). Na virada do mes, conta errado.
- **⚠️ O passo do runbook NAO E OPCIONAL:**
  `ALTER DATABASE ... SET TimeZone = 'America/Sao_Paulo'`. Sem ele, producao tem
  exatamente esta divisao. E continua sendo paliativo — a decisao de fundo
  (`timestamptz` nas colunas de instante) segue com o Lucas, e vence antes de
  haver venda gravada.

### ✅ CORRIGIDO em 2026-08-11: `criar-usuario.mjs` estourava no unico caminho nao testado
- **O caso:** usuario existe em `user` mas **sem** linha em `account` — o
  bootstrap de quem foi criado por SQL. O `INSERT` usava `$2` para `user_id`
  (uuid) e `account_id` (text), e o Postgres recusava com `42P08`.
- **Por que sobreviveu:** a mesma correcao ja tinha sido aplicada no ramo de
  CRIACAO, com um `replace_all` que reportou "todas as ocorrencias substituidas"
  — e substituiu uma so, porque a segunda tinha indentacao diferente. Criar do
  zero e trocar senha de quem ja tem credencial passavam; este ramo nunca era
  exercitado.
- **Licao:** substituicao em massa que diz "todas" merece conferencia. E ramo
  que nenhum caminho de uso alcanca e exatamente onde o erro fica.

### ⚠️ O operador pode criar item pela matriz, e nao consegue preencher o formulario
- **Arquivo(s):** `src/lib/auth/rbac.ts`, `src/lib/actions/estoque-mutacoes.ts`
- **A contradicao, achada ao construir o CRUD (2026-08-11):** a matriz da ao
  operador `itens: ["criar","ler","atualizar"]`. Mas criar um item exige
  **custo** (`itens.custo` e NOT NULL) e exige **escolher um lote** — e a mesma
  matriz nega `itens_custo` ao operador (RN-107, de proposito) e nega `lotes`
  por inteiro.
- **Ou seja:** ele tem a permissao e nenhum caminho para exerce-la.
- **Como esta hoje:** o cadastro exige as DUAS permissoes (`itens` **e**
  `itens_custo`), o que na pratica significa administrador. Nao e a matriz que
  manda aqui — e a impossibilidade de preencher o formulario.
- **As saidas possiveis, todas decisao do Anderson:**
  1. **Cadastro e do Anderson.** Bate com o fluxo real (ele arremata e cadastra)
     e nao muda nada no codigo. A matriz e que sai errada e deve perder
     `itens: criar` do operador.
  2. **O operador cadastra sem custo** — exige `itens.custo` NULLABLE e o
     administrador completando depois. Abre uma janela em que o item existe sem
     custo, e toda margem que o toque nesse periodo e mentira.
  3. **O operador cadastra com custo** — mata a RN-107, que e a unica regra
     cravada do projeto. Descartada, salvo ordem explicita dele.
- **Por que nao decidi sozinho:** a opcao 2 mexe em coluna de dinheiro e a 3
  desfaz o sigilo de custo. Nenhuma das duas e escolha de quem escreve o codigo.

### Auditoria de producao 2026-08-11 — o que impede subir, em ordem
Seis frentes varreram o repositorio e cada bloqueio passou por um cetico que
tentou refuta-lo lendo o codigo. O que sobreviveu:

- **✅ CORRIGIDO — 52 arquivos estavam fora do git.** O deploy e
  `git reset --hard origin/develop`: o que subiria era o painel **sem
  autenticacao, sem `proxy.ts`, sem tela de login**, com o banco parando na
  migracao 0008. Commitado em 7 commits por area.
- **✅ CORRIGIDO — o CI nunca ficou verde, nem uma vez.**
  `src/lib/db/index.ts:13-20` valida `DATABASE_URL` na avaliacao do modulo e o
  `next build` avalia toda rota para coletar page data. O passo Build nao tinha
  bloco `env:`. Como `deploy-hml` e `deploy-prd` tem `needs: ci`, **nenhum
  deploy jamais executou**. Reproduzido nos dois sentidos.
- **✅ RESOLVIDO DE OUTRO JEITO — o modelo de deploy passou a ser EasyPanel.**
  O `ecosystem.config.js` nao existia e o deploy terminava em
  `pm2 ... ecosystem.config.js`; cheguei a escreve-lo, e ele durou uma hora.
  **Decisao do Paulo em 2026-08-11:** publicar pelo EasyPanel, que constroi
  container. Os dois jobs de deploy por SSH e o `ecosystem.config.js` foram
  removidos — a auditoria ja apontava "dois modelos incompativeis convivendo", e
  manter um caminho comprovadamente morto seria pior agora. Ficou: `Dockerfile`
  multi-stage com `output: "standalone"`, `.dockerignore`, `scripts/migrar.mjs`
  e o job `ci` como unico portao automatico.
  - **As tres decisoes do `ecosystem.config.js` NAO se perderam, mudaram de
    lugar** — e se nao forem repetidas na UI do EasyPanel somem em silencio:
    `instances: 1` vira **Replicas = 1** (o portao de 429 do ML e memoria de
    processo, e o limite de tentativas de login tambem), `NODE_ENV=production` e
    `TZ=America/Sao_Paulo` viram `ENV` do Dockerfile.
  - **⚠️ `MINIO_PUBLIC_URL` e variavel de BUILD, nao de runtime.** O
    `next.config.ts` monta `images.remotePatterns` na carga da config; ausente,
    devolve `[]` em silencio e a imagem sai recusando toda foto. Passar depois
    nao adianta: o valor foi cozido no build. Entra como `--build-arg`.
  - **⚠️ A migracao NAO roda no boot do container**, de proposito: erro de
    schema viraria laco de reinicio. E comando pontual (`node scripts/migrar.mjs`),
    e usa o migrador do `drizzle-orm` porque o `drizzle-kit` e dependencia de
    desenvolvimento e nao entra na imagem.

- **✅ CORRIGIDO — nao havia healthcheck.** `GET /api/saude` faz `SELECT 1` e
  responde 200/503, e o Dockerfile a usa. Publica e sem segredo (quem consulta e
  o orquestrador, sem cookie), e por isso nao revela nada.
  - **O `SELECT 1` nao e decoracao:** sem tocar o banco, a rota responderia 200
    com o Postgres fora do ar. Verificado parando o container: 200 → **503** →
    200 quando voltou.
  - **⚠️ ARMADILHA QUE JA MORDEU, em 20 minutos de vida:** a rota nasceu DENTRO
    do matcher do porteiro e respondia **307 para /login**. O Docker leria isso
    como container doente e reiniciaria a aplicacao **em laco, para sempre** —
    uma app perfeitamente saudavel derrubada pelo proprio porteiro. Achado ao
    subir o bundle standalone de verdade, nao revisando codigo. `api/saude` esta
    na lista de excecoes do `proxy.ts`; nao tire.
- **✅ CORRIGIDO — ninguem conseguia criar o primeiro usuario.** Ver a entrada
  do Better Auth.
- **🔴 ABERTO — nada agenda o worker.** Varredura de cron, `setInterval` e
  GitHub Actions: zero. A venda chega do ML, entra em `integracoes_eventos` e
  fica la para sempre — o pedido nao e registrado, o item nao baixa do estoque e
  **o anuncio da OLX continua no ar**. Toda a RN-104 deixa de acontecer, com o
  codigo dela pronto e testado. Cron provisorio no runbook.
- **🔴 ABERTO — o painel nao escreve nada.** A unica action de escrita e
  login/logout. Nenhum codigo cria lote, item, anuncio ou pergunta: em PRD as 7
  telas sobem vazias e **permanecem vazias**. E um relatorio, nao um sistema de
  gestao.
- **🔴 ABERTO — `/api/fotos` grava sem conferir sessao.** Os 4 handlers
  (`route.ts` POST/PATCH e `[id]` PATCH/DELETE) nao chamam `lerSessao()`, e a
  action tambem nao filtra. Hoje a janela e estreita (exige UUID valido e o site
  publico nao existe), mas **no dia em que a vitrine renderizar uma foto o item
  id vaza no `src` da imagem** e o DELETE vira remotamente explorave. Nenhuma UI
  consome essas rotas — a correcao mais preguicosa e apaga-las ate a tela Site
  existir.
- **✅ RESOLVIDO em 2026-10-29 — `/api/integracoes/oauth/.../iniciar` so tinha
  `?t=SEGREDO`.** Quem lesse o segredo num log de acesso autorizaria a PROPRIA
  conta do ML e substituiria a credencial da MM. Agora a rota exige
  `lerSessao()` + `temPermissao(papel, "integracoes", "atualizar")`, ou seja, so
  administrador. Ela e chamada pelo botao "Conectar Mercado Livre" da tela
  Integracoes.
- **✅ RESOLVIDO em 2026-10-29 — `/integracoes` nao conferia papel.** A pagina
  agora chama `temPermissao(papel, "integracoes", "ler")`. O operador ve "esta
  tela nao faz parte do seu acesso", como em Lotes.
- **🔴 ABERTO — sem healthcheck e sem rollback.** O pipeline termina no `pm2` e
  nada confere se a app responde: app que sobe e morre em 2s da deploy verde. As
  migracoes sao so de ida, e o `pg_dump` **nunca foi restaurado nem uma vez** —
  backup nao testado nao e backup.
- **🔴 ABERTO — a sidebar mente em toda tela.** "Mercado Livre · ativo" e
  "OLX · ativo" sao strings cravadas no JSX, em verde, enquanto `/integracoes`
  diz corretamente que o app nao foi autorizado. Em PRD, com zero credencial, o
  painel afirma o contrario da verdade na tela que o Anderson ve o dia inteiro.
- **🟡 Fuso ainda em aberto:** nenhuma coluna e `timestamptz` e nada fixa TZ. O
  `ecosystem.config.js` agora crava `TZ=America/Sao_Paulo` no processo — mas
  **isso e metade**: a sessao do Postgres precisa do mesmo fuso, senao o filtro
  montado em Node discorda do `date_trunc(now())` das consultas. Decisao do
  Lucas, e ela vence antes do primeiro migrate em PRD.

### ⚠️ DECISAO DO ANDERSON: na OLX, "pausar" so existe como APAGAR
- **Arquivo(s):** `src/lib/integracoes/olx/politica.ts`,
  `olx/executor-anuncio.ts`, `olx/client.ts`, `src/lib/integracoes/executores.ts`
- **O fato, conferido na doc oficial** (developers.olx.com.br, 2026-08-10): a API
  de autoupload tem **`insert` e `delete`, e nada entre os dois**. Nao existe
  estado pausado. A doc diz literalmente que o anuncio permanece publicado a
  menos que uma delecao seja enviada.
- **Por que isso e decisao de negocio, nao de codigo:** a RN-104 manda **pausar**
  o anuncio nos outros canais quando o item vende. Na OLX, cumprir isso significa
  **apagar** — e reanunciar depois e um `insert` novo, que perde o id, a posicao
  e a visibilidade acumulada. E o mesmo perigo do `closed` do ML (que tornei
  inalcancavel de proposito), com a diferenca de que aqui **nao ha alternativa**:
  ou apaga, ou deixa no ar a peca ja vendida.
- **⚠️ A confirmar com o Anderson:** (a) o sistema pode apagar anuncio na OLX
  automaticamente ao vender? (b) se a venda for cancelada, quem recria o anuncio
  — e com qual preco? Casa com a RN-120, ja aberta.
- **Como esta hoje:** implementado e **DESLIGADO por padrao**. So age com
  `OLX_DELETAR_AO_VENDER=true` (o literal exato; "TRUE", "1" e "sim" nao valem —
  falha fechada). Sem a variavel, a tarefa fica pendente com `tentativas = 0` e
  aparece em `aguardandoExecutor`.
- **O registro do executor e CONDICIONAL, e nao por estilo.** Se ele estivesse
  sempre registrado e apenas recusasse enquanto a decisao nao vem, a tarefa seria
  reivindicada, queimaria as cinco tentativas e viraria **esgotada** — e no dia
  em que a decisao chegasse, o pedido de pausa daquela peca ja estaria morto na
  fila. Atraso e recuperavel; tarefa esgotada por decisao pendente, nao.
  A checagem existe **tambem** dentro do executor, como rede de seguranca: acao
  irreversivel sobre anuncio real do cliente nao depende de um ponto so.
- **`reativar_anuncio` nao existe na OLX** de proposito: seria um `insert`
  completo (titulo, corpo, preco, CEP, telefone, ate 20 imagens) — republicar,
  nao desfazer uma pausa. Depende da RN-120.
- **A importacao e ASSINCRONA.** `statusCode: 0` significa "a OLX aceitou o
  pedido", nao "o anuncio saiu do ar" — moderacao acontece depois. Tratamos
  `statusCode != 0` como falha mesmo com HTTP 200, mas **a confirmacao final
  exigiria consultar o status da importacao pelo `token`**, o que ainda nao
  fazemos. Ate la, `anuncios.status = 'pausado'` significa "pedimos", nao
  "confirmado".
- **Verificado com OLX falsa** (removida depois): trava desligada -> zero
  chamadas, tarefa intacta; trava ligada -> um `PUT /autoupload/import` com
  `{"id":"OLX-777","operation":"delete"}` e o `access_token` decifrado **no
  corpo** (nao no cabecalho, que e a forma da API deles).
- **Falta credencial da OLX.** Nao ha fluxo OAuth deles implementado, e nem esta
  confirmado que a conta da MM tem acesso a API (🔴 acima). O executor le de
  `integracoes_credenciais` (canal `olx`) e falha com erro claro se nao houver.

### A pausa nos outros canais so funciona no ML — a OLX depende de decisao
- **Arquivo(s):** `src/lib/integracoes/executores.ts`,
  `src/lib/integracoes/mercado-livre/executor-anuncio.ts`
- **Situacao (2026-08-10):** o executor do **Mercado Livre** existe e esta
  verificado: `PUT /items/{id}` com `{"status":"paused"}` (endpoint confirmado
  na doc oficial), e `anuncios.status` so muda **depois** da confirmacao do
  canal. O da **OLX existe mas nasce desligado** — porque la "pausar" so existe
  como apagar, e isso e decisao do Anderson (entrada acima).
- **A ironia que importa:** a venda que chega pelo ML gera tarefa para pausar na
  **OLX** — ou seja, o caso mais comum e justamente o que depende da decisao
  pendente. O executor do ML cobre o caminho inverso (vendeu na OLX ou no
  WhatsApp).
- **Nao fica escondido:** o resumo do worker traz `aguardandoExecutor` contando
  as tarefas sem dono **em toda passada**, mesmo quando o lote executou tudo o
  que sabia. E elas nao gastam tentativa: a consulta so reivindica par
  `(canal, tipo)` com executor, entao nao chegam esgotadas no dia em que o
  executor existir.
- **Verificado com ML falso** (removido depois): caminho feliz pausa e atualiza
  o banco; anuncio **ja pausado** no canal responde 400 e o executor confirma
  por `GET` que o estado desejado ja vale — conta como sucesso, sem interpretar
  texto de erro; tarefa sem `id_externo` sai da fila como permanente; tarefa da
  OLX fica pendente com `tentativas = 0`.
- **`closed` e inalcancavel por construcao.** O ML aceita `active`, `paused` e
  `closed`, e `closed` **finaliza o anuncio para sempre** (republicar perde id,
  historico e posicao). Nenhum caminho de codigo produz essa string, e ha teste
  travando isso.

### A venda ja da baixa no estoque, mas NINGUEM pausa os outros canais ainda
- **Arquivo(s):** `src/lib/integracoes/mercado-livre/handler-venda.ts`,
  `src/lib/integracoes/tarefas.ts`, `src/lib/db/schema/integracoes-tarefas.ts`
- **Situacao:** o handler de venda registra o pedido, congela o custo, marca o
  item como vendido, **tira do site na mesma transacao** e **enfileira** a pausa
  dos outros canais no mesmo commit — isso funciona e esta verificado de ponta a
  ponta. O que **nao** existe e o executor: nada consome `integracoes_tarefas`.
  As tarefas acumulam.
- **O que JA esta protegido, mesmo sem executor:** o item sai do estoque e da
  vitrine publica atomicamente com a venda. O buraco e so o canal EXTERNO.
- **Por que importa:** e a metade da RN-104 que protege contra vender a mesma
  peca duas vezes em canais diferentes. Enquanto ninguem drenar, o item vendido
  no ML **continua anunciado na OLX** — com o agravante de que o painel ja diz
  "vendido" e passa a impressao de que o efeito colateral aconteceu.
- **Enquanto isso, nada se perde:** `SELECT * FROM integracoes_tarefas WHERE
  processado_em IS NULL` lista exatamente o que ficou por fazer, e
  `contarTarefas()` ja devolve pendentes e esgotadas para a tela Integracoes.

#### O que falta, item por item

**1. Conferir os endpoints — e o unico bloqueio real.** Pausar anuncio no ML e
provavelmente `PUT /items/{id}` com `{"status":"paused"}`, mas **isso nao foi
verificado**: a doc do ML bloqueia leitura automatizada (403) e nao ha credencial
para testar. Na OLX e pior — nem se sabe se a conta da MM tem acesso a API
(🔴 proprio). Escrever de cabeca um `PUT` errado em cima da RN-104 seria pior
que a lacuna visivel. **Com o app registrado, confira e so entao escreva.**

**2. `drenarTarefas()`** — espelho do `drenarEventos` que ja existe: reivindicar
com `FOR UPDATE SKIP LOCKED` (incrementando `tentativas` no mesmo comando),
executar **fora** de transacao, gravar o resultado. O registro de executores
segue o padrao do `HANDLERS`, chaveado por `(canal, tipo)`. Reaproveitar
`retentativa.ts`: teto de tentativas, `ErroPermanente` e `codigoPostgres` ja
estao la e valem igual.

**3. O executor precisa ser IDEMPOTENTE.** Pausar um anuncio que ja esta pausado
tem que contar como sucesso, nao como erro — reentrega e rotina, e a RN-104
proibe que reprocessar cause efeito colateral. Se o canal devolver erro do tipo
"ja pausado", trate como concluido.

**4. Atualizar `anuncios.status` so DEPOIS da confirmacao do canal.** Marcar como
pausado antes de o canal confirmar faria o painel mentir na direcao perigosa:
"esta pausado" quando ainda esta no ar.

**5. ⚠️ Falta o estado "pausa pendente".** Confirmado no banco: `anuncios` **nao**
tem `status_desejado` nem `sincronizado_em`. Entao, entre a venda e a execucao da
tarefa, o anuncio da OLX aparece como "no ar" — o que e verdade, mas a tela nao
tem como dizer "e uma pausa que ainda nao aconteceu". A analise de corretude
pede essas duas colunas; sem elas, a tela Integracoes so consegue mostrar a fila,
nao o anuncio divergente.

**6. Reversao nao existe.** O enum ja tem `reativar_anuncio`, mas ninguem
enfileira: cancelar uma venda depois de pausar os outros canais nao reativa nada.
Depende da RN-120 (⚠️ Anderson) — devolucao **nao** e o inverso automatico da
venda.

**7. Onde o worker roda** continua sendo o mesmo ADR aberto do Lucas.

#### ✅ CORRIGIDO em 2026-08-10: `tirar_do_site` nao era para ser tarefa
- **O que era:** `itens.exibir_no_site` existe no banco (migracao `0007`), entao
  tirar do site e **operacao interna** — um `UPDATE`, nenhuma API de terceiro.
  Estava enfileirado como tarefa junto com as pausas externas, por simetria de
  desenho. Criava uma janela em que o item ficava vendido e **ainda no ar na
  vitrine**, esperando um worker que nem existe.
- **Como ficou:** `situacao = 'vendido'` e `exibir_no_site = false` no MESMO
  `UPDATE`, dentro da transacao de `registrarVendaML`. **Verificado:** antes da
  venda `exibir_no_site=true`; depois, `vendido`/`false`, e a fila fica com UMA
  tarefa (a pausa na OLX) em vez de duas.
- **Regra que fica:** o outbox e para o que sai para OUTRO SISTEMA. O que e
  nosso resolve na transacao — sem janela, sem worker no meio.
- **`tirar_do_site` continua no enum, marcado como RESERVADO e sem uso.**
  Remover valor de enum no Postgres exige recriar o tipo e alterar a coluna, o
  que nao se justifica por um rotulo que ninguem emite. Ganha uso legitimo se um
  dia existir vitrine externa, fora do nosso banco.
- **Como isto foi achado:** revisando o proprio desenho para documenta-lo, nao
  por teste falhando. Os 108 testes passavam com a versao errada — nenhum deles
  perguntava "por que isto e uma tarefa?". Vale como lembrete de onde os testes
  desta base nao alcancam.

### ✅ 2026-08-11: a autenticacao migrou para o Better Auth — o que se ganhou e o que se perdeu
- **Arquivo(s):** `src/lib/auth/{config,sessao,cliente,rbac}.ts`,
  `src/lib/db/schema/auth.ts`, `src/app/api/auth/[...all]/route.ts`,
  `scripts/criar-usuario.mjs`, migracao `0011`
- **Decisao do Paulo**, com as tabelas padrao da biblioteca (`user`, `session`,
  `account`, `verification`) em vez de mapear sobre as existentes. As 11 FKs de
  `modified_by` passaram a apontar para `user.id`; `usuarios` e
  `usuarios_sessoes` ficaram **aposentadas, nao apagadas** (a regra da casa
  proibe DROP).
- **O QUE ISSO RESOLVEU, e era um bloqueio de producao real:** antes **nao
  existia caminho para criar o primeiro usuario**. A unica linha semeada era o
  robo das integracoes (`ativo = false`), e `definir-senha.mjs` so fazia UPDATE
  — banco novo em PRD significava painel trancado para todo mundo, inclusive o
  Anderson. Agora `scripts/criar-usuario.mjs` cria e troca senha.
- **⚠️ PERDA 1 — `session.token` fica EM CLARO.** O `usuarios_sessoes.token_hash`
  guardava SHA-256, entao dump vazado nao virava sessao ativa. O Better Auth
  precisa do valor original para casar o cookie e o esquema dele nao preve hash.
  Quem obtiver um dump entra como qualquer usuario logado ate a sessao expirar
  (12h). Mitigacao possivel e **operacional** (quem le o banco, onde o dump
  fica), nao de codigo.
- **⚠️ PERDA 2 — o bloqueio por tentativas virou memoria de processo.** Era
  contado no banco (`usuarios.tentativas_falhas`), justamente porque contador em
  memoria zera a cada deploy e nao existe entre instancias. Hoje e aceitavel
  porque o `ecosystem.config.js` fixa `instances: 1`; deixa de ser no dia do
  cluster, e ai a saida e o storage secundario do Better Auth.
- **⚠️ `user` e PALAVRA RESERVADA do Postgres.** O Drizzle sempre cita
  identificador, entao a aplicacao esta segura — mas **SQL cru precisa de
  `"user"` com aspas**. Ja mordeu: as quatro `scripts/db/prova-*.sql` tiveram de
  ser portadas.
- **⚠️ Cadastro publico DESLIGADO** (`disableSignUp: true`). Com
  `emailAndPassword.enabled` sozinho, `POST /api/auth/sign-up/email` fica aberto
  e, como `papel` tem default `operador` e `ativo` nasce `true`, qualquer um
  criaria conta valida e entraria no painel. Verificado: a rota responde 400.
- **O login por SERVER ACTION nao serve, e o motivo e concreto:** o limite de
  tentativas roda no `onRequest` do router do Better Auth
  (`better-auth/dist/api/index.mjs:168`). `auth.api.signInEmail()` chamado de
  uma action passa por fora e **o rate limit nao se aplica**. Por isso o
  formulario usa `authClient`. Nao "simplifique" de volta para action.
- **VERIFICADO PONTA A PONTA — pela primeira vez no projeto.** O login antigo
  nunca foi testado de verdade porque server action exige o protocolo interno do
  Next; o do Better Auth e HTTP com JSON e curl alcanca. Provado: senha certa
  200 + cookie; senha errada 401; cadastro publico 400; 6a tentativa 429; sessao
  valida abre `/lotes`; sem cookie e cookie forjado sao barrados; **desligar
  (`ativo=false`), excluir logicamente e vencer a sessao derrubam o acesso com a
  MESMA sessao ja aberta**, e reativar volta a entrar. RN-107 conferida com os
  dois papeis lado a lado: o operador recebe a pagina de acesso negado em
  `/lotes`, sem link no menu e sem valor de dinheiro no HTML.
- **As 27 provas de banco foram portadas e passam** (12 + 5 + 5 + 5), incluindo
  os casos do unico parcial de e-mail e do FK RESTRICT, que agora vivem em
  `user`.
- **Nao construido:** recuperacao de senha por e-mail (a tabela `verification`
  existe e nasce vazia; depende de servico de e-mail, nao decidido) e tela de
  Equipe. Enquanto nao houver tela, cadastro e pelo script.

### Historico: o que a entrada acima substituiu
- **O QUE FALTAVA PARA USAR:** ninguem tem senha. Rode, no seu terminal:
  `node scripts/definir-senha.mjs anderson@mmsolucoes.com.br` — a senha e pedida
  oculta e nunca vira argumento de linha de comando (`history`, `ps`, log).
  **Nao passe senha real em chat, ticket ou para uma IA.**
- **⚠️ DIVERGE de `docs/oauth.md`, que manda bcrypt.** Usamos `scrypt` da stdlib
  do Node: bcrypt seria dependencia nova (o CLAUDE.md proibe instalar sem
  autorizacao) e o scrypt e memory-hard, o que encarece ataque com GPU. Decidido
  com o Paulo em 2026-08-11. **O `oauth.md` continua desatualizado neste ponto.**
- **⚠️ `maxmem` do scrypt e obrigatorio.** `N=32768, r=8` usa ~33,5 MB, acima do
  teto padrao de 32 MB do Node. Sem declarar, o scrypt LANCA em toda chamada — e
  como `conferirSenha` engole excecao para nao vazar informacao, **todo login
  falharia dizendo so "credenciais invalidas"**. Nao mexa nos parametros sem
  revisar essa linha.
- **A checagem que vale mora no LAYOUT de `(painel)`, nao no middleware.** O
  middleware roda no edge, nao alcanca o banco e so confere se EXISTE cookie —
  cookie forjado passa por ele. Isso foi comprovado: antes de `lerSessao()` no
  layout, `/perguntas` respondia 200 com cookie inventado. **Nunca troque a
  checagem do layout por "o middleware ja garantiu".**
- **Verificado nos seis estados:** sessao valida entra; cookie forjado, sessao
  vencida, usuario desligado e sessao encerrada sao barrados; reativar volta a
  entrar. Desligar alguem tem efeito na requisicao seguinte — e por isso a
  sessao e tabela e nao JWT.
- **NAO verificado:** o formulario de login ponta a ponta. Postar em server
  action por `curl` exige o protocolo interno do Next; precisa de um clique real
  no navegador. O que esta coberto por teste e o hash, a matriz e a politica de
  bloqueio.
- **Nao construido:** recuperacao de senha por e-mail (exige servico de e-mail,
  nao decidido) e a aplicacao da RN-107 tela a tela — o mecanismo existe
  (`podeVerCusto`, `semCusto`), mas hoje so ha Perguntas e Integracoes, e
  nenhuma mostra custo. **Toda tela nova com dinheiro precisa usa-lo.**
- **A matriz do `docs/rbac.md` continua sendo PROPOSTA**, nao validada com o
  Anderson. So a RN-107 esta cravada. Ela vive num lugar so (`auth/rbac.ts`)
  justamente para a validacao mudar uma tabela, e nao vinte `if`.

### Credenciais do Mercado Livre — nao temos
- **Modulo:** Anuncios, Perguntas, Pedidos, Integracoes, Relatorios
- **Situacao:** o prototipo mostra "Conectado", mas nao existe aplicacao
  registrada. Precisa de: app criado no portal de developers do ML,
  `client_id` + `client_secret`, **redirect URI**, e uma **URL publica** para
  receber as notificacoes (webhooks).
- **Por que importa:** e a integracao que sustenta 4 das 12 telas. Sem ela, o
  painel so tem mock.
- **Acao sugerida:** Anderson cria/autoriza o app na conta de vendedor da MM.
  Em desenvolvimento, webhook exige tunel (cloudflared/ngrok) — decidir qual.
  Ao criar o app: **PKCE ativo**, e ativar as permissoes funcionais "Vendas e
  envios", "Comunicacao pre e pos-venda" e "Publicacao e sincronizacao". Sem
  elas, a API responde 403 (ver `docs/ml-api-notas.md` §5).

### 🟡 Status de envio dos pedidos do ML — pronto; devolucao ainda nao (2026-10-29)
- **Arquivo(s):**
  - `src/lib/integracoes/mercado-livre/{envio-ml,atualizacao-envios}.ts`
  - o handler de venda e o topico `shipments` em `handlers.ts`
  - a rota `reconciliar`
  - a migracao `0016` (`pedidos.id_envio_externo`)
- **Como atualiza:**
  - **Conferencia a cada 15 min:** atualiza ate 100 pedidos em aberto por
    passada. O historico se corrige assim.
  - **Notificacao `shipments`:** precisa do topico marcado no DevCenter.
  - **Notificacao `orders_v2` de pedido que ja existe:** antes era ignorada.
- **Traducao conservadora** (`envio-ml.ts`): a doc nao tem tabela oficial de
  status.
  - `not_delivered` e envio `cancelled` **nao mudam** o pedido, porque o
    segundo pode ser venda enviada por fora do ML.
  - So pedido `cancelled` no ML vira cancelado.
- **⚠️ Cancelado nao devolve a unidade ao estoque.** Pedido cancelado antes do
  envio (o comprador desistiu) sai do faturamento, mas a quantidade do item
  continua baixada. Entra junto com o fluxo de devolucao (proxima entrega).
- **NAO verificado:** a resposta real de `/shipments` com `x-format-new`. Ela
  foi lida a partir da documentacao.

### 🟡 Vinculo anuncio do ML -> Estoque (RN-124) — pronto, com ressalvas (2026-10-29)
- **Arquivo(s):** `src/lib/integracoes/mercado-livre/vinculo.ts` (plano, puro),
  `src/lib/pricing.ts` (`ratearCustoDoLote`), `src/lib/actions/vinculo-ml.ts`,
  `/integracoes/mercado-livre/vincular`, migracao `0015` (`anuncios.contado_ate`).
- **Provado de ponta a ponta** com servidor de producao local e banco
  descartavel, 4 anuncios de exemplo:
  - 3 lotes e o custo rateado certo;
  - o SKU repetido virou `-B`; o anuncio sem SKU virou `ML-<id>`;
  - quantidade e situacao como na RN-124;
  - o marco `contado_ate` gravado, a pergunta vinculada ao item e a trilha;
  - o Estoque mostra tudo.
- **NAO verificado:**
  - **A copia das fotos.** Nao havia MinIO local, e as fotos reais do ML podem
    ser recusadas pela validacao de tamanho (`LADO_MINIMO`). A tela mostra
    quantas foram recusadas.
  - **O desvio da venda anterior a importacao** (`contado_ate`) no
    `handler-venda.ts`. Foi verificado lendo o codigo, sem teste automatizado:
    o handler depende de banco e da API do ML.
- **Depois do vinculo a RN-104 escreve no ML:** venda em outro canal pausa o
  anuncio la. A tela avisa no modal de confirmacao.
- **Reimportar depois do vinculo nao muda a quantidade do item.** O Estoque
  passa a ser a fonte; reimportar so atualiza a "foto" do anuncio.
- **O rateio por preco de anuncio e regra nova** e precisa da confirmacao do
  Anderson. Se ele quiser outro criterio, muda so `ratearCustoDoLote`.

### 🟡 Item com quantidade (ADR-0002) — o que ficou de fora (2026-10-29)
- **Arquivo(s):** migracao `0014`, `handler-venda.ts`, `pricing.ts`
  (`custoNaVenda`), telas Estoque e Lotes.
- **Cancelamento nao devolve a unidade.** Antes, cancelar o pedido liberava o
  item pelo indice `idx_pedidos_item_ativo`. Agora seria preciso somar a
  quantidade de volta, e nao existe fluxo de cancelamento. Quando existir, ele
  precisa devolver as unidades e, se o item tinha zerado, voltar a situacao.
- **A trava do banco depende de quem grava o pedido baixar a quantidade.** Hoje
  so o handler de venda grava pedido, e ele baixa. Ver RN-112 e ADR-0002.
- **Editar a quantidade pelo formulario nao mexe na situacao.** Pôr 0 a mao
  nao marca `vendido`; so a venda faz isso.
- **Provado** em Postgres descartavel, com as migracoes do zero:
  - `prova-compra-simultanea.sql` reescrita, 6/6;
  - as outras 4 provas continuam verdes;
  - a `0014` zera a quantidade de item ja `vendido` e mantem 1 nos demais.

### 🟡 Perguntas do ML entram na caixa — responder ainda nao (2026-10-29)
- **Arquivo(s):** `src/lib/integracoes/mercado-livre/{pergunta-ml,importacao-perguntas}.ts`,
  `src/lib/integracoes/handlers.ts` (topico `questions`), migracao `0013`
  (`perguntas.id_anuncio_externo`)
- **Como chega:** de dois jeitos.
  - Pelo botao "Buscar perguntas do ML" na tela Perguntas, que traz as 500 mais
    recentes.
  - Pela notificacao `questions`, que o worker agora processa.
  - Em PRD havia notificacoes `questions` paradas na fila desde a conexao: o
    worker as processa sozinho depois do deploy.
- **O prazo do SLA sai da hora em que o comprador perguntou** (`date_created` do
  ML), e `created_at` recebe essa mesma hora. Importar hoje uma pergunta de
  ontem nao pode parecer resposta instantanea.
- **Sem item vinculado**, a tela mostra o titulo do anuncio importado
  (`integracoes_ml_anuncios`).
- **Fica para depois:** responder pelo painel (`POST /answers`, escrita no ML) e
  preencher `item_id` no vinculo com o Estoque.
- **⚠️ Escrito a partir da documentacao.** Conferir o formato na primeira busca
  real.

### 🟡 Importacao dos anuncios do ML — etapa 1 pronta, vinculo pendente (RN-123)
- **Arquivo(s):** `src/lib/integracoes/mercado-livre/{item-ml,importacao-anuncios}.ts`,
  `src/lib/actions/importacao-ml.ts`, `src/app/(painel)/integracoes/mercado-livre/page.tsx`,
  tabela `integracoes_ml_anuncios` (migracao `0012`)
- **Situacao (2026-10-29):** o botao "Importar agora" traz da conta, so com GET,
  titulo, SKU, preco, quantidade disponivel e vendida, status, tipo, descricao e
  os links das fotos. Tudo fica fora do Estoque.
- **⚠️ Escrito a partir da documentacao, nao de uma resposta real.** Conferir na
  primeira importacao:
  - se o total bate com o do painel do ML. A busca `search_type=scan` vai sem
    filtro de status, e a doc nao diz se assim traz pausados e encerrados;
  - se o `/items/bulk` respondeu no formato esperado (`status_code` + `body`).
    Se nao, a importacao falha inteira e nada e gravado.
- **Fica para a etapa 2:**
  - o vinculo anuncio → item, informando lote e custo, com bloqueio para SKU
    duplicado;
  - a copia das fotos para o MinIO;
  - a importacao automatica (hoje so pelo botao).
- **Nao usa `integracoes_sincronizacoes` de proposito:** a tela Integracoes da
  alerta "urgente" para sincronizacao parada ha mais de 90 min, e a importacao
  manual acenderia esse alerta depois de cada clique. A "ultima importacao" sai
  de `max(sincronizado_em)` da propria tabela.
- **Antes de usar em PRD:** novo deploy (que tambem libera as fotos
  `*.mlstatic.com` no `next.config.ts`) e, no console do servico,
  `node scripts/migrar.mjs` (migracao `0012`, so cria a tabela). Nao e
  `npm run db:migrate`: o `drizzle-kit` nao entra na imagem (runbook §4).

### 🟢 Spec "Sistema de Anuncios" pede Prisma; o projeto usa Drizzle (intencional)
- **Modulo:** Integracoes (Mercado Livre)
- **Situacao (2026-10-29):** a especificacao externa do sistema de anuncios do
  ML pede Next.js + **Prisma** e um modelo proprio (`TokenMl`, `Produto`,
  `Anuncio`...). Este repo proibe Prisma (regra absoluta, bloqueada por hook).
  Decisao do Paulo: a Fase 0 da spec foi feita **aqui, com Drizzle**,
  reaproveitando o que ja existia. `TokenMl` = `integracoes_credenciais`, e o
  OAuth/PKCE/refresh e o `client.ts` ja cobriam a fase. O que entrou de novo foi
  o `/users/me` na tela Integracoes e o `docs/ml-api-notas.md`.
- **Divergencias da spec que a doc oficial confirmou:**
  - SKU vai so no atributo `SELLER_SKU`, nao tambem no `seller_custom_field`.
  - `family_name` × `title` se decide pela tag `user_product_seller`, nao por
    tentativa e erro.
  - O multiget `/items?ids=` foi descontinuado; o substituto e `/items/bulk`.
- **Renovacao do token:** acontece quando alguma chamada pede o token (margem de
  20%, cerca de 72 min antes de vencer). Abrir a tela Integracoes dispara uma
  renovacao, e a reconciliacao tambem: o `scripts/agendador.mjs` a chama a cada
  15 min, e a primeira coisa que ela faz e chamar o ML. Com o servico do
  agendador no ar, o token se renova sozinho. A dependencia e implicita: se a
  reconciliacao sair do agendador, a renovacao periodica sai junto.
- **Proximas fases da spec:** cada modelo Prisma vira tabela Drizzle via
  `/criar-tabela`.

### Emissao de NF-e — nao definida
- **Modulo:** Pedidos, Expedicao
- **Situacao:** o proprio prototipo marca "A configurar". Falta escolher o
  emissor fiscal e providenciar **certificado A1**.
- **Por que importa:** a etapa "NF-e emitida" e a **primeira** do stepper de
  expedicao. Sem ela, o fluxo de despacho nao fecha.
- **Acao sugerida:** definir provedor (ex.: Focus NFe, eNotas, PlugNotas — nao
  emitir direto na SEFAZ) e quem guarda o certificado. Dados da empresa para a
  nota ja estao no fim do README do handoff.

### OLX — confirmar se a conta tem acesso a API
- **Modulo:** Anuncios, Integracoes
- **Situacao:** o handoff cita a API de importacao de anuncios
  (developers.olx.com.br) com autoupload. Nao ha confirmacao de que a conta da
  MM tem esse acesso liberado.
- **Acao sugerida:** confirmar antes de modelar a sincronizacao. Se nao houver
  API, a tela vira cadastro manual — muda o escopo.

### WhatsApp — qual nivel de integracao
- **Modulo:** Perguntas, Pedidos, Notificacoes, Site publico
- **Situacao:** o prototipo diz "Vinculado" com catalogo, respostas rapidas e
  registro de venda direta. Isso pode ser **WhatsApp Business App** (manual, link
  `wa.me`) ou **Cloud API** (Meta, com custo por conversa e aprovacao de
  template).
- **Por que importa:** os alertas de SLA e de despacho sao **enviados por
  WhatsApp** (README). Alerta automatico exige Cloud API + template aprovado.
  A diferenca entre as duas opcoes e de semanas de trabalho.
- **Acao sugerida:** decidir antes de planejar a fila de notificacoes.

### Base de calculo da comissao de 4%
- **Modulo:** Equipe, Relatorios (RN-108)
- **Situacao:** o rodape da tela Pedidos sugere 4% sobre o **bruto**
  (R$ 38.400 → R$ 1.536). Nao esta confirmado se e sobre o bruto ou o liquido de
  taxas.
- **Por que importa:** define o acerto de comissao de todo mes.
- **Acao sugerida:** confirmar com o Anderson antes de implementar.

### Taxa do Mercado Livre esta fixa em 14%?
- **Modulo:** Precificacao (RN-102)
- **Situacao:** a taxa do ML varia por categoria e tipo de anuncio (classico x
  premium). O prototipo usa 0,14 fixo.
- **Por que importa:** se variar, o preco sugerido sai errado — e preco errado
  aqui e prejuizo direto.
- **Acao sugerida:** confirmar se 14% cobre o catalogo da MM ou se a taxa precisa
  vir da API do ML por item.

### Nenhuma tela do operador foi desenhada
- **Modulo:** Estoque, Lotes, Calculadora (RN-107)
- **Situacao:** as 13 capturas do handoff mostram so a visao do administrador —
  **custo aparece nas tres telas**. A RN-107 exige que o operador nunca veja
  custo, com filtro **no servidor**. A tabela de Estoque e um grid de 7 colunas
  fixas com `CUSTO` no meio: sem a coluna, o layout nao esta definido.
- **Por que importa:** o operador e 1 dos 2 usuarios do painel e o escopo
  contratado inclui 5 semanas treinando ele. Nao existe desenho do que ele ve.
  Casa com "Autenticacao existe, mas ninguem tem senha ainda" e com a matriz de
  RBAC, que segue sendo proposta.
- **Acao sugerida:** definir a variante de operador das tres telas antes de
  portar qualquer uma delas — e uma decisao de layout, nao so de permissao.

### Negociacao de preco: o operador decide sem poder ver o custo
- **Arquivo(s):** `design_handoff_sistema_mm/Sistema MM Solucoes.dc.html` —
  linhas 271-274 (Perguntas), 208-213 (Anuncios), 454-458 (Estoque).
  Referencia; nao alterar, invariante 6.
- **Situacao:** o mesmo item aparece em tres telas, e as tres juntas descrevem
  uma decisao que ninguem definiu quem toma. Em **Perguntas**, o comprador
  oferece **R$ 4.800** pela "Encadernadora industrial" e existe um botao
  **"Contra-proposta"**. Em **Anuncios**, o item esta a **R$ 5.200** com pill
  "Negociando". Em **Estoque**, o custo e **R$ 3.300** — exatamente o campo que
  a RN-107 esconde do operador.
- **Por que importa:** a tela pede decisao de preco a quem nao tem o dado para
  avalia-la. Ou existe limite pre-aprovado ("o operador fecha ate X% abaixo do
  preco alvo"), ou toda negociacao sobe para o Anderson e o botao passa a ser
  "encaminhar". Hoje nao existe nem um nem outro: "Contra-proposta" e um botao
  sem regra atras.
- **Esconder o custo nao resolve:** sigilo e decisao sao problemas diferentes. O
  operador precisa de um limite **derivado** do custo sem ver o custo — ex.: a
  tela mostra "pode aceitar ate R$ 4.900" e nunca exibe os R$ 3.300. Isso e
  calculo de dinheiro, entao nasce em `src/lib/pricing.ts` (RN-100), nunca no
  componente.
- **Acao sugerida:** confirmar com o Anderson (a) se o operador negocia, (b)
  qual o limite, (c) o que acontece quando a proposta fica fora dele. Registrar
  em `docs/regras-negocio.md` **antes** de portar Perguntas. Casa com "Nenhuma
  tela do operador foi desenhada" acima.
- **Nota:** os valores citados sao mock (ver 🟢 "Os dados do prototipo sao
  mock") — servem para localizar o caso nas telas, nao como numeros reais. A
  lacuna de regra e que e real.


### `PRD_BACKUP_DEST` precisa ser configurado — o deploy PRD agora falha sem ele
- **Arquivo(s):** `.github/workflows/deploy.yml`
- **Situacao:** o backup de producao **vazava**: o `pg_dump` era copiado para o
  runner e publicado como **artifact do GitHub Actions por 90 dias** — baixavel
  por qualquer pessoa com acesso de leitura ao repositorio, com nome, endereco,
  CNPJ e valor de venda de cliente real. **Corrigido em 2026-08-10**: o dump nao
  toca mais a infraestrutura do GitHub; a copia off-server e HOST -> DESTINO.
  A mesma falha existia na **estrutura base** e foi corrigida la tambem.
- **O que falta:** criar o secret `PRD_BACKUP_DEST` (ex.:
  `backup@10.0.0.9:/srv/backups/mm`) e autorizar a chave SSH **da VPS de banco**
  no destino. Sem isso o job de PRD para no passo "Exigir destino de backup
  off-server" — de proposito: deploy sem backup off-site fere a regra de DR.
- **Ainda pendente:** a politica do CLAUDE.md pede retencao (30/90 dias) e
  **restore testado em HML**. Backup nunca restaurado nao e backup.

### O endpoint de webhook nasce publico — e e ele que da baixa no estoque
- **Modulo:** Integracoes, Pedidos, Estoque
- **Situacao:** o handler de notificacao do ML sera uma rota publica. Nao ha
  verificacao de autenticidade prevista em lugar nenhum. Quem descobrir a URL
  consegue **forjar uma venda**: cria pedido, baixa o item e pausa os anuncios
  nos outros canais.
- **Por que importa:** nao precisa nem forjar venda para causar dano — basta
  disparar volume para virar tempestade de reprocessamento.
- **Acao sugerida:** validar assinatura/origem da notificacao e tratar o corpo
  como **nao confiavel**: usar o webhook so como "algo mudou no recurso X" e ir
  buscar o estado real na API. Nunca gravar dinheiro a partir do corpo do POST.

### A RN-104 e um fan-out distribuido sem outbox
- **Modulo:** Integracoes, Anuncios, Estoque
- **Situacao:** vendeu no ML -> grava no nosso banco (commit) -> precisa **pausar
  na OLX**, que e uma chamada HTTP depois do commit. Se falhar, nao existe nem
  coluna dizendo "pausa pedida, canal nao confirmou".
- **Por que importa:** a peca unica continua a venda no outro canal e **ninguem
  fica sabendo**. E a mesma falha que a RN-112 evita dentro do banco, mas do
  lado de fora — e ali o indice unico nao alcanca.
- **Acao sugerida:** tabela de **outbox**: a intencao ("pausar anuncio X no
  canal Y") e gravada na MESMA transacao da venda, e um worker entrega depois com
  retry. Chamada externa **nunca** dentro de transacao de banco — segura lock e
  envenena o pool. Ver tambem a decisao de fila (Postgres x Redis) em 🟡.

---

## 🟡 Investigar

### `itens.segmento` e texto livre — "Oftalmologia" e "oftalmologia" sao dois
- **Arquivo(s):** `src/lib/db/schema/itens.ts`, `lotes.ts`
- **Situacao:** achado ao portar a tela Estoque (2026-08-11). Os chips de
  segmento saem de `SELECT DISTINCT segmento`, e o banco mostrou **`Oftalmologia`
  e `oftalmologia` como segmentos separados** — dois chips, filtros que nao se
  encontram, e itens que somem de uma busca que deveria acha-los.
- **Por que e texto livre:** de proposito — o conjunto de segmentos cresce a cada
  leilao, e um enum exigiria migracao a cada categoria nova (esta escrito no
  proprio schema).
- **Acao sugerida:** decidir entre normalizar na gravacao (minusculo + capitalizar
  na exibicao), tabela de segmentos com FK, ou aceitar e agrupar por
  `lower(segmento)` nas consultas. **Nao e so cosmetico:** a tela Estoque filtra
  por segmento, e o KPI "Sem anuncio" combinado com segmento errado esconde item
  parado.

### ✅ CORRIGIDO em 2026-08-11: o porteiro migrou de `middleware` para `proxy`
- **Arquivo(s):** `src/proxy.ts` (era `src/middleware.ts`)
- **Era:** o Next 16 depreciou a convencao `middleware`. Funcionava, mas quando
  a convencao antiga for removida o arquivo simplesmente deixa de ser carregado
  — **sem erro nenhum**, e o redirecionamento para de acontecer em silencio.
- **Ficou:** arquivo renomeado e a funcao exportada passou de `middleware` para
  `proxy`. Feito **a mao**, e nao pelo codemod oficial: ele exigia `--force`
  sobre a arvore inteira, e a mudanca real e um rename de arquivo mais um de
  funcao. Varrer o projeto todo para isso e risco sem contrapartida.
- **Verificado:** o aviso do build sumiu, e os **oito** casos do porteiro foram
  repetidos — sem cookie, sessao valida, cookie forjado, sessao vencida, usuario
  desligado, reativado, sessao encerrada, e as rotas de maquina (webhook)
  continuando livres. Migracao de porteiro so vale com o teste do porteiro.
- **Nao volte a chamar de middleware.**

### Reconciliacao: existe e fecha o laco, mas so olha PEDIDOS
- **Arquivo(s):** `src/lib/integracoes/mercado-livre/reconciliacao.ts`,
  `busca-pedidos.ts`, `src/lib/db/schema/integracoes-sincronizacoes.ts`,
  `src/app/api/integracoes/reconciliar/route.ts`
- **O que resolve:** nenhum marketplace garante 100% de entrega. Se uma venda se
  perder, o sistema **nao sabe que nao soube** — idempotencia nao pega evento que
  nunca chegou. A reconciliacao lista os pedidos do canal e compara com os
  nossos.
- **Como corrige, e o quanto NAO corrige:** achando pedido pago que nao temos,
  ela grava um **evento sintetico** em `integracoes_eventos`, como se o webhook
  tivesse chegado — e quem processa e o handler de venda que ja existe.
  **Nenhuma rota de correcao paralela**, que seria uma segunda implementacao da
  mesma regra para divergir depois. Esse e o UNICO caso auto-corrigido.
- **Verificado (2026-08-11)** contra ML falso, removido depois: pedido perdido
  virou venda completa passando pelo handler normal; reconciliar de novo nao
  reinjeta (o corpo do evento e deterministico, entao a chave colide); a marca
  d'agua avanca e a segunda passada pagina menos.
- **⚠️ AINDA E DECISAO DO ANDERSON: corrige sozinho ou so reporta?** O que esta
  implementado e a recomendacao da analise de corretude, nao confirmacao dele.
- **A lacuna que mais pesa: ANUNCIO divergente nao e detectado.** A comparacao
  so olha pedidos. O caso "nos dizemos vendido e o canal diz ativo" — que e onde
  a decisao acima realmente importa, porque corrigir sozinho pausaria anuncio
  certo por leitura errada — nao chega nem a ser visto.
- **O filtro de data da busca NAO foi confirmado.** `/orders/search` aceita
  `seller`, `sort`, `limit` e `offset` (confirmados); o nome do parametro de data
  nao. Por isso o corte pela marca d'agua e feito por NOS, paginando em
  `sort=date_desc` ate alcanca-la. Ha teste garantindo que a URL nao carrega
  parametro nao confirmado — **um "otimizador" chutado pode ser ignorado em
  silencio pelo ML e fazer a busca varrer o historico inteiro**.
- **Passada truncada nao avanca a marca**, de proposito: avancar deixaria para
  tras um vao que ninguem conferiria nunca mais. Primeira execucao (sem marca)
  vai ate o teto de 10 paginas — reconstruir historico nao e trabalho dela.
- **Falta o alarme de obsolescencia.** `ultimo_sucesso_em` existe e e alimentado
  (separado de `updated_at` justamente porque a linha e tocada tambem no erro),
  mas **ninguem le**: nao ha job que compare com "agora" nem card vermelho na
  tela Integracoes. Sem isso, uma reconciliacao que parou de rodar e
  indistinguivel de uma que nao acha nada.
- **Ninguem agenda.** A rota `/api/integracoes/reconciliar` existe e e separada
  do worker de proposito (cadencias e custos diferentes), mas nada a chama —
  mesmo ADR de agendamento, ainda aberto.

### OAuth do ML: pronto e verificado, mas so destrava com o app registrado
- **Arquivo(s):** `src/lib/integracoes/mercado-livre/oauth.ts`,
  `src/app/api/integracoes/oauth/mercado-livre/{iniciar,callback}/route.ts`
- **Como conectar:** como administrador, botao "Conectar Mercado Livre" no card
  da tela Integracoes. Ate 2026-10-29 era a URL `/iniciar?t=$WEBHOOK_SECRET`
  digitada a mao.
- **Verificado em 2026-08-10** contra um ML falso que validava PKCE de verdade
  (removido depois): `/iniciar` sem segredo da 404; a URL de autorizacao sai com
  `response_type`, `state`, `code_challenge` e `S256`; **callback com `state`
  forjado e recusado**; callback sem cookie e recusado; o fluxo legitimo grava a
  credencial **cifrada** (`access_token` nao contem o valor em claro); e
  reautorizar faz a credencial anterior sair por **exclusao logica**, mantendo
  uma unica ativa pelo indice parcial.
- **⚠️ O app precisa ser registrado com PKCE ATIVO.** E opcao no portal do ML e o
  codigo sempre manda `code_verifier`. Se o app for criado sem PKCE, a troca
  falha — a mensagem de `TrocaDeTokenError` ja diz isso, para a falha se
  explicar sozinha.
- **⚠️ `ML_REDIRECT_URI` tem que ser identico ao cadastrado**, sem parametro
  grudado: o ML compara a URL inteira. O que se quer levar vai no `state`.
- **A rota `/iniciar` e so de administrador** desde 2026-10-29. O segredo `?t=`
  saiu, porque era o porteiro provisorio do tempo sem login. Sem porteiro,
  qualquer um conectaria a PROPRIA conta do ML e substituiria a da MM (so ha uma
  credencial ativa por canal).
- **O estado do fluxo vive em cookie cifrado**, nao em tabela — `sameSite=lax`
  de proposito: com `strict` o navegador nao manda o cookie na volta do ML
  (navegacao vinda de outro site) e o fluxo morre sem explicacao.

### Cliente do ML: o que ficou pronto, e as tres lacunas assumidas
- **Arquivo(s):** `src/lib/integracoes/cofre.ts`,
  `src/lib/integracoes/mercado-livre/{token,client,politica}.ts`,
  `src/lib/db/schema/integracoes-credenciais.ts`
- **Pronto e verificado** (2026-08-10, contra um ML falso local, removido depois):
  token vencido renova e refaz a chamada; **5 chamadas simultaneas com token
  vencido produziram UMA unica troca** (advisory lock + reconferencia dentro do
  lock); 429 respeita `Retry-After` e pausa o portao inteiro; 404 nao repete.
- **Lacuna 1 — a chave de cifragem nao gira.** `CREDENCIAIS_KEY` (AES-256-GCM)
  e lida do ambiente; nao ha procedimento de rotacao nem recifragem do que ja
  esta gravado. O pacote tem prefixo `v1.` justamente para permitir isso depois.
  **Quem guarda a chave em producao ainda nao foi definido** — se ela ficar no
  mesmo lugar do dump, a cifragem nao protege de nada.
- **Lacuna 2 — a pausa do 429 vale por PROCESSO.** O estado do portao e memoria
  do processo. Com mais de uma instancia da aplicacao, cada uma aprende o 429
  por conta propria. Coordenar exigiria estado compartilhado (tabela ou Redis) —
  casa com o ADR de fila.
- **Lacuna 3 — nao existe renovacao proativa por job.** Hoje o token so e
  renovado quando alguem chama a API e ele esta dentro da margem de 20%. Se
  ninguem chamar por muito tempo, a renovacao acontece na primeira chamada
  depois — que e o caminho mais lento justo quando ha pressa. A analise pede
  job proativo + alarme quando `expira_em` passa sem renovacao.
- **Nao construido de proposito:** o fluxo OAuth de autorizacao (URL de
  consentimento + rota de callback). Exige o redirect URI registrado no portal
  do ML, que nao existe. Ate la a primeira credencial entra por SQL manual, com
  os tokens passados por `cifrar()`.
- **⚠️ Invariante novo:** `chamarML()` e o **portao unico**. Ninguem chama
  `fetch` na API do ML fora de `mercado-livre/client.ts` — mesma disciplina do
  `pricing.ts` com dinheiro. O 429 e do app inteiro, nao da chamada: com varios
  `fetch` soltos, cada pedaco do codigo descobre o bloqueio sozinho e continua
  batendo.

### O worker retenta sem backoff, e o disparo dele e uma rota HTTP
- **Arquivo(s):** `src/lib/integracoes/worker.ts`,
  `src/app/api/integracoes/worker/route.ts`, `src/lib/integracoes/handlers.ts`
- **Situacao:** o worker drena um lote e volta — nao ha agendador. Quem chama e
  `POST /api/integracoes/worker?t=<WEBHOOK_SECRET>`. Duas lacunas assumidas:
  1. **Sem backoff por tempo.** Um evento que falha e tentado de novo na
     proxima drenagem, sem espera. Backoff exigiria coluna
     `proxima_tentativa_em` e a decisao de fila junto. Hoje o teto de 5
     tentativas ja impede o loop infinito; com canal fora do ar, as 5 queimam
     rapido e o evento vira "esgotado" antes de o canal voltar.
  2. **Sem lanes de prioridade.** Uma varredura em massa e uma pergunta com SLA
     de 4h entram na mesma fila, em ordem de chegada.
- **Por que a rota, e nao um daemon:** onde o worker roda e ADR aberto (fila em
  Postgres x BullMQ/Redis — decisao do Lucas). Uma rota nao decide isso: da
  para chamar por cron, curl ou agendador de plataforma. Um `setInterval` ou um
  BullMQ dentro do codigo ja teriam escolhido no lugar dele.
- **Segredo compartilhado com o webhook**, de proposito: mesma superficie
  (endpoint de integracao chamado por maquina). Se a rotina de rotacao separar
  as duas coisas, ai vale segredo proprio.
- **Estado hoje:** `HANDLERS` esta **vazio** — sem credencial nao existe o GET
  na API do canal, e processar sem ele seria deduzir venda do corpo do POST
  (proibido pela RN-117). A consulta filtra pelos topicos com handler, entao o
  worker reivindica zero e **nenhum evento gasta tentativa** enquanto isso. Os
  eventos acumulam e serao processados retroativamente — e para isso que a
  caixa de entrada existe.
- **Verificado em 2026-08-10** com handlers falsos (removidos em seguida): lote
  de 3 → 2 processados e 1 falho; retentativas ate esgotar na 5a; evento
  esgotado sai da fila com o erro gravado.

### Recado entre agentes: `pedidos.vendido_em` / `custo_na_venda` mudaram de migracao
- **Arquivo(s):** `src/lib/db/migrations/0005_ancient_gunslinger.sql`,
  `meta/0004_snapshot.json`
- **Situacao:** as duas colunas do caso 5 (retrato do pedido) foram parar na
  `0004` por acidente — o `db:generate` da tabela `integracoes_eventos` pegou o
  `pedidos.ts` ja alterado e empacotou tudo junto. **Separado em 2026-08-10**:
  `0004` ficou so com `integracoes_eventos` + a semente do usuario de sistema, e
  as colunas foram para a `0005`. O snapshot da `0004` foi corrigido junto —
  sem isso o proximo `db:generate` acharia que ja tinham sido migradas e elas
  **sumiriam da cadeia em silencio**.
- **Verificado:** regerar propos exatamente as 3 linhas esperadas (prova de que
  o snapshot ficou consistente), e as 6 migracoes aplicam limpas num banco
  zerado via `psql`.
- **Para quem esta no caso 5:** se quiser a migracao com a sua autoria, apague
  `0005*.sql` + `meta/0005_snapshot.json`, tire a entrada de `_journal.json` e
  regere — o `pedidos.ts` continua sendo a fonte. Instrucoes no cabecalho do
  proprio arquivo.
- **⚠️ Nao consertado, e decisao sua:** `ADD COLUMN ... NOT NULL` sem DEFAULT
  falha em tabela com linhas. Passa hoje porque `pedidos` esta vazia; em PRD
  quebra o deploy. Caminho seguro: nullable -> backfill -> `SET NOT NULL`.
- **Licao geral:** `db:generate` empacota TUDO que estiver divergente no
  schema, nao so o que voce mexeu. Com varios agentes no mesmo repo, olhe o SQL
  gerado antes de aplicar.

### Reativar registro logicamente excluido pode colidir — tratar na UI
- **Arquivo(s):** `src/lib/db/schema/usuarios.ts`, `itens.ts` (unicos parciais)
- **Situacao:** confirmado **em banco real** (`scripts/db/prova-constraints.sql`,
  caso 2b): excluir um usuario, recadastrar a mesma pessoa e depois tentar
  **reativar** o registro antigo estoura `23505`. O banco esta certo — dois
  usuarios ativos com o mesmo e-mail nao podem existir. Vale igual para SKU.
- **Por que importa:** e o caso do "excluiu por engano e quer voltar atras".
  Sem tratamento, o operador leva erro cru em vez de "ja existe um cadastro
  ativo com este e-mail".
- **Acao sugerida:** capturar `23505` na action de reativacao e devolver
  mensagem util. Nao e correcao de schema.

### Timestamps sem fuso horario, e o SLA depende de instante
- **Arquivo(s):** todos os schemas (`created_at`, `updated_at`, `deleted_at`,
  `perguntas.prazo_sla`, `perguntas.respondida_em`)
- **Situacao:** as colunas sao `timestamp without time zone`, seguindo o
  `templates/schema.ts` e o CLAUDE.md, que dizem literalmente `TIMESTAMP`.
- **Por que importa:** `prazo_sla` guarda um INSTANTE comparado com `now()` para
  acender a pill vermelha e disparar alerta (RN-105) — e o mesmo vale para o
  prazo de despacho (RN-106). App em UTC gravando `Date` do JS + banco em -03
  divergem em 3 horas: alerta de SLA que dispara tarde e reputacao perdida.
- **Acao sugerida:** decidir com o Lucas — `timestamp({ withTimezone: true })`
  nas colunas de instante (muda o template da base, vale para todos os projetos)
  OU cravar que app e banco rodam em UTC e documentar. Registrar em ADR.
- **Janela:** a migracao **ja rodou no banco local** (descartavel: `docker
  compose down -v` e comeca de novo, custo zero). Decidir **antes de aplicar em
  HML/PRD** — depois disso vira ALTER em producao.

### SKU e e-mail voltam a ficar livres apos exclusao logica
- **Arquivo(s):** `src/lib/db/schema/itens.ts`, `src/lib/db/schema/usuarios.ts`
- **Situacao:** troquei o `UNIQUE` global por **indice unico parcial**
  (`WHERE is_deleted = false`). Sem isso, o soft delete — que e regra absoluta da
  casa — prenderia o e-mail de um usuario excluido para sempre: recadastrar a
  mesma pessoa estouraria erro 23505.
- **Efeito colateral:** o SKU de um item logicamente excluido pode ser reusado.
- **Acao sugerida:** confirmar com o Anderson se SKU pode ser reaproveitado.
  Se **nao** puder, o unico de `itens.sku` volta a ser global e a exclusao de
  item passa a exigir outro tratamento. Casa com a pendencia "Padrao de SKU".

### `pedidos` ganhou chave natural `(canal, numero)` — confirmar
- **Arquivo(s):** `src/lib/db/schema/pedidos.ts`
- **Situacao:** criei indice unico parcial em `(canal, numero)`. E ele que
  sustenta a **idempotencia** exigida pela RN-104: reprocessar o webhook do ML
  tem que colidir, nao criar um segundo pedido.
- **A confirmar:** o numero do pedido e unico **entre** canais ou so **dentro**
  de cada canal? Assumi "dentro do canal", que e a hipotese segura. Se for
  global, o indice pode ser so em `(numero)`.

### `modified_by` de `usuarios` e a unica coluna sem FK
- **Arquivo(s):** `src/lib/db/schema/usuarios.ts`
- **Situacao:** as outras 5 tabelas que tem `modified_by` (lotes, itens,
  anuncios, perguntas, pedidos) apontam para `usuarios.id` com FK RESTRICT,
  como o CLAUDE.md exige (`auditoria` nao tem `modified_by`: e append-only e
  registra o autor em `user_id`, esse sim com FK). Em `usuarios` seria auto-referencia e o
  **primeiro** usuario nao teria quem apontar (bootstrap chicken-and-egg).
- **Acao sugerida:** decidir entre usuario-semente com uuid fixo criado na
  migracao inicial, ou manter sem FK so nessa tabela.
- **Atencao:** o arquivo-ouro `templates/schema.ts` (herdado da base) tambem
  omite essa FK. A proxima tabela criada por `/criar-tabela` nasce sem ela.
  Corrigir o template e decisao do Lucas — vale para todos os projetos.

### Tabelas que as regras ja exigem e ainda nao existem
- **Situacao:** o scaffold criou 7 tabelas (usuarios, lotes, itens, anuncios,
  perguntas, pedidos, auditoria). Faltam, ja previstas nas regras:
  - ~~`itens_fotos` + coluna `exibir_no_site`~~ — **criadas em 2026-08-10**
    (migracao `0007`), junto com a integracao do MinIO;
  - `site_leads` — RN-111 (formulario "Receba os novos lotes").
- **Acao sugerida:** criar `site_leads` com `/criar-tabela` quando a tela
  Site/CMS entrar.

### Pedido cancelado nao tem estado — e vira soft delete
- **Arquivo(s):** `src/lib/db/schema/pedidos.ts`
- **Situacao:** `status_pedido` tem aguardando_envio / em_transporte / concluido.
  A RN-104 fala em cliente **cancelando no ML**, mas nao ha estado para isso, e
  cancelamento representado como exclusao logica e semanticamente errado (o
  pedido existiu, gerou taxa e talvez NF-e).
- **Mitigado por ora:** o unico de `(canal, numero)` e **global**, nao parcial —
  entao mesmo com soft delete o webhook nao consegue recriar o pedido.
- **Acao sugerida:** confirmar com o Anderson se precisa de `cancelado` e
  `devolvido` no enum, e como isso afeta comissao (RN-108) e estoque (RN-104).

### `pedidos` nao guarda prazo de despacho nem dados de expedicao
- **Arquivo(s):** `src/lib/db/schema/pedidos.ts`
- **Situacao:** a RN-106 exige alerta a 24h do limite de despacho, mas nao ha
  coluna de prazo (compare com `perguntas.prazo_sla`, que existe justamente para
  isso). A tela Expedicao tambem mostra destino, modalidade, peso, dimensoes e
  embalagem — nenhum desses campos existe.
- **Acao sugerida:** ao construir a tela, `prazo_despacho` em `pedidos` ou uma
  `pedidos_expedicao` via `/criar-tabela`.

### `nfe_emitida` e `etapa_expedicao` guardam o mesmo fato fiscal
- **Arquivo(s):** `src/lib/db/schema/pedidos.ts`
- **Situacao:** renomeei o 1o estado do enum de `nfe_emitida` para
  `aguardando_nfe`, o que tirou a contradicao do DEFAULT (todo pedido nascia
  dizendo que a nota nao foi emitida **e** que a etapa era "NF-e emitida").
  Ainda assim sao duas fontes para o mesmo fato: o boolean e o estagio.
- **Acao sugerida:** ao integrar o emissor, escolher uma so — provavelmente
  derivar `nfe_emitida` do estagio — ou amarrar as duas com CHECK.

### Frete e margem usados no calculo do preco alvo nao sao guardados
- **Arquivo(s):** `src/lib/db/schema/itens.ts`
- **Situacao:** `preco_alvo` guarda so o resultado. O frete estimado e a margem
  que produziram aquele numero somem, entao nao da para auditar como o preco foi
  obtido nem recalcular em lote quando a taxa do ML mudar (pendencia 🔴 aberta).
- **Acao sugerida:** gravar `frete_estimado` e `margem_alvo` junto, ou registrar
  em ADR que `preco_alvo` e valor digitado, nao derivado.

### Matriz de permissoes do RBAC e rascunho
- **Arquivo(s):** `docs/rbac.md`
- **Situacao:** reescrevi a doc para os 3 papeis reais (administrador, operador,
  consultoria) — ela descrevia 4 papeis inexistentes herdados do template da
  base. A matriz por recurso, porem, e **proposta minha**, nao validada.
- **Cravado:** so a RN-107 (operador nao ve custo). O resto e a confirmar.
- **Acao sugerida:** validar a matriz com o Anderson antes do primeiro CRUD.

### Convencao de teste: `src/` (colocation) x pasta `tests/`
- **Arquivo(s):** `package.json` (script `test`)
- **Situacao:** o script varre `{src,tests}/**/*.test.ts`, mas os docs herdados
  ainda listam `tests/` como a pasta oficial enquanto o codigo usa colocation
  (`src/lib/pricing.test.ts`). Se o glob so olhasse `src/`, um teste em `tests/`
  nunca rodaria e o `npm test` seguiria verde — **falso verde**, pior que teste
  faltando.
- **Acao sugerida:** cravar a convencao (recomendo colocation) e alinhar os docs.

### Painel e site publico na mesma aplicacao?
- **Situacao:** a leitura mais simples e **uma app Next** com route groups —
  `(site)` publico e `(painel)` autenticado — compartilhando banco e tokens. E o
  que evita duplicar o design system e sincronizar estoque por API.
- **Por que importa:** decide deploy, dominio e cache. O site publico e
  indexavel e precisa ser rapido; o painel e privado.
- **Acao sugerida:** confirmar e registrar em `docs/adr/`. Nao esta decidido —
  este doc so registra a recomendacao.

### Fotos: storage RESOLVIDO (MinIO) — falta o pipeline de compressao
- **Arquivo(s):** `src/lib/storage/`, `src/lib/actions/fotos.ts`,
  `src/app/api/fotos/`, `src/lib/db/schema/itens-fotos.ts`
- **Resolvido em 2026-08-10:** as fotos moram no **MinIO**, em bucket de leitura
  anonima. A escolha do bucket publico nao e atalho: o Mercado Livre publica a
  imagem **baixando da URL** que informamos, e URL assinada expira — o anuncio
  ficaria com foto quebrada dias depois. Vale igual para o cache do site.
  A ESCRITA continua exigindo chave (provado: PUT anonimo responde 403).
  Sem dependencia nova — a assinatura SigV4 e `node:crypto`, travada por vetores
  oficiais da AWS.
- **O que ainda FALTA — ⚠️ decisao/execucao:**
  1. **Nao ha compressao nem redimensionamento.** O arquivo vai para o bucket
     exatamente como saiu da camera. Uma foto de celular moderna tem 4–8 MB, e a
     vitrine serve isso num card de 190px: o visitante de 4G baixa dezenas de MB
     numa pagina. O `next/image` reduz o que ele mesmo serve, mas nao muda o que
     esta guardado nem o que o ML baixa. Resolver exige decidir entre `sharp`
     (dependencia nova, ~10 MB) ou a API de imagem do proprio Next.
  2. **Nao existe limpeza de objeto orfao.** A exclusao de foto e logica e o
     arquivo FICA no bucket de proposito (permite desfazer engano). Uma falha
     entre o upload e o INSERT tambem deixa objeto sem linha. Nenhum dos dois
     incomoda com o volume de hoje; vira problema com anos de operacao.
  3. **O bucket precisa existir e ter a politica aplicada** em cada ambiente —
     nao e criado pela aplicacao. Ver o passo a passo no fim do
     [architecture.md](architecture.md) §12.

### ⚠️ O upload de foto nasce sem autenticacao — e grava no nosso storage
- **Arquivo(s):** `src/app/api/fotos/route.ts`, `src/lib/actions/fotos.ts`
- **Situacao:** `POST /api/fotos` esta tao aberto quanto o resto do painel, pelo
  mesmo motivo (nao existe autenticacao — pendencia 🔴 acima). So que aqui a
  consequencia e diferente: as outras telas expoem leitura, esta **grava
  arquivo** num bucket de leitura publica, servido pelo nosso dominio.
- **O que ja limita o dano:** o tipo e conferido pelos BYTES (nao pelo
  `content-type` nem pela extensao), ha teto de 10 MB, teto de 12 fotos por item,
  exigencia de item existente e o caminho no bucket e gerado pelo servidor — o
  nome enviado nunca vira caminho. Nada disso impede alguem de subir 12 fotos
  validas em cada item.
- **Mitigacao para producao HOJE:** ligar o **Basic Auth do EasyPanel** no
  dominio do painel, deixando so o site publico sem ele. E configuracao de
  borda, zero codigo, e some sozinha quando a autenticacao existir.
- **Acao sugerida:** ao implementar a sessao, o unico ponto a mudar e
  `autorEdicao()` em `src/lib/actions/fotos.ts` — que hoje assina como usuario de
  sistema e, por isso, **suja a trilha**: nao da para distinguir o que o Anderson
  subiu do que o robo gravou.

### Padrao de SKU e endereçamento do galpao
- **Modulo:** Estoque, Expedicao
- **Situacao:** o prototipo mostra SKU `MM-OFT-1401` (prefixo + segmento +
  sequencial?) e local `A · 2`. Nao ha regra de geracao nem mapa de enderecos.
- **Acao sugerida:** definir com o Anderson — e o que o operador usa no dia a dia.

### Infraestrutura: 4 VPS e exagero para este cliente?
- **Situacao:** o padrao da casa (CLAUDE.md) pede VPS separadas de front e back,
  em HML e PRD — 4 maquinas. Para um cliente unico com um operador, e custo alto.
- **Acao sugerida:** decidir com o Lucas se este projeto abre excecao (ex.: uma
  VPS por ambiente) e registrar em ADR. Nao inventar a excecao no meio do deploy.

### Single-tenant hoje
- **Situacao:** o sistema e da MM Solucoes, uma empresa so. Nao ha `tenant_id`
  previsto e o handoff nao menciona white-label.
- **Por que importa:** se a Orbital quiser revender o painel para outro
  revendedor de leilao, o schema inteiro muda. Decidir **agora** custa uma
  coluna; decidir depois custa migracao.

### Reputacao do ML na tela de Relatorios
- **Situacao:** o card mostra criterios e limites de reputacao. Nao esta claro se
  vem da API do ML ou se e digitado.
- **Acao sugerida:** confirmar ao integrar — a API do ML expoe reputacao do
  vendedor.

### O prototipo nao tem media query, e o `front.md` pede mobile-first
- **Arquivo(s):** os dois `.dc.html`, `docs/front.md` (secao Responsividade)
- **Situacao:** **zero** `@media` nos dois prototipos — sidebar de 236px fixa e
  grids de colunas fixas. O `docs/front.md` prescreve "Mobile-first" e "tabelas
  com scroll horizontal em mobile". O design aprovado e o principio de front
  dizem coisas opostas, e ninguem decidiu qual vale.
- **Por que importa:** Expedicao e Estoque sao as telas que o operador usa **no
  galpao**, onde telefone e tablet sao o provavel — e sao as menos prontas para
  tela pequena. Decide o trabalho de porte das 12 telas.
- **Acao sugerida:** cravar a largura minima suportada e registrar em ADR. A
  decisao continua aberta — o que ja existe em codigo (abaixo) e paliativo, nao
  a resposta.

#### O que ja foi feito (2026-08-10): o shell degrada, nao quebra
- **Arquivo(s):** `src/app/(painel)/layout.tsx`,
  `src/app/(painel)/_components/sidebar.tsx`,
  `src/app/(painel)/perguntas/page.tsx`,
  `src/app/(painel)/perguntas/_components/lista-perguntas.tsx`
- **O problema era real e media:** com a sidebar em `w-[236px] shrink-0` dentro
  de um `flex`, um aparelho de 375px deixava 139px para o `<main>` — menos os
  64px de padding, **75px de conteudo util**. A tela nao era "apertada": era
  inutilizavel.
- **O que mudou:** abaixo de `md` (768px) o shell empilha e a sidebar vira faixa
  no topo com rolagem horizontal; abaixo de `lg` (1024px) o grid da tela de
  Perguntas empilha as duas colunas. **Acima disso o handoff esta intacto** — os
  mesmos 236px, o mesmo `1.4fr 1fr`.
- **Os pontos de corte nao sao gosto — nao mude sem refazer a conta:**
  - `lg` para o grid: a coluna de modelos precisa de ~260px para o texto ficar
    legivel e recebe 1/2.4 do espaco util; descontando sidebar (236) e padding
    do main (64), isso so acontece a partir de ~924px de janela.
  - `md` para o shell: 236px de sidebar mais ~500px de conteudo dao ~736px.
- **Nao e hamburguer de proposito:** exigiria estado e um painel de navegacao
  que ninguem desenhou. Faixa com rolagem lateral mantem o menu como mapa do
  sistema sem inventar interacao.
- **Isto NAO e o mobile-first do `front.md`.** Nao ha alvo de toque revisto, nem
  tabela com scroll proprio, nem hierarquia repensada para tela pequena. E so
  impedir que o layout quebre — e por isso nao fecha a pendencia acima.
- **Atencao ao portar as proximas telas:** `layout.tsx` e `sidebar.tsx` sao
  compartilhados pelas **12 telas**, entao a faixa horizontal ja vale para todas
  — nenhuma tela nova precisa (nem deve) resolver o shell de novo. O que cada
  tela resolve e so o proprio grid, no mesmo espirito: empilhar abaixo do ponto
  em que a coluna mais estreita deixa de caber, sem redesenhar.
- **O `loading.tsx` da tela tem que empilhar no MESMO ponto que o `page.tsx`.**
  Ja mordeu uma vez: a responsividade entrou so na tela e o esqueleto ficou com
  `grid-cols-[1.4fr_1fr]` cravado. Resultado — no estreito o esqueleto mostrava
  duas colunas espremidas e o conteudo pulava para empilhado quando os dados
  chegavam. O esqueleto existe para **evitar** salto de layout; desalinhado dos
  breakpoints ele passa a ser a causa do salto, e o defeito so aparece na
  fracao de segundo do carregamento — ninguem topa com ele revisando codigo.
  Vale para todo `/importar-tela` que criar um `loading.tsx`.
  Mesma armadilha para largura cravada em esqueleto: um `w-96` (384px) nao cabe
  em aparelho de 375px e faz a **pagina** rolar de lado. Use `max-w-*`.
- **Nao verificado:** ninguem viu a tela renderizada em largura nenhuma. Esta
  confirmado que as classes chegam ao HTML servido e que o Tailwind compilou as
  regras em `48rem` e `64rem` — ou seja, o mecanismo funciona. Se o resultado a
  375px esta legivel, e outra pergunta, e ela continua sem resposta.

### A fila de Perguntas nao pagina — passa de 60 e o resto so aparece depois
- **Arquivo(s):** `src/lib/actions/perguntas.ts` (`LIMITE_FILA`)
- **Situacao:** a consulta traz no maximo 60 e agora **avisa na tela** quando
  truncou (faixa ambar). Avisar e o minimo honesto, mas nao e navegacao: com 61+
  pendentes, as excedentes so aparecem conforme as de cima forem respondidas e a
  pagina recarregada. Nao ha "carregar mais" nem paginas.
- **Por que importa:** as pendentes ordenam primeiro, entao o operador sempre
  recebe as mais urgentes — o corte nunca esconde a proxima a atender. O limite
  so incomoda quando alguem quiser **auditar** a fila inteira, nao para atender.
- **Acao sugerida:** nao construir paginacao agora (a MM tem 3 pendentes hoje;
  seria escopo inventado). Reavaliar se a fila passar de 60 de verdade — e ai
  decidir entre "carregar mais" e filtro por canal/estado.
- **Nota de verificacao:** o caminho `truncada: true` nunca foi exercido —
  exigiria 61 pendentes no banco. A logica e uma comparacao de tamanho e o
  typecheck cobre o tipo, mas ninguem viu a faixa ambar renderizada.

---

### ⚠️ 2026-08-11: o painel DIVERGE do handoff de proposito — casca visual nova

- **Arquivo(s):** `src/app/globals.css`, `src/app/(painel)/_components/sidebar.tsx`,
  `docs/design-system.md`
- **Decisao do Paulo**, a partir de um Figma de dashboard SaaS que ele trouxe
  como referencia de acabamento. **Nao foi um reskin**: a proposta de trocar a
  paleta pelo roxo `#605BFF` do template foi recusada por ele ("manter nossas
  cores"), e recusada tambem por dois motivos concretos — o roxo apaga a marca
  (navy + laranja vem do logo da MM) e os circulos pastel do template matam a
  semantica do ambar, que aqui significa SLA estourando, item sem anuncio e
  giro lento.
- **O que mudou:** `--color-page` `#EDEFF2` → `#F7F8FA`; `--radius-card`
  `8px` → `14px`; **novos** `--shadow-card`, `--shadow-hover`,
  `--duracao-rapida`, `--ease-padrao`; sidebar `236px` → `200px` com icone por
  item (SVG inline, sem dependencia nova).
- **O que NAO mudou, e nao pode mudar sem nova decisao:** navy `#16324F`,
  laranja `#D97941`, toda a cor de status, Archivo + Jost, o conteudo de cada
  tela e as larguras de coluna do handoff.
- **⚠️ O ROTULO DA SIDEBAR FICOU, contra o Figma.** O template usa rail so de
  icones. Aqui seriam 12 telas com icones pouco distintos entre si — Estoque,
  Lotes e Pedidos viram todos uma caixa — e o escopo contratado inclui **cinco
  semanas treinando um operador**. O icone entrou como ancora visual, nao como
  substituto do nome. Se alguem propuser o rail puro, esta e a razao de nao.
- **Consequencia para quem portar tela nova:** as capturas em
  `design_handoff_sistema_mm/screenshots/` **nao batem mais** em fundo, raio,
  sombra e sidebar. Continuam valendo para conteudo, colunas e cor de status.
- **Pendente:** Fase 2 (sombra aplicada nos cards, hover de linha na tabela,
  ordenacao por coluna, e o token de foco substituindo as 36 copias da string
  `focus-visible:outline-*`) ainda nao foi feita.

---

## 🔵 Corrigir ao portar (auditoria de usabilidade — 2026-08-10)

Achados da auditoria das 13 telas. **Nao sao para corrigir no prototipo**
(invariante 6): sao instrucoes para o `/importar-tela` da tela correspondente.
Os itens que exigem decisao do cliente subiram para 🔴/🟡 acima.

> **O que esta auditoria NAO cobriu:** o prototipo foi avaliado pelas capturas
> renderizadas mais o fonte — nao foi possivel clicar (extensao do navegador
> desconectada). Entao **hover, foco, navegacao por teclado e comportamento em
> tempo real nao foram verificados**; o que esta afirmado aqui foi conferido no
> codigo. Uma passada clicando pode achar mais.

> **Contexto que explica quase tudo desta secao:** o prototipo tem **21
> elementos interativos** no total — os 12 itens da sidebar, 5 atalhos de
> navegacao e os 3 inputs da calculadora. Todo o resto ("Responder", "Gerar
> etiqueta", "Salvar e publicar", chips de filtro, "+ Novo anuncio") e
> decorativo. O handoff e hi-fi em **aparencia**, nao em **comportamento**: o
> fluxo de cada acao primaria ainda precisa ser definido no porte.

### Todas as tabelas quebram por falta de largura minima
- **Telas:** Estoque, Anuncios, Pedidos, Visao geral
- **Situacao:** cada tabela e um `display: grid` com uma coluna `minmax(0,1fr)`
  e o resto fixo, sem `min-width` e sem guarda de overflow. Orcamento de colunas
  fixas: Estoque **536px** (linha 432), Pedidos **492px** (331), Anuncios
  **404px** (183), Visao geral **244px** (107). No Estoque, abaixo de ~1100px de
  janela, o nome do item e pintado **por cima** da coluna Lote — visivel em
  `screenshots/07-estoque.png` (`Autorrefrator¹4`, `Encadernad11ra`). As outras
  quebram depois, mas quebram pelo mesmo motivo.
- **Acao sugerida:** ao portar, `<table>` semantica com `min-width` na coluna de
  texto e truncamento com tooltip. Resolve a colisao e a acessibilidade de uma
  vez so.

### Acessibilidade: o prototipo nao tem nenhuma
- **Situacao:** nos dois arquivos somados — **0** atributos `aria-*`, **0**
  elementos `<table>` (as tabelas sao grids de `<span>`), **1** `<a href>` em 12
  telas de painel. A navegacao e `div` com `onClick`.
- **Por que importa:** portar como esta entrega tabela que leitor de tela nao le,
  sem associacao de coluna, sem ordenacao e sem navegacao por teclado. Nao e
  refinamento: e a diferenca entre a tabela funcionar e nao funcionar.
- **Acao sugerida:** no porte, tabela semantica, `<button>`/`<a>` de verdade nos
  controles e foco visivel.

### Expedicao — o prazo de despacho tem peso visual zero
- **Situacao:** `Prazo de despacho: ate 12/08` e `Coleta agendada: hoje, ate 17h`
  sao texto cinza, do mesmo tamanho e peso que "Peso" e "Embalagem", dentro da
  faixa cinza do card. O alerta ambar a 24h do limite, prometido no README do
  handoff, nao aparece em nenhuma captura.
- **Por que importa:** e o prazo que protege a reputacao no ML (RN-106) e a razao
  de a tela existir.
- **Acao sugerida:** contagem regressiva no topo do card, ambar a 24h do limite,
  e ordenar os cards por urgencia de despacho. **Depende** da pendencia
  "`pedidos` nao guarda prazo de despacho" (🟡 acima) — sem a coluna nao ha o que
  contar.

### 🔴 Calculadora — o "lance maximo" so devolve o custo digitado (2026-10-29)
- **Arquivo(s):** `src/app/(painel)/calculadora/_components/calculadora.tsx`
  (fora do git ate ser corrigida; item de menu desligado na sidebar)
- **Situacao:** o lance e calculado com o preco que acabou de sair de
  `calcularPreco(custo, ...)`. Pela identidade de `pricing.ts`, a volta da no
  proprio custo: os tres cards "pague no maximo" sempre repetem o custo de
  entrada.
- **Por que importa:** e o numero que o Anderson usaria com o martelo na mao.
  Um valor que parece calculado e nao e, numa zona de cuidado (lance no leilao).
- **Decisao pendente:** a leitura inversa precisa de uma entrada propria, o
  preco que o mercado aceita (ex.: a mediana do levantamento). Falta definir de
  onde ele vem: digitado na tela, ou lido do item ou do levantamento.
- **Ja corrigido na mesma tela:** "49.90" virava 4990, porque o codigo apagava
  todo ponto. Agora o ponto e decimal, a menos que separe grupos de 3 digitos.

### Calculadora — o resultado nao vai a lugar nenhum
- **Situacao:** calcula os tres precos e termina ali. Nao ha como aplicar o valor
  a um item ou anuncio; o usuario decora e redigita em outra tela.
- **Por que importa:** redigitar preco a mao e como se digita preco errado num
  sistema que vive de margem (RN-100).
- **Acao sugerida:** acao "usar como preco alvo" ligando o resultado ao item.
  Depende da tela de Estoque existir — portar a Calculadora depois dela, ou
  deixar o gancho previsto. Casa com "Frete e margem nao sao guardados" (🟡).

### ✅ CORRIGIDO em 2026-08-11: o rotulo "ANUNCIADO" em Lotes era ambiguo
- **Era:** `Lote 14 · CUSTO R$ 41.000 · ANUNCIADO R$ 47.400` lia-se como
  "+6.400 de lucro", mas so 4 dos 9 itens estavam anunciados — os dois numeros
  cobrem conjuntos diferentes. E o Lote 11 mostrava ANUNCIADO **abaixo** do
  CUSTO sem nenhum destaque.
- **Ficou:** cada valor diz o que soma ("2 de 5 itens"), e quando
  `anunciado + vendido < custo` aparece um aviso ambar dizendo quanto falta e
  quantos itens estao sem anuncio. Verificado com um lote nessa condicao.
- **⚠️ O alerta de "lote no vermelho" continua indefinido** — o que existe e o
  de giro lento (abaixo). Segue pendente com o Anderson.

### ✅ CORRIGIDO em 2026-08-11: Integracoes era so leitura, sem estado de erro
- **Era:** 5 cards com pill de status fixa e **nenhum botao**. Nao havia
  reconectar, testar conexao nem configurar, e o estado desconectado nao existia
  no desenho — token OAuth expira, e quando o ML caisse, quatro das doze telas
  envelheceriam em silencio.
- **Ficou:** pills reais vindas do banco, faixa de alerta quando ha o que dizer,
  e bloco de fila e conferencia. Detalhes e as regras que regem os alertas na
  entrada 🟢 "A tela Integracoes DIVERGE do prototipo".
- **O que NAO foi feito:** os botoes. Qualquer um deles dispara acao
  privilegiada e, sem autenticacao (🔴), o segredo iria no HTML da pagina.

> **Atualizacao 2026-08-11:** a autenticacao passou a existir (`src/lib/auth/`). O que trava agora e so definir a senha do administrador (`node scripts/definir-senha.mjs <email>`) e ligar estas acoes a `lerSessao()` + `temPermissao()`. Deixa de ser "nao da" e vira "falta fazer".

### Site/CMS — dois botoes de publicar e nenhuma guarda de edicao
- **Situacao:** "Publicar alteracoes" (header) e "Salvar e publicar" (editor)
  convivem sem dizer o que cada um abrange — adivinhacao para um dono
  nao-tecnico. Trocar de produto na lista da esquerda perde a edicao em
  andamento: nao ha aviso de alteracao nao salva. E o estado que a RN-109 exige
  — item **sem foto nao pode** ir ao site — nao esta desenhado em lugar nenhum:
  nao ha bloqueio do toggle nem mensagem. (A area de foto vazia nas capturas e o
  `<image-slot>` do prototipo, nao um estado de erro.)
- **Acao sugerida:** um so botao de publicar, com escopo explicito; modal block
  (padrao da casa) na publicacao; guarda de alteracao nao salva; e o estado "sem
  foto" bloqueando o toggle.

### Anuncios, Estoque e Pedidos — sem busca, ordenacao ou acao por linha
- **Situacao:** nenhuma das tres tabelas tem campo de busca, ordenacao por
  coluna ou acao na linha. Nao da para abrir, editar ou pausar um anuncio a
  partir da tela de Anuncios — o objeto principal da tela principal nao e
  clicavel.
- **Por que importa:** 16 anuncios e 51 itens cabem na tela hoje; o negocio e
  giro de estoque e esses numeros so crescem.
- **Parcialmente resolvido em Anuncios (2026-08-11):** ha **filtro por canal e
  por status, pela URL** (`/anuncios?canal=olx&status=no_ar`), os dois eixos
  combinaveis. Continua sem busca por texto, sem ordenacao por coluna e sem
  acao por linha — pausar um anuncio ainda so acontece por venda em outro canal.
- **A ordenacao atual e por VISITAS (desc)**, escolha minha, nao do handoff:
  numa tela sem ordenacao clicavel, o mais util e o que tem mais gente olhando.
  Quando a ordenacao entrar, isso vira so o padrao inicial.

### Perguntas — nao existe onde digitar a resposta
- **Arquivo(s):** `src/app/(painel)/perguntas/_components/lista-perguntas.tsx`
- **Situacao:** ha os botoes "Responder" e "Usar modelo", mas nenhum compositor
  foi desenhado. Responder e a tarefa da tela. **Na tela portada os dois botoes
  estao visiveis e inertes** — sumir com eles esconderia tambem a informacao de
  que a acao existe.
- **Como o estado inerte e apresentado (nao reverter sem ler):** os botoes usam
  `aria-disabled="true"`, **nao** o `disabled` nativo, e um unico aviso no topo
  da fila (`id="aviso-compositor"`) explica o motivo, referenciado por todos via
  `aria-describedby`. O `disabled` nativo tira o botao da ordem de tabulacao:
  quem navega por teclado nao alcancava o controle e portanto nunca via a
  explicacao, que antes vivia num `title` — atributo que so aparece no mouse.
  Um aviso visivel serve mouse, teclado, leitor de tela e tambem quem so olha e
  se pergunta por que o botao esta apagado. Sem `onClick`, clicar e inerte.
  Mesmo padrao que a sidebar ja usa nos itens de tela ainda nao construida.
- **Acao sugerida:** definir se e inline no card ou em painel lateral, e como o
  modelo preenche o texto (substitui? insere? da para editar antes de enviar?).
  Quando entrar, a acao passa a exigir sessao (`modified_by`) — ou seja, depende
  da pendencia de autenticacao (🔴 acima).

### Os "Modelos de resposta" sao constante no codigo, nao tabela
- **Arquivo(s):** `src/app/(painel)/perguntas/page.tsx` (`MODELOS`)
- **Situacao:** os 4 modelos do handoff foram portados como constante. Nao ha
  tela de edicao desenhada em lugar nenhum, entao criar entidade agora seria
  inventar escopo — mas isso tambem significa que **o Anderson nao consegue
  mudar o proprio texto padrao** sem um deploy.
- **Acao sugerida:** perguntar se ele quer editar os modelos. Se sim,
  `perguntas_modelos` via `/criar-tabela` mais a tela de edicao; se nao, deixar
  como constante e registrar em ADR que e conteudo fixo de produto.

### Defeitos visuais e lacunas menores
- **Pedidos:** ✅ CORRIGIDO em 2026-08-11 — os 4 cards subiram para ANTES da
  tabela. Tambem entrou seletor de mes, que o prototipo nao tinha (cravava
  "Agosto"), com o periodo saindo de `vendido_em` e nao de `created_at`
  (RN-114).
- **Estoque:** ✅ CORRIGIDO em 2026-08-11 — os KPIs viraram links e filtram a
  tabela (`/estoque?situacao=sem_anuncio`). Clicar no KPI ja ativo desliga o
  filtro, senao o card viraria beco sem saida.
- **Equipe:** as pills de papel colidem com o texto da descricao ("Em
  treinamento" por cima de "sem acesso a custos"). Nao ha editar nem remover
  papel — tela de RBAC sem controle de RBAC.
- **Relatorios:** periodo fixo em "ultimos 3 meses", sem seletor, e sem margem ao
  longo do tempo — sendo margem o KPI de destaque da Visao geral.
- **Quebras de linha em numeros:** `R$ / 38.400` (Visao geral) ✅ corrigido em
  2026-08-11 — os KPIs usam `min-w-0` + `truncate`, entao o numero cabe ou
  corta, mas nunca dobra. Faltam `R$ / 5.820` (Calculadora) e
  `Publicar / alteracoes` (CMS), que sao as mesmas duas linhas de CSS.
- **Calculadora:** entrada crua (`3300`) e saida formatada (`R$ 7.553`) — sem
  separador de milhar enquanto digita. Padronizar a mascara.
- **Site publico:** a nav de categorias quebra em duas linhas com alinhamentos
  diferentes. E "WA" como sigla de WhatsApp (tela Pedidos) nao e obvia.


### Frete de saida: mecanica pronta, POLITICA por canal ainda em aberto
- **Arquivo(s):** `src/lib/pricing.ts`, `src/lib/db/schema/pedidos.ts`
- **Resolvido em 2026-08-10 (mecanica):** `pricing.ts` agora separa
  `freteEntrada` (trazer o lote do leilao) de `freteSaida` (enviar ao
  comprador), e os **dois** entram na base da RN-100 e sao subtraidos no
  `lanceMaximo`. O campo e **obrigatorio, sem valor padrao**: nenhuma tela
  consegue esquecer dele sem quebrar o build.
  `pedidos` ganhou `frete_saida numeric(14,2)` (migracao `0003`) para o valor
  **realizado** — o que o canal efetivamente descontou do repasse.
  Travado por 2 testes: um prova que o frete de saida pesa igual ao de entrada,
  outro que ignora-lo **infla o lance maximo** exatamente no valor do frete.
- **O que FALTA (⚠️ Anderson):** em qual canal a MM absorve o frete de saida e
  em qual repassa ao comprador. O codigo **nao chuta essa politica** de
  proposito — quem decide o valor e o chamador. Quando o Anderson responder,
  vira configuracao, nao mudanca de formula.
- **Consequencia de layout:** a Calculadora do prototipo tem UM campo "Frete
  estimado" e agora precisa de dois — ou de um, com a politica do canal ja
  aplicada. E mudanca de tela: decidir antes de portar a Calculadora.

### Custo e data da venda: congelados (RN-113) — falta o rateio lote -> item
- **Arquivo(s):** `src/lib/db/schema/pedidos.ts`
- **Resolvido em 2026-08-10:** `pedidos` ganhou `vendido_em` (quando a venda
  aconteceu **no canal**) e `custo_na_venda` (copia de `itens.custo` no momento
  da venda) — migracao `0004`, mais indice em `vendido_em`, que e por onde todo
  relatorio agrupa. `vendido_em` e **NOT NULL sem default**: `defaultNow()`
  reintroduziria o bug em silencio. Provado em banco real por
  `scripts/db/prova-congelamento-venda.sql` (5/5) — inclusive o caso de corrigir
  o custo do item **depois** da venda e a margem do mes fechado nao se mexer.
- **O que ainda FALTA:** `custo_na_venda` congela o que `itens.custo` continha.
  Nao existe regra de **rateio do custo do lote entre os itens** — se o rateio
  estiver incompleto ou errado, congela um numero errado. O congelamento resolve
  a **instabilidade** do numero, nao a **completude** dele.
- **Acao sugerida:** ⚠️ definir com o Anderson como o custo de um lote (que vem
  como valor unico do leilao, mais encargos) se distribui entre as pecas —
  por peso, por valor de mercado estimado, por igual? Isso decide o custo de
  cada item e, por consequencia, toda margem do sistema.

### Nada garante que taxa/comissao/liquido batem com o extrato do canal
- **Arquivo(s):** `src/lib/db/schema/pedidos.ts`, `src/lib/pricing.ts`
- **Situacao:** os valores do pedido sao calculados por nos, com a taxa que
  **supomos** (os 14% nao confirmados). O ML informa a taxa efetiva no proprio
  pedido, e nada compara os dois.
- **Acao sugerida:** gravar o valor informado pelo canal ao lado do nosso e
  sinalizar divergencia na tela de Pedidos.

### Cancelamento com NF-e emitida nao tem caminho de volta
- **Arquivo(s):** `src/lib/db/schema/pedidos.ts`
- **Situacao:** a RN-112 criou o status `cancelado` e ele libera o item para
  revenda. Mas cancelar depois da nota exige **nota de devolucao**, e a reversao
  da RN-104 (reanunciar, desfazer a baixa) nao existe. Tambem nao ha estado para
  NF-e **rejeitada**, e nada impede o despacho seguir sem nota.
- **Acao sugerida:** ⚠️ desenhar a reversao com o Anderson — ela **nao e
  simetrica** a venda. Depende do emissor fiscal (pendencia 🔴).

### O webhook do ML da ~meio segundo e nao manda os dados
- **Modulo:** Integracoes
- **Situacao:** processar a venda inteira dentro do request do webhook estoura o
  tempo, o ML considera falha e **reentrega** — e a reentrega e justamente o que
  estoura a cota da API.
- **Acao sugerida:** o handler so valida, grava o evento e responde 200. O
  processamento vai para fila. Idempotencia do INSERT **nao e** idempotencia do
  handler: duas entregas simultaneas ainda furam um check-then-act.

### Rate limit: o risco nao e a cota, e a fila urgente ficar atras da varredura
- **Modulo:** Integracoes
- **Situacao:** com ~50 itens e 2 usuarios o volume normal nunca encosta no
  limite do ML. O que estoura e **loop de reentrega** e varredura em massa. E o
  dano real do 429 nao e a chamada que falhou: e travar a **pergunta com SLA de
  4h** (RN-105) atras de uma varredura de fundo.
- **Acao sugerida:** separar lanes (urgente x varredura), respeitar
  `Retry-After`, backoff exponencial e teto de tentativas com DLQ. A lane urgente
  nunca espera a varredura.

### Evento fora de ordem faz o item voltar de "vendido"
- **Modulo:** Integracoes, Estoque
- **Situacao:** notificacoes nao chegam em ordem. Um evento antigo processado
  depois de um novo pode reverter o item para `anunciado`. O indice unico da
  RN-112 **nao pega isso** — ele protege contra dois pedidos, nao contra
  regressao de estado.
- **Acao sugerida:** marca d'agua por recurso (timestamp/versao do evento) e
  descartar o que for mais velho que o estado atual.

### O optimistic locking exigido pelo CLAUDE.md nao funciona no schema atual
- **Arquivo(s):** todas as tabelas; `CLAUDE.md` secao "Controle de Colisao"
- **Situacao:** o padrao compara `updated_at` no WHERE do UPDATE, mas nada
  **atualiza** `updated_at` automaticamente — nao ha trigger nem `$onUpdate`. Um
  UPDATE que esqueca de setar a coluna quebra a protecao em silencio.
- **Acao sugerida:** ⚠️ **Lucas** — trigger de `updated_at` ou coluna `versao`.
  Muda o `templates/schema.ts` e vale para **todos os projetos da casa**.

### O robo nao tem usuario para assinar: `modified_by` e NOT NULL com FK
- **Arquivo(s):** todos os schemas
- **Situacao:** toda escrita exige `modified_by` apontando para `usuarios.id`. O
  webhook e os jobs nao tem usuario — hoje **nenhuma escrita de integracao
  consegue gravar**.
- **Acao sugerida:** usuario-semente de sistema com uuid fixo, criado em
  migracao. Casa com a pendencia do `modified_by` de `usuarios`.

### Token do ML: nao ha onde guardar, e o refresh e de uso unico
- **Modulo:** Integracoes
- **Situacao:** nao existe tabela para credencial de canal. E o refresh token do
  ML e **de uso unico**: dois refreshes concorrentes invalidam a integracao, e
  so o Anderson consegue reautorizar.
- **Acao sugerida:** tabela de credenciais + **advisory lock** no refresh, para
  existir no maximo um refresh por vez.

### Nada detecta notificacao perdida
- **Modulo:** Integracoes
- **Situacao:** se uma notificacao de venda se perder, o sistema nao sabe. O
  item segue anunciado e a descoberta vem quando o **segundo comprador paga**.
- **Acao sugerida:** ⚠️ job de reconciliacao periodica contra a API do canal,
  comparando o que ele diz estar vendido com o nosso estado.

### O relogio do SLA nasce da NOSSA hora de gravacao
- **Arquivo(s):** `src/lib/db/schema/perguntas.ts` (`prazo_sla`)
- **Situacao:** o prazo e calculado quando gravamos a pergunta, nao quando o
  comprador **perguntou**. Atraso de fila ou reprocessamento empurra o prazo para
  frente e o SLA de 4h passa a mentir a favor da gente.
- **Acao sugerida:** guardar a data de origem informada pelo canal e derivar o
  prazo dela. E problema diferente do fuso (pendencia separada).

### O estado `reservado` existe e nada nunca entra nele
- **Arquivo(s):** `src/lib/db/schema/itens.ts` (`situacao_item`)
- **Situacao:** a janela entre "comprador iniciou a compra" e "pagamento
  aprovado" nao tem dono. No site publico e no WhatsApp a negociacao acontece
  fora do sistema.
- **Acao sugerida:** ⚠️ Anderson decide se existe reserva e por quanto tempo.
  **Parte honesta:** se a resposta for "nao reserva", **nenhuma arquitetura
  fecha essa janela** — o sistema so consegue detectar o conflito depois. Isso
  deve estar escrito na regra, nao disfarcado de lock.

### `auditoria.detalhes` e NOT NULL — e isso bloqueia o unico mecanismo que
### obrigaria a auditoria a acontecer
- **Arquivo(s):** `src/lib/db/schema/auditoria.ts`
- **Situacao:** confirmado no banco. Hoje a trilha depende de o dev lembrar de
  chamar o logger. O jeito de tornar obrigatorio seria trigger no banco — mas um
  trigger generico nao tem o que escrever num `detalhes` textual e NOT NULL.
- **Acao sugerida:** tornar `detalhes` nullable (o par `dados_anteriores`/
  `dados_novos` ja carrega o fato) ou aceitar que a trilha e responsabilidade da
  camada de action — e entao garantir por revisao, nao por esperanca.

### O job de SLA nao tem onde rodar nem como lembrar que ja alertou
- **Modulo:** Perguntas, Notificacoes
- **Situacao:** nao ha agendador, e `perguntas` nao tem coluna de "alerta
  enviado". Um job ingenuo alerta a mesma pergunta a cada execucao, para sempre.
  Duas instancias alertam em dobro.
- **Acao sugerida:** coluna de alerta enviado + lock para instancia unica.

### O deploy apaga as fotos, e o `pg_dump` nao as tem
- **Modulo:** Site/CMS, Infra
- **Situacao:** o deploy faz `git reset --hard` no diretorio da app. Foto salva
  em disco local morre no proximo deploy — e backup de banco nao cobre arquivo.
- **Por que importa:** foto e o que vende equipamento usado. Casa com a pendencia
  de storage ainda nao definido.
- **Acao sugerida:** storage externo (S3/MinIO) desde o primeiro upload, nunca
  disco da app.

### RN-107: o vazamento nao e a coluna `custo`, e o numero derivado dela
- **Modulo:** RBAC
- **Situacao:** esconder `itens.custo` do operador nao basta. Margem, lucro,
  lance maximo e "pode aceitar ate R$ X" **revelam o custo por aritmetica**. O
  vazamento tambem sai por export CSV, PDF, log, mensagem de erro e cache.
- **Acao sugerida:** tratar como classe de dado ("derivado de custo"), nao como
  lista de colunas. Casa com "Negociacao de preco" e com a matriz de RBAC.

### Item vendido: o link que o Google indexou e o QR impresso no galpao
- **Modulo:** Site publico, Expedicao
- **Situacao:** o site e indexavel; item vendido sai do ar e o link indexado vira
  404. O QR da etiqueta (RN-110) tambem aponta para a ficha de um item que pode
  ter mudado de estado.
- **Acao sugerida:** pagina de item vendido em vez de 404, oferecendo similares —
  e o lead que chegar pelo WhatsApp cai numa conversa util em vez de um vazio.

### Operador em treinamento: o que sai do sistema nao tem volta
- **Modulo:** RBAC, Perguntas, Anuncios
- **Situacao:** o contrato inclui 5 semanas treinando o operador. Resposta
  enviada ao comprador, anuncio publicado e etiqueta emitida **saem do sistema** —
  desfazer no painel nao desfaz no mundo.
- **Acao sugerida:** o modal block de 3s (RN-003) cobre o susto, nao o erro.
  Considerar revisao previa do Anderson nas semanas iniciais para o que e
  irreversivel.

### Fila: tabela no Postgres ou BullMQ/Redis?
- **Modulo:** Infra
- **Situacao:** o CLAUDE.md manda fila FIFO com BullMQ/Redis. Redis **nao esta
  instalado**, e para 2 usuarios uma fila em tabela Postgres da transacao junto
  com a escrita de negocio — o que resolve o outbox da RN-104 de graca.
- **Acao sugerida:** ⚠️ **Lucas** — abrir excecao ao padrao da casa e registrar
  em ADR, ou subir Redis. Decidir antes do primeiro worker.

---

## 🟢 Intencional (nao "corrigir" sem perguntar)

### A tela Lotes: negada por inteiro ao operador, e "giro lento" e chute meu
- **Arquivo(s):** `src/app/(painel)/lotes/`, `src/lib/actions/lotes.ts`
- **A rota e `/lotes`.** No prototipo, `state.screen === 'estoque'` E a tela
  Lotes. A inversao fica la.
- **PRIMEIRA tela negada por INTEIRO a um papel.** Diferente de Anuncios ou
  Estoque, onde o operador ve uma versao reduzida, um lote e custo de arremate
  do primeiro ao ultimo campo — sem os valores sobra o nome. Ele recebe uma
  pagina de **acesso negado explicita**: redirect silencioso pareceria link
  quebrado, e lista vazia seria mentira ("nenhum lote").
- **O item "Lotes" some do MENU dele.** Esconder e correto aqui, e nao
  desabilitar: link que ele nunca vai poder abrir e ruido permanente no menu
  que ele usa o dia inteiro. **A pagina continua barrando por conta propria** —
  menu escondido nunca e a unica protecao.
- **⚠️ "GIRO LENTO" E CRITERIO MEU, NAO REGRA DO CLIENTE.** O prototipo pinta
  ambar e nunca define o que e. Usei: passou de **90 dias** do arremate e o lote
  ainda nao recuperou o custo. Os 90 dias sao chute — um trimestre, defensavel
  para equipamento usado de ticket alto, e nada mais. A propria tela diz que o
  criterio e proposta. **Confirmar com o Anderson**; muda `LENTO_DIAS`.
- **A barra e "% do custo recuperado"** = `vendido / custo`, formula deduzida do
  proprio prototipo (as larguras 41% e 38% batem com os numeros dos cards).
  Passa de 100% quando o lote se pagou: a barra para em 100 e o texto ao lado
  mostra o numero real.
- **Verificado:** administrador ve os dois lotes com os valores certos
  (41% recuperado, "2 de 5 itens", giro lento de 120 dias); o operador recebe
  acesso negado, **nenhum valor no HTML** e nenhum link de Lotes no menu.

### A tela Visao geral: duas definicoes que eu escolhi, e ambas sao discutiveis
- **Arquivo(s):** `src/app/(painel)/page.tsx`, `src/lib/actions/visao-geral.ts`
- **A raiz `/` agora e a Visao geral.** O `src/app/page.tsx` placeholder (que
  listava os docs) foi removido.
- **⚠️ "Margem media" nao estava definida em lugar nenhum.** Escolhi a margem
  **realizada e ponderada pelo valor**: `sum(liquido - custo_na_venda) /
  sum(valor)` das vendas do mes. Alternativa descartada: media das margens dos
  anuncios ativos, que e hipotetica e muda quando alguem corrige um rateio de
  lote. Ponderada, e nao media simples, porque media simples daria o mesmo peso
  a uma venda de R$ 500 e a uma de R$ 50.000. **Se o Anderson entender outra
  coisa por "margem media", muda esta consulta.**
- **⚠️ "Tempo medio de resposta" e OTIMISTA e a tela avisa** ("conta da nossa
  gravacao"): mede de `created_at` ate `respondida_em`, e a RN-118 pede de
  `criada_em_canal`, que nao existe. Atraso de ingestao desaparece da conta.
- **"Perguntas recentes" mostra as mais URGENTES**, nao as mais recentes. Numa
  tela de resumo o que importa e o que esta prestes a estourar o SLA — os dois
  criterios so coincidem enquanto nada atrasa.
- **Para o operador a tela encolhe e DIZ isso.** Sobram os dois indicadores de
  perguntas; vendas, margem e lotes somem, e um texto explica que sao restritos
  (RN-107). Mostrar zeros seria mentira; silencio pareceria sistema quebrado.
  Comprovado: administrador recebe `R$ 7.553 / 38% / 4 / 3h 32min`; o operador
  recebe `4 / 3h 32min` e nenhum valor.

### A tela Pedidos: cards no topo, mes na URL e marca de "a conferir"
- **Arquivo(s):** `src/app/(painel)/pedidos/`, `src/lib/actions/pedidos.ts`
- **Os cards de resumo vem ANTES da tabela**, ao contrario do prototipo. Eram o
  achado da auditoria: ficavam abaixo da dobra, e sao o que o dono abre a tela
  para ver. Nao devolva para o rodape.
- **RN-107 tira MAIS aqui:** somem `Valor`, `Taxa` **e os quatro cards
  inteiros**. Um total e tao revelador quanto a linha — quem soma os pedidos do
  mes sabe o faturamento —, entao para o operador os totais **nem sao
  calculados**. Comprovado: administrador recebe `R$ 12.753 / −R$ 1.317 /
  −R$ 510 / R$ 10.926`; o operador nao recebe valor nenhum.
- **O marcador "•" de nao-conciliado tambem e so para quem ve dinheiro** — ele
  fala de VALORES nao conferidos, e para o operador seria ruido sobre um estado
  que ele nem consegue observar.
- **Pedido CANCELADO aparece na tabela e fica FORA dos totais.** Ele existiu,
  gerou taxa e talvez NF-e (por isso nao e exclusao logica), mas nao entrou
  dinheiro. Verificado: um pedido cancelado de R$ 9.000 aparece na lista e nao
  soma no faturamento.
- **Os totais sao somados no BANCO**, nao a partir da lista em memoria: se a
  lista ganhar paginacao um dia, um total que soma "so a pagina atual" seria um
  numero errado com cara de certo.
- **O intervalo do mes e SEMIABERTO** (`>= inicio AND < fim`), nao `BETWEEN`:
  com `<= ultimo dia`, venda as 23h30 do dia 31 ficaria de fora. Perder a venda
  do ultimo dia do mes e o jeito classico de o relatorio nao bater.
- **O seletor deixa navegar para meses FUTUROS** de proposito: e assim que se
  confere se algo caiu no mes errado — o bug que a RN-114 existe para evitar.
- **⚠️ A comissao de 4% incide sobre o BRUTO**, premissa nao confirmada
  (RN-108 🔴). A faixa ambar avisa quantos pedidos estao "a conferir" e diz por
  que. Quando o Anderson confirmar a base, muda `resultadoDaVenda` — nao a tela.
- **"WA" virou "Direta"** na coluna Canal: a auditoria registrou que a sigla nao
  e obvia, e aqui cabia o rotulo por extenso.

### A tela Estoque: rota `/estoque`, KPIs que filtram e DUAS colunas ocultas
- **Arquivo(s):** `src/app/(painel)/estoque/`, `src/lib/actions/estoque.ts`
- **A rota e `/estoque`, nao `/itens`.** No prototipo, `state.screen === 'itens'`
  E a tela Estoque e `'estoque'` e a tela Lotes. A inversao nao foi propagada
  para o codigo, como manda a invariante — nao "corrija" para bater com o state.
- **RN-107 tira DUAS colunas, nao uma:** `Custo` **e** `Preco alvo`. O preco alvo
  sai da formula da RN-100 a partir do custo, entao mostrar um entrega o outro
  por aritmetica. Comprovado: na mesma pagina, o administrador recebe os cinco
  custos e os quatro precos alvo; o operador **nao recebe nenhum dos nove**.
  Os campos nem entram na consulta quando o papel nao pode ve-los.
- **A variante do operador (5 colunas) e proposta minha**, nao do handoff —
  segue valendo o 🔴 "nenhuma tela do operador foi desenhada".
- **Os KPIs sao LINKS** e filtram a tabela; clicar no ja ativo desliga o filtro.
  Era o achado *"o sistema aponta o problema e nao deixa ir ate ele"*.
- **Os KPIs contam o estoque INTEIRO, nunca o filtro.** Se acompanhassem, clicar
  em "Sem anuncio · 12" faria o KPI virar 12 de 12 e o painel deixaria de dizer
  quanto do estoque tem problema.
- **Os chips de segmento saem do BANCO**, nao da lista fixa do handoff (mock).
- **A nota sobre "Reservados" so aparece quando o numero e ZERO** — e vai ser
  sempre, ate a RN-119 ser decidida. Sem ela, "Reservados 0" pareceria operacao
  tranquila em vez de recurso que ninguem implementou. Verificado nos dois
  estados.

### A tela Anuncios: `<table>` semantica, filtro na URL e margem so para quem pode
- **Arquivo(s):** `src/app/(painel)/anuncios/`, `src/lib/actions/anuncios.ts`,
  `margemDoAnuncio` em `src/lib/pricing.ts`
- **`<table>` de verdade, nao grid de `<span>`** — como a auditoria pediu. E o
  que conserta de uma vez a colisao de colunas (o nome do produto era pintado
  por cima da coluna seguinte abaixo de ~1100px) e a acessibilidade. Quem rola e
  o conteiner da tabela (`overflow-x-auto` + `min-w`), **nunca o corpo da
  pagina**. Nao volte para grid de span "para ficar igual ao prototipo".
- **Filtro na URL, nao em estado de cliente.** Vira link compartilhavel, resiste
  ao F5 e ao botao voltar, e dispensa JavaScript. Canal e status sao eixos
  INDEPENDENTES: clicar em "Pausados" preserva o canal escolhido. Valor invalido
  na query string e ignorado, nao vira erro — query string e coisa que as
  pessoas editam e colam.
- **RN-107 aplicada de verdade, e esta foi a PRIMEIRA tela em que ela morde.**
  Margem deriva de custo (quem tem preco e margem calcula o custo de cabeca),
  entao para o operador a margem **nao e calculada nem enviada** — a coluna
  some e o campo nem existe no payload. Comprovado: na mesma pagina, o
  administrador recebe `38%`, `33%`, `45%`, `-14%`; o operador nao recebe
  percentual nenhum, e o custo bruto nao aparece para nenhum dos dois.
- **A variante do operador e proposta minha**, nao do handoff — que so desenhou
  a visao do administrador (🔴 "nenhuma tela do operador foi desenhada").
  Tirei a coluna e recalculei o grid. Se o Anderson preferir outra coisa (ex.:
  "acima/abaixo da meta" sem o numero), muda so aqui.
- **`margemDoAnuncio` nasceu em `pricing.ts`**, como o proprio arquivo mandava —
  nunca no componente. Ha teste provando que ela e a INVERSA EXATA de
  `calcularPreco`: anunciar por P para ter margem M e, na volta, ler M em P. Se
  divergirem, o painel discorda de si mesmo.
- **⚠️ A margem esta OTIMISTA, e a tela diz isso.** A base do calculo deveria
  incluir frete, e o sistema nao guarda frete por item (lacuna 🔵 propria). A
  nota ambar do rodape avisa em vez de deixar o verde passar por exato — mesma
  postura do `frete_saida = 0` no handler de venda.

### A tela Integracoes DIVERGE do prototipo — pills reais e faixa de alerta
- **Arquivo(s):** `src/app/(painel)/integracoes/page.tsx`,
  `_components/alertas.tsx`, `src/lib/actions/integracoes.ts`
- **O que o prototipo tinha:** cinco cards com pill **"Conectado" fixa** e nenhum
  estado de erro. A auditoria de usabilidade registrou isso como o defeito
  principal desta tela: token OAuth expira, e quando o ML cai, quatro das doze
  telas envelhecem **em silencio** — o painel continua com cara de saudavel e o
  Anderson descobre pelo cliente.
- **O que ficou:** a pill sai do banco (`Conectado` / `Vence em breve` /
  `Reconectar` / `A configurar`), cada card mostra a conta e quando o acesso
  renova, e ha faixa de alerta quando existe algo a dizer. No fim, um bloco
  "Fila e conferencia" com notificacoes e acoes paradas.
  **Nao alinhe esta tela ao `screenshots/11-integracoes.png` nesses pontos.**
- **A regra que rege os alertas: "nunca executou" NAO e alarme.** Nada agenda a
  reconciliacao ainda; tratar `ultimo_sucesso_em` nulo como obsolescencia faria a
  tela nascer vermelha e ficar vermelha, e em uma semana ninguem mais olharia.
  Falta de setup e texto informativo; so o que **estava funcionando e parou**
  vira faixa. Mesma razao de a faixa sumir quando nao ha nada: ambar e alerta,
  nunca decoracao (design-system.md).
- **Os textos dizem a CONSEQUENCIA, nao o sintoma.** "O token venceu" nao move
  ninguem; "nada entra nem sai por este canal ate reconectar" move. Se for
  reescrever, mantenha isso.
- **Verificado (2026-08-11)** nos tres estados: banco vazio -> 5 "A configurar" e
  **zero** faixas; saudavel -> 2 conectados e **zero** faixas; quebrado -> pills
  corretas e **6** faixas especificas.
- **NUNCA expor token.** A consulta devolve so "ha credencial" e "vence em X".
  Se alguem precisar depurar credencial, e por `mascarar()` no servidor, nunca
  na tela.
- **Sem botoes de "reconectar" / "testar conexao"**, que a auditoria tambem
  pedia: qualquer botao aqui dispara acao privilegiada, e sem autenticacao (🔴) o
  segredo iria no HTML. Entram quando o login existir.

### `drizzle-kit migrate` em banco virgem — RESOLVIDO (era o enum `cancelado`)
- **Arquivo(s):** `src/lib/db/migrations/0000_far_loners.sql`,
  `0001_dashing_warpath.sql`
- **Causa (confirmada no fonte do drizzle, nao por hipotese):** o migrator
  envolve **todas** as migracoes pendentes numa **unica transacao**
  (`drizzle-orm/pg-core/dialect.js`, `session.transaction(...)` em volta do
  laco). Num banco incremental so ha uma pendente por vez, entao cada migracao
  cai no seu proprio `BEGIN` e tudo passa. Num banco **virgem** as 8 entram
  juntas — e a `0002` usava `status <> 'cancelado'`, valor que a `0001` tinha
  acabado de adicionar por `ALTER TYPE` na MESMA transacao. O Postgres recusa
  (`unsafe use of new value`), e o `drizzle-kit` saia com codigo 1 **sem
  imprimir o erro**.
- **Correcao:** `'cancelado'` passou a nascer no `CREATE TYPE` da `0000` (valor
  criado junto do tipo nao sofre a restricao — o tipo inteiro e novo na
  transacao), e a `0001` virou `ADD VALUE IF NOT EXISTS`, que e no-op nos dois
  caminhos. Os dois lados sao necessarios: a `0000` faz o banco virgem
  funcionar, a `0001` faz o banco que ficou no meio alcancar.
- **Verificado em 2026-08-10, nos dois caminhos:** banco virgem sobe do zero
  (exit 0, 10 tabelas, 8 migracoes, enum com os 4 valores, usuario de sistema
  semeado) e o banco local incremental nao re-executa nada
  (`drizzle-kit check` = "Everything's fine").
- **Licao que ficou em `back.md`:** dividir em duas migracoes resolve so o banco
  incremental. **O caminho virgem tem que ser testado a parte** — e o unico que
  HML e PRD vao percorrer. O `npm run db:migrate` num banco descartavel virou
  passo obrigatorio ao mexer em enum.

### O segredo do webhook viaja na URL, e a chave do evento e hash do corpo
- **Arquivo(s):** `src/app/api/integracoes/webhook/[canal]/route.ts`,
  `src/lib/integracoes/envelope.ts`
- **Segredo na query string (`?t=`):** e o unico mecanismo sob NOSSO controle —
  o Mercado Livre nao assina notificacao e nao deixa configurar cabecalho, so a
  URL de callback. **Custo assumido:** o segredo aparece no log de acesso do
  nginx e em qualquer proxy do caminho. Mitigacao: e rotacionavel (troca o
  `.env` e a URL no portal) e **nao e a unica defesa** — pela RN-117 o corpo do
  POST nunca e fonte de verdade, entao quem tiver o segredo ainda nao consegue
  forjar uma venda. Falta somar **allowlist de IP no nginx** em producao.
  Quando algum canal aceitar cabecalho, ler dali — e trocar o mecanismo, nao
  acrescentar um segundo "por garantia".
- **Chave do evento = SHA-256 do corpo cru**, e nao um campo do payload: usar um
  id do envelope exigiria saber qual campo identifica a NOTIFICACAO. Errar e
  pegar o id do RECURSO faria dois eventos diferentes do mesmo pedido
  (pagou → enviou) colidirem, e o segundo seria descartado como reentrega.
  Perder notificacao real e pior que gravar duplicata.
  **O que o hash NAO cobre:** reentrega em que o canal muda um campo (timestamp
  de envio, contador de tentativa) gera corpo diferente, logo linha nova. Por
  isso o processamento la na frente **tambem** precisa ser idempotente — a trava
  do banco cobre a entrega, nao o efeito.
- **`topico` e `recurso` sao melhor esforco.** Sao colunas informativas; nada de
  negocio depende delas. Se o envelope nao trouxer, ficam nulas — envelope
  desconhecido nao pode derrubar a gravacao.

### `npm run build` chama `scripts/build.mjs`, e nao `next build` direto
- **Arquivo(s):** `scripts/build.mjs`, `package.json` (script `build`)
- **Situacao:** o Windows ignora maiuscula no sistema de arquivos, mas os grafos
  de modulo do Node e do Turbopack sao indexados por **string** de caminho. A
  pasta real e `C:\Users\Paulo\Desktop`; um terminal que entrou por
  `cd desktop` roda o build inteiro com `...\desktop\...`, o mesmo arquivo ganha
  duas identidades, o modulo do `workAsyncStorage` carrega duas vezes e o store
  gravado por uma instancia some para a outra. O build morre assim:
  `Error [InvariantError]: Invariant: Expected workStore to be initialized.`
  em `/_global-error`, `/_not-found` e `/` — todas as paginas estaticas.
- **Por que custa caro achar:** a mensagem termina em "This is a bug in Next.js"
  e aponta paginas **internas do framework**, que ninguem escreveu aqui. Manda
  procurar no lugar errado (versao do Next, React, nosso codigo). **Nao e nada
  disso.** Comprovado por bisect em 2026-08-10: o MESMO diretorio compila por
  `C:\Users\Paulo\Desktop\...` e falha por `...\desktop\...`, alternando na
  mesma sessao. Acento no nome (`MMSOLUÇÕES`) e profundidade do caminho foram
  testados e **descartados**.
- **A correcao:** o script canoniza a raiz com `realpathSync.native` e roda o
  `next build` a partir dela. Em Linux (CI, VPS) o caminho ja e canonico e o
  script vira no-op. Canonizar so o `turbopack.root` no `next.config.ts`
  **nao resolve** — testado; quem contamina o grafo e o cwd do processo.
- **Nao troque de volta** por `"build": "next build"` achando que e indirecao
  desnecessaria: quebra de novo, e o erro nao aponta para ca.
- **Reconfirmado de forma independente** em 2026-08-10, rodando `next build`
  com os dois cwd no mesmo commit: canonico -> exit 0, sem erro; nao-canonico
  -> exit 1 com `InvariantError: Expected workStore to be initialized`.
  Nos dois casos o codigo COMPILA — a falha e so na pre-renderizacao, o que
  reforca a pista de que o problema e identidade de modulo, nao o codigo.
- **`npm run dev` nao precisa disso** — o dev server nao pre-renderiza, entao
  nao esbarra no invariante. Nao foi "esquecido".

### A tela Perguntas DIVERGE do prototipo nas cores do SLA — de proposito
- **Arquivo(s):** `src/lib/sla.ts` (regra) x
  `design_handoff_sistema_mm/Sistema MM Solucoes.dc.html` linhas 258/269/280
- **Situacao:** no prototipo, `3h 20min` sai **vermelho**, `2h` e `55min` saem
  **ambar** — a mais urgente mais calma que a menos urgente. Era o achado 🔴 da
  auditoria de usabilidade. A escala corrigida virou **RN-105.1** e foi
  implementada: fracao da meta restante (>50% neutro · 25–50% ambar · <25%
  vermelho · vencido vermelho invertido), lista ordenada por prazo.
- **Por que nao "consertamos" o prototipo:** invariante 6 — os `.dc.html` sao
  referencia congelada, nao codigo. A divergencia e a correcao, nao um erro de
  porte. **Nao alinhe a tela ao screenshot `04-perguntas.png` neste ponto.**
- **Onde mora:** `src/lib/sla.ts`, fonte unica, com testes em `sla.test.ts` —
  inclusive um que trava o retorno da inversao. Como em `pricing.ts`, nao
  reimplemente os limites dentro de componente.

### Os `.dc.html` nao sao codigo de producao
- **Arquivo(s):** `design_handoff_sistema_mm/*.dc.html`
- **Situacao:** referencia de design hi-fi, com CSS inline e script proprio.
  **Nao** lintar, **nao** refatorar, **nao** mover para `src/`, **nao** aplicar
  limite de 500 linhas. Conversao so via `/importar-tela`, que cria arquivos
  novos e deixa o prototipo intacto.

### Nomenclatura invertida no state do prototipo
- **Situacao:** `state.screen === 'itens'` e a tela **Estoque**;
  `state.screen === 'estoque'` e a tela **Lotes**. E assim no prototipo.
- **Acao:** nas rotas reais use os nomes corretos (`/estoque`, `/lotes`). Nao
  propague a inversao para o codigo, e nao "conserte" o prototipo.

### `design_handoff_sistema_mm/` esta na lista de ignorados do auditor
- **Arquivo(s):** `scripts/check-compliance.mjs` (`IGNORE_DIRS`)
- **Situacao:** `image-slot.js` (1226 linhas) e `support.js` (1769 linhas) sao
  scripts do prototipo e estouravam o limite de 500 linhas. A pasta foi
  adicionada ao `IGNORE_DIRS`, pelo mesmo motivo que `templates/` ja esta la:
  nao e codigo de producao. **Nao remova** para "auditar tudo".

### `npm audit` acusa 4 vulnerabilidades moderadas do `drizzle-kit`
- **Arquivo(s):** `package.json` (devDependencies)
- **Situacao:** o `drizzle-kit` 0.31 depende de `@esbuild-kit/*`, que carrega um
  `esbuild` antigo com aviso de dev-server (GHSA-67mh-4wv8-2f99). O
  `npm audit fix --force` "resolve" **rebaixando o drizzle-kit para 0.18.1**, o
  que quebra o projeto.
- **Por que nao corrigimos:** e **devDependency** — o `drizzle-kit` e CLI de
  migracao, nunca vai para o bundle de producao. A falha exige um atacante servir
  pagina para a maquina do dev com o esbuild dev-server rodando, o que nao
  acontece no nosso uso (so `generate`/`migrate`).
- **Acao sugerida:** revisar quando o drizzle-kit atualizar a arvore de
  dependencias. Nao rodar `audit fix --force`.

### `docs-check` acusa 15 refs quebradas — sao docs adiantados, nao erro
- **Arquivo(s):** `Agente.md`, `docs/front.md`, `docs/oauth.md`, `docs/rbac.md` (10)
  e o doc de analise de corretude (5)
- **Situacao:** os docs herdados da base citam os arquivos de RBAC, middleware e
  logger de auditoria como se existissem. Eles nao existem **ainda** — sao o que
  o projeto vai construir. Antes do scaffold o `docs-check` nem avaliava (nao
  havia `src/`), por isso o numero so apareceu agora.
  (Os caminhos nao sao repetidos aqui de proposito: citar um arquivo inexistente
  neste doc faria o proprio `docs-check` conta-lo de novo.)
  As 5 do doc de analise sao arquivos que ele **propoe criar** (action de venda,
  rota de webhook, cliente do ML, workflow de backup agendado) — proposta, nao
  afirmacao de que existem.
- **Acao:** nenhuma. O contador cai sozinho conforme as camadas forem criadas.
  Se ficar parado por muito tempo, e sinal de doc generico demais — ai vale
  `/repo-docs-sync`.

### O canal de venda direta se chama `whatsapp` no codigo inteiro
- **Arquivo(s):** `src/lib/pricing.ts`, `src/lib/db/schema/anuncios.ts`
- **Situacao:** o `pricing.ts` nasceu com `"direta"` e o enum do banco com
  `"whatsapp"` — mesmo canal, dois identificadores. Como nao havia de-para,
  `TAXA_CANAL[pedido.canal]` daria `undefined` e o preco viraria NaN. Unifiquei
  em **`whatsapp`** (o nome que o banco ja usava em 3 tabelas e que o handoff
  usa nas listas de canal).
- **Na tela o rotulo continua "Venda direta/WhatsApp"** (handoff README:68) —
  rotulo e texto de UI, nao identificador. Nao "corrija" o codigo por causa dele.

### `image-slot.js` e placeholder de prototipo
- **Situacao:** componente de espaco reservado de imagem, so para o handoff.
  Nao portar — em producao e upload real com compressao.

### O site publico nao tem carrinho
- **Situacao:** conversao e por WhatsApp, de proposito (RN-111). Esse comprador
  negocia antes de fechar. Nao implementar checkout ou gateway sem decisao de
  produto.

### Os dados do prototipo sao mock
- **Situacao:** diferente da UI (que e final), **os numeros nao sao reais** —
  R$ 38.400 de vendas, 28 itens disponiveis, os nomes de produto. Servem para
  mostrar o layout cheio. Nao os trate como valores de referencia nem como seed.

---

## ⚪ Notas

- **`"type": "module"` no `package.json`** (2026-08-10). Sem ele o Node reparsava
  cada `.test.ts` como ES module e cuspia `MODULE_TYPELESS_PACKAGE_JSON` a cada
  execucao. Foi seguro porque o projeto ja era 100% ESM na pratica: zero
  `require()` / `module.exports`, todos os scripts em `.mjs`, configs com
  `import`/`export default`. Ciclo completo revalidado depois — typecheck, 33
  testes, lint, build, `drizzle-kit check`, compliance e as 3 provas de banco.
- **O banco local esta NO AR e migrado.** Container `mmsolues-db-1` na porta 5436
  (o Docker sanitiza o nome da pasta: `MMSOLUÇÕES` -> `mmsolues`). Subir com
  `docker compose up -d`; recomecar do zero com `docker compose down -v`.
- **As provas de banco rodam com o banco cheio ou vazio** — usam identificadores
  aleatorios e fazem `ROLLBACK`. Rode as tres depois de toda migracao nova:
  `scripts/db/prova-constraints.sql` (12), `prova-compra-simultanea.sql` (5) e
  `prova-congelamento-venda.sql` (5).
- **Porta 5436** no `docker-compose.yml` — escolhida para nao colidir com
  espaco-flow (5433), orbital hub (5434) e bahflash (5435) na mesma maquina.
- **Dados da empresa para NF-e e rodape do site** (razao social, CNPJ, endereco,
  responsavel) estao no fim do README do handoff — nao redigitar de memoria.
- **O doc de arquitetura ainda nao existe.** Ja ha codigo (8 tabelas, rotas,
  modulos puros com teste), entao agora ele PODE ser escrito de verdade — vale
  gerar via `/repo-docs-sync`. Ate la, o que esta decidido esta em `CLAUDE.md`
  e o que falta decidir esta no bloco 🟡 acima.
- **Contexto contratual:** projeto da agencia Orbital para a MM Solucoes. Escopo
  contratado inclui treinamento do operador — a trilha de 5 semanas na tela
  Equipe faz parte da entrega, nao e enfeite.
