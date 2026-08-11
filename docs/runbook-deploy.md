# Runbook de deploy — Sistema MM Solucoes

Passo a passo para colocar o painel no ar em **HML**. Escrito em 2026-08-11,
depois da auditoria de producao.

> **Leia primeiro a secao "O que NAO funciona depois disto".** Este runbook
> coloca a aplicacao no ar; ele nao a torna utilizavel para operar. A diferenca
> importa e esta escrita no fim.

---

## 0. Antes de qualquer coisa: o codigo precisa estar no git

O deploy faz `git reset --hard origin/develop` (`.github/workflows/deploy.yml`).
**Ele so materializa o que esta commitado.** Em 2026-08-11 havia 52 arquivos
fora do git — incluindo `src/lib/auth/`, `src/proxy.ts`, a tela de login e as
migracoes `0009`/`0010`.

Subir naquele estado colocaria **o painel sem autenticacao na internet**, com o
banco parando na migracao `0008`.

```bash
git status --porcelain --untracked-files=all   # tem que estar limpo
git log origin/develop..HEAD                   # e nada pendente de push
```

Confira em especial que `src/lib/db/migrations/meta/_journal.json` (arquivo
**modificado**, nao novo) vai no mesmo commit que os `.sql` que ele indexa. O
journal sem os arquivos = `db:migrate` quebrado.

---

## 1. Decisoes que precisam estar fechadas antes

| Decisao | Quem | Por que trava |
|---|---|---|
| Topologia (1 VPS por ambiente x 4 VPS) | Lucas | define os secrets e o `.env` |
| Fuso: `timestamptz` ou cravar `America/Sao_Paulo` | Lucas | depois de aplicado em PRD com dados dentro, vira ALTER + reinterpretacao de cada linha |
| Onde o worker roda (Postgres x Redis) | Lucas | sem agendador a fila nunca drena |
| Base da comissao de 4% (bruto x liquido) | Anderson | `pedidos.comissao` e **gravada**; mudar depois exige backfill |

As tres primeiras podem ser destravadas provisoriamente (ver passos 5 e 7). A
quarta nao: enquanto nao vier, **nao abra a integracao de venda em PRD**.

---

## 2. Provisionar a VPS

```bash
# Node — o CI usa 24; o package.json exige >= 22.6 (node --test com type stripping)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo npm install -g pm2
pm2 install pm2-logrotate          # sem isto o log cresce sem teto ate encher o disco
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14

pm2 startup                        # e rodar o comando que ele imprimir
```

PostgreSQL 16 — mesma versao do `docker-compose.yml` local. Fuso da instancia:

```sql
ALTER DATABASE mm_solucoes SET TimeZone = 'America/Sao_Paulo';
```

> Isto e a **outra metade** do `TZ` do `ecosystem.config.js`. Enquanto as colunas
> forem `timestamp` sem fuso, o filtro montado em Node e o `date_trunc(...,
> now())` das consultas usam relogios diferentes se os dois nao baterem — e as
> telas Pedidos e Visao geral passam a discordar sobre o mes da mesma venda.

A VPS tambem precisa de `git` com credencial de **leitura** do repositorio (o
deploy roda `git fetch` la dentro; nada no workflow provisiona isso).

---

## 3. Secrets no GitHub

`Settings > Environments`, ambientes `hml` e `prd` (os jobs ja declaram
`environment:`, so falta popular).

**HML:** `HML_SSH_HOST`, `HML_SSH_USER`, `HML_SSH_KEY`, `HML_KNOWN_HOSTS`,
`HML_APP_DIR`.

**PRD** (mais tarde): os cinco equivalentes, `PRD_DATABASE_URL` e
`PRD_BACKUP_DEST`.

> Secret ausente no Actions vira **string vazia, nao erro**. O passo vira
> `ssh -i ... @` ou `cd ''` — que sucede e fica no home do usuario. Confira
> valor por valor.

---

## 4. `.env` na VPS

O deploy roda `npm run build` e `npm run db:migrate` **dentro** da VPS e nao
escreve variavel nenhuma la. O arquivo e criado a mao, uma vez:

```bash
cd "$APP_DIR"
cat > .env <<'FIM'
DATABASE_URL=postgres://usuario:senha@localhost:5432/mm_solucoes
WEBHOOK_SECRET=<openssl rand -hex 32>
CREDENCIAIS_KEY=<openssl rand -hex 32>
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://painel.seu-dominio.com.br
MINIO_ENDPOINT=http://minio:9000
MINIO_PUBLIC_URL=https://fotos.seu-dominio.com.br
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=mm-fotos
MINIO_REGION=us-east-1
FIM
chmod 600 .env
```

Quatro armadilhas:

- **`BETTER_AUTH_SECRET` assina cookie e token de sessao.** Trocar o valor
  invalida todas as sessoes abertas — que e o botao de emergencia se algo
  vazar. **`BETTER_AUTH_URL` precisa ser a URL PUBLICA**: sem ela a biblioteca
  deduz a origem do cabecalho, e atras de proxy reverso isso vira o host
  interno — a checagem de origem passa a recusar o login com "invalid origin".

- **`MINIO_PUBLIC_URL` e lida no BUILD** (`next.config.ts` monta
  `images.remotePatterns` a partir dela). Ausente, a funcao devolve `[]` **em
  silencio** e a app recusa toda foto com "hostname not configured". Precisa
  existir **antes** do primeiro build, e trocar o dominio depois exige rebuild.
- **`CREDENCIAIS_KEY` nao tem default** — o cofre falha fechado sem ela. E ela
  **nao entra no `pg_dump`**: perder a chave obriga reconectar cada canal do
  zero. Guarde fora da VPS.
- `OLX_DELETAR_AO_VENDER` fica **de fora** de proposito. Sem ela, apagar anuncio
  na OLX ao vender nao acontece — que e o comportamento desejado ate o Anderson
  autorizar. So aceita o literal `true`.

---

## 5. Primeiro deploy

```bash
git push origin develop        # dispara CI -> Deploy HML
```

O CI roda lint, typecheck, 151 testes e build. **O passo Build precisa do bloco
`env: DATABASE_URL`** que foi adicionado em 2026-08-11 — sem ele o job falha
sempre e, com `needs: ci`, nenhum deploy chega a rodar.

Depois do deploy, confira **na mao** (o pipeline nao confere):

```bash
pm2 describe mm-solucoes       # status online, restarts baixo
curl -fsS http://127.0.0.1:3000/login | head -c 200
```

---

## 6. Criar o primeiro usuario

**No terminal da VPS.** A senha e pedida oculta e nunca vira argumento de linha
de comando (argumento fica no `history`, no `ps` e no log):

```bash
node scripts/criar-usuario.mjs anderson@mmsolucoes.com.br "Anderson" administrador
node scripts/criar-usuario.mjs operador@mmsolucoes.com.br "Operador" operador
```

Sem nome e papel, o mesmo comando so **troca a senha** de quem ja existe:

```bash
node scripts/criar-usuario.mjs anderson@mmsolucoes.com.br
```

Trocar a senha **encerra todas as sessoes abertas** daquela pessoa, na mesma
transacao — que e o comportamento certo quando a troca acontece por suspeita de
acesso indevido.

> Este script e o **unico** caminho de cadastro: `disableSignUp: true` fecha a
> rota publica de registro do Better Auth. Se ela ficasse aberta, qualquer um
> criaria conta (papel `operador`, `ativo` true) e entraria no painel.
>
> `papel` errado aqui fura a RN-107 em silencio — o operador passa a ver custo.

---

## 7. Agendar o worker ⚠️

Sem isto **a fila nunca drena**: a venda chega do ML, entra em
`integracoes_eventos` e fica la para sempre — o pedido nao e registrado, o item
nao baixa do estoque e o anuncio da OLX continua no ar. Toda a RN-104 deixa de
acontecer, com o codigo dela pronto e testado.

Enquanto o ADR do Lucas nao fecha, um cron destrava:

```cron
* * * * * curl -fsS -X POST "http://127.0.0.1:3000/api/integracoes/worker?t=$WEBHOOK_SECRET" >/dev/null
*/15 * * * * curl -fsS -X POST "http://127.0.0.1:3000/api/integracoes/reconciliar?t=$WEBHOOK_SECRET" >/dev/null
```

A rota foi desenhada exatamente para nao pre-decidir onde o worker roda.

---

## 8. Bucket do MinIO

Nao e criado pela aplicacao. Passo a passo em
[architecture.md](architecture.md) §12 — bucket com **leitura anonima** (o ML
publica a imagem baixando da URL, e URL assinada expira; o anuncio ficaria com
foto quebrada dias depois) e **escrita exigindo chave**.

---

## O que NAO funciona depois disto

Ser honesto aqui evita a conversa ruim na entrega.

**O painel nao escreve nada.** Das 7 telas no ar, todas sao leitura. A unica
action de escrita do sistema e login/logout. Nao ha como cadastrar lote, item,
custo de arremate ou anuncio — e nenhum codigo cria essas entidades. Em HML as
telas sobem **vazias e permanecem vazias**, a menos que alguem faca INSERT a mao.

**5 das 12 telas nao existem:** Site/CMS, Expedicao, Calculadora, Relatorios e
Equipe. O site publico contratado nao tem uma linha.

**Responder pergunta nao existe.** Os botoes sao inertes por construcao, e o SLA
de 4h so acende cor para quem estiver com a aba aberta — nao ha job de alerta.

**Sem credencial de ML/OLX** as integracoes nao saem do lugar; e conectar o ML
so e possivel digitando a URL do OAuth a mao com o segredo na query string.

**Sem healthcheck e sem rollback.** O pipeline termina no `pm2` e ninguem
confere se a app responde: app que sobe e morre em 2 segundos da deploy verde. E
as migracoes sao so de ida — voltar exige restaurar o dump, que **nunca foi
restaurado nem uma vez**. Backup nao testado nao e backup.

**Antes de PRD, alem de tudo acima:** `/api/fotos` (4 handlers) grava no storage
sem conferir sessao, e a rota `/oauth/.../iniciar` protegida so pelo segredo na
URL permite a quem ler um log substituir a conta do ML do cliente pela propria.
