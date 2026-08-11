# Runbook de deploy — Sistema MM Solucoes (EasyPanel)

Passo a passo para colocar o painel no ar em **HML**. Escrito em 2026-08-11,
depois da auditoria de producao; reescrito no mesmo dia quando o modelo de
deploy passou a ser **EasyPanel** (era SSH + pm2, que nunca chegou a rodar).

> **Leia a secao "O que NAO funciona depois disto".** Este runbook coloca a
> aplicacao no ar; ele nao a torna utilizavel para operar. A diferenca importa e
> esta escrita no fim.

---

## 0. Antes de qualquer coisa: o codigo precisa estar no git

O EasyPanel constroi a partir do repositorio. **Ele so ve o que foi commitado
e empurrado.**

```bash
git status --porcelain --untracked-files=all   # tem que estar limpo
git log origin/develop..HEAD                   # e nada pendente de push
```

Em 2026-08-11 havia 52 arquivos fora do git — incluindo `src/lib/auth/`,
`src/proxy.ts` e a tela de login. Subir naquele estado colocaria **o painel sem
autenticacao na internet**.

---

## 1. Decisoes que precisam estar fechadas antes

| Decisao | Quem | Por que trava |
|---|---|---|
| Fuso: `timestamptz` ou cravar `America/Sao_Paulo` | Lucas | depois de aplicado em PRD com dados dentro, vira ALTER + reinterpretacao de cada linha |
| Onde o worker roda | Lucas | sem agendador a fila nunca drena |
| Base da comissao de 4% (bruto x liquido) | Anderson | `pedidos.comissao` e **gravada**; mudar depois exige backfill |

As duas primeiras tem contorno provisorio abaixo. A terceira nao: enquanto nao
vier, **nao abra a integracao de venda em PRD**.

---

## 2. Servicos no EasyPanel

Tres servicos no mesmo projeto, para se enxergarem pela rede interna.

### 2.1 PostgreSQL 16

Mesma versao do `docker-compose.yml` local. Depois de criado:

```sql
ALTER DATABASE mm_solucoes SET TimeZone = 'America/Sao_Paulo';
```

> Isto e a **outra metade** do `TZ` do Dockerfile. Enquanto as colunas forem
> `timestamp` sem fuso, o filtro montado em Node e o `date_trunc(..., now())`
> das consultas usam relogios diferentes se os dois nao baterem — e as telas
> Pedidos e Visao geral passam a discordar sobre o mes da mesma venda.

### 2.2 MinIO

Passo a passo em [architecture.md](architecture.md) §12. O bucket **nao** e
criado pela aplicacao. Leitura anonima (o ML publica a imagem baixando da URL, e
URL assinada expira — o anuncio ficaria com foto quebrada dias depois); escrita
exigindo chave.

### 2.3 A aplicacao

- **Fonte:** este repositorio, branch `develop` (HML) / `master` (PRD).
- **Build:** `Dockerfile` da raiz. Nao use Nixpacks — o Dockerfile existe
  porque duas variaveis precisam entrar em **tempo de build** (abaixo).
- **Replicas: 1.** ⚠️ **Nao aumente sem ler:** o portao de rate limit do Mercado
  Livre e memoria de processo — com duas replicas, cada uma aprende o 429 por
  conta propria e o dobro de chamadas continua batendo num canal que ja mandou
  parar. O limite de tentativas de login tambem e por processo. Subir replicas
  exige resolver os dois antes.
- **Porta:** 3000.
- **Healthcheck:** `GET /api/saude` (publica, sem segredo, faz `SELECT 1`).

---

## 3. Variaveis

### Build args (⚠️ nao bastam em runtime)

| Variavel | Por que e de build |
|---|---|
| `MINIO_PUBLIC_URL` | `next.config.ts` monta `images.remotePatterns` a partir dela na carga da config. Ausente, a funcao devolve `[]` **em silencio** e a imagem sai recusando toda foto com "hostname not configured" — sintoma que so aparece na tela do visitante. Mudar o dominio depois exige **rebuild**, nao basta reiniciar. |

### Ambiente (runtime)

```
DATABASE_URL=postgres://usuario:senha@postgres:5432/mm_solucoes
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://painel.seu-dominio.com.br
WEBHOOK_SECRET=<openssl rand -hex 32>
CREDENCIAIS_KEY=<openssl rand -hex 32>
MINIO_ENDPOINT=http://minio:9000
MINIO_PUBLIC_URL=https://fotos.seu-dominio.com.br
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=mm-fotos
MINIO_REGION=us-east-1
```

Tres armadilhas:

- **`BETTER_AUTH_URL` precisa ser a URL PUBLICA.** Sem ela a biblioteca deduz a
  origem do cabecalho, e atras do proxy do EasyPanel isso vira o host interno —
  a checagem de origem passa a recusar o login com "invalid origin".
- **`BETTER_AUTH_SECRET` assina cookie e token.** Trocar o valor invalida todas
  as sessoes abertas — e o botao de emergencia se algo vazar.
- **`CREDENCIAIS_KEY` nao entra no `pg_dump`.** Perde-la obriga reconectar cada
  canal do zero. Guarde fora do servidor.
- `OLX_DELETAR_AO_VENDER` fica **de fora** de proposito: sem ela, apagar anuncio
  na OLX ao vender nao acontece — o comportamento desejado ate o Anderson
  autorizar. So aceita o literal `true`.

---

## 4. Migrar o banco

O container **nao** migra sozinho ao subir, de proposito: migracao que roda no
boot transforma erro de schema em laco de reinicio, e o container fica
reiniciando sem ninguem entender por que.

Comando pontual no console do servico:

```bash
node scripts/migrar.mjs
```

Usa o migrador do proprio `drizzle-orm` (dependencia de runtime) e nao o
`drizzle-kit`, que e de desenvolvimento e nao entra na imagem. **Todas as
migracoes pendentes correm numa transacao so** — se a ultima falhar, o banco
fica exatamente onde estava, e o comando pode ser repetido com seguranca.

---

## 5. Criar o primeiro usuario

**No console web do EasyPanel** (que nao tem TTY), a senha vem por variavel:

```bash
MM_SENHA='uma-senha-de-12-ou-mais' node scripts/criar-usuario.mjs anderson@mmsolucoes.com.br "Anderson" administrador
MM_SENHA='outra-senha-de-12-ou-mais' node scripts/criar-usuario.mjs operador@mmsolucoes.com.br "Operador" operador
```

⚠️ **A senha aparece na tela** — limpe o console depois. Nao ha alternativa num
terminal sem TTY: o script chegou a tentar ler `stdin` la e **travava sem
escrever uma palavra**, que e pior que aparecer.

**Num terminal de verdade** (`ssh` na VPS, ou `docker exec -it <container> sh`)
omita `MM_SENHA` — a senha e pedida oculta, com confirmacao:

```bash
node scripts/criar-usuario.mjs anderson@mmsolucoes.com.br "Anderson" administrador
```

Use o e-mail **completo e real**: `anderson@...` com reticencias e recusado de
proposito, porque ja foi colado literalmente uma vez.

Sem nome e papel, o mesmo comando so **troca a senha** de quem ja existe — e
encerra todas as sessoes abertas daquela pessoa, na mesma transacao.

> Este script e o **unico** caminho de cadastro: `disableSignUp: true` fecha a
> rota publica de registro do Better Auth. Se ela ficasse aberta, qualquer um
> criaria conta (papel `operador`, `ativo` true) e entraria no painel.
>
> `papel` errado aqui fura a RN-107 em silencio — o operador passa a ver custo.

---

## 6. Agendar o worker ⚠️

Sem isto **a fila nunca drena**: a venda chega do ML, entra em
`integracoes_eventos` e fica la para sempre — o pedido nao e registrado, o item
nao baixa do estoque e o anuncio da OLX continua no ar. Toda a RN-104 deixa de
acontecer, com o codigo dela pronto e testado.

Enquanto o ADR do Lucas nao fecha, um cron do EasyPanel destrava:

```
* * * * *    curl -fsS -X POST "http://mm-solucoes:3000/api/integracoes/worker?t=$WEBHOOK_SECRET"
*/15 * * * * curl -fsS -X POST "http://mm-solucoes:3000/api/integracoes/reconciliar?t=$WEBHOOK_SECRET"
```

Pela rede interna, para o segredo nao atravessar a internet numa query string.

---

## 7. Conferir que subiu

O EasyPanel dizer "deployed" nao e o mesmo que a aplicacao funcionar.

```bash
curl -fsS https://painel.seu-dominio.com.br/api/saude    # {"ok":true}
```

`{"ok":false}` com 503 significa app de pe e **banco inalcancavel** — foi
verificado parando o Postgres de proposito.

Depois, um login real pelo navegador. O fluxo esta coberto por teste automatico
de ponta a ponta, mas ninguem nunca viu a tela renderizada em largura nenhuma.

---

## O que NAO funciona depois disto

Ser honesto aqui evita a conversa ruim na entrega.

**O painel nao escreve nada.** Das 7 telas no ar, todas sao leitura. A unica
acao de escrita e o login. Nao ha como cadastrar lote, item, custo de arremate
ou anuncio — e nenhum codigo cria essas entidades. As telas sobem **vazias e
permanecem vazias**, a menos que alguem faca INSERT a mao.

**5 das 12 telas nao existem:** Site/CMS, Expedicao, Calculadora, Relatorios e
Equipe. O site publico contratado nao tem uma linha.

**Responder pergunta nao existe.** Os botoes sao inertes por construcao, e o SLA
de 4h so acende cor para quem estiver com a aba aberta — nao ha job de alerta.

**Sem credencial de ML/OLX** as integracoes nao saem do lugar; conectar o ML so
e possivel digitando a URL do OAuth a mao, com o segredo na query string.

**A sidebar afirma que os canais estao conectados.** "Mercado Livre · ativo" e
"OLX · ativo" sao texto cravado, em verde, em todas as telas — enquanto
`/integracoes` diz corretamente que o app nao foi autorizado.

**Antes de PRD, alem de tudo acima:**
- `/api/fotos` (4 handlers) grava no storage sem conferir sessao. Mitigacao de
  borda enquanto nao se corrige: **Basic Auth do EasyPanel** no dominio do
  painel.
- `/oauth/.../iniciar` protegida so pelo segredo na URL: quem ler um log de
  acesso substitui a conta do ML do cliente pela propria.
- **Backup nao existe.** O `pg_dump` do modelo antigo saiu junto com o deploy
  por SSH e ainda nao foi refeito para o Postgres do EasyPanel. E a regra de DR
  exige mais que dump: **restore testado**. Backup nunca restaurado nao e
  backup. Obrigatorio antes de PRD, dispensavel em HML (que nao tem dado real).
- **Sem rollback.** As migracoes sao so de ida; voltar exige restaurar o dump
  que ainda nao existe.
