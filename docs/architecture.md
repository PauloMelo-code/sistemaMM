# Arquitetura — Sistema MM Solucoes

Como o projeto esta montado **hoje**, lido do codigo em 2026-08-10.

> Este doc descreve o que EXISTE. O que ainda nao foi decidido esta em
> [known-issues.md](known-issues.md); o que o produto deve fazer esta em
> [regras-negocio.md](regras-negocio.md). Se algo aqui divergir do codigo, o
> codigo esta certo e este arquivo esta velho — corrija-o.

---

## 1. O que e

Painel de gestao de marketplaces para a MM Solucoes Empresariais (Maringa/PR),
que revende em Mercado Livre, OLX e WhatsApp produtos arrematados em leilao.
Projeto da agencia Orbital.

Duas caracteristicas do negocio explicam quase toda decisao tecnica daqui:

1. **Cada item e peca unica.** Nao ha quantidade nem reposicao, e o mesmo item
   fica anunciado em varios canais ao mesmo tempo. Vender duas vezes e o pior
   defeito possivel — dai a trava do banco na RN-112.
2. **Ticket alto e giro lento.** Equipamento hospitalar, encadernacao, baterias.
   Erro de centavo nao aparece; erro de frete come 30% do lucro de uma venda.

Sao **dois produtos** na mesma base: o painel (12 telas, 2 usuarios) e o site
publico de e-commerce. O site ainda nao foi construido.

---

## 2. Stack

| Camada | Escolha | Nota |
|---|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack) | `src/`, TS strict |
| UI | React 19.2 + Tailwind **v4 CSS-first** | tokens no `@theme`, **nao ha** `tailwind.config.js` |
| ORM | Drizzle 0.45 + `pg` 8.23 | `drizzle-kit` so como CLI |
| Banco | PostgreSQL 16 (Docker, porta **5436**) | container `mmsolues-db-1` |
| Validacao | Zod 4 | biblioteca de formulario ainda **nao escolhida** |
| Testes | `node:test` nativo | sem framework, sem dependencia |

O modulo e **ESM** (`"type": "module"`). Nao ha `require()` em lugar nenhum.

### Variaveis de ambiente lidas pelo codigo

Sao **tres**, e so tres: `DATABASE_URL`, `WEBHOOK_SECRET` e `NODE_ENV`.
Template em `.env.example`.

### Fluxo de build

`npm run build` chama `scripts/build.mjs`, **nao** `next build` direto. Nao e
indirecao gratuita: o script canoniza o `cwd` com `realpathSync.native` porque
uma grafia nao-canonica do caminho no Windows quebra a pre-renderizacao com
`InvariantError`. Comprovado por bisect duas vezes. Ver known-issues 🟢 — **nao
troque de volta.**

---

## 3. Arquivos fonte-da-verdade

Quando dois lugares discordam, estes mandam:

| Assunto | Fonte | Nunca duplique em |
|---|---|---|
| Preco, taxa, comissao, margem, lance maximo | `src/lib/pricing.ts` | componente, action, query |
| Urgencia e texto de prazo (SLA) | `src/lib/sla.ts` | componente |
| Identidade de evento de webhook | `src/lib/integracoes/envelope.ts` | route handler |
| Tokens visuais | `@theme` de `src/app/globals.css` | classe com hex cru |
| Schema do banco | `src/lib/db/schema/*.ts` | SQL solto |
| Regra de negocio | `docs/regras-negocio.md` | comentario de codigo |

Os tres primeiros sao **modulos puros**: nao importam banco, React nem env.
E por isso que tem teste.

---

## 4. Modelo de dados

8 tabelas, 6 migracoes aplicadas. Toda tabela carrega as 5 colunas de auditoria
(`created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by`), todas
as FK sao `ON DELETE RESTRICT` e todo dinheiro e `numeric(14,2)`.

```
lotes ──< itens ──< anuncios
                 ├─< perguntas
                 └─< pedidos

usuarios ──< (modified_by de todas)  auditoria   integracoes_eventos
```

| Tabela | Papel |
|---|---|
| `usuarios` | 3 papeis: `administrador`, `operador`, `consultoria` |
| `lotes` | o arremate: custo total e data |
| `itens` | a peca unica. `custo` e dado sensivel (RN-107) |
| `anuncios` | um item por canal. `id_externo` = id no marketplace |
| `perguntas` | caixa unificada ML/OLX/WhatsApp, com `prazo_sla` |
| `pedidos` | a venda realizada — ver §5 |
| `auditoria` | trilha append-only. **Unica excecao** as colunas de auditoria |
| `integracoes_eventos` | inbox cru de webhook, antes de qualquer interpretacao |

### As constraints que sustentam regra de negocio

Nao sao detalhe de implementacao — cada uma impede um dano concreto:

| Indice | Impede |
|---|---|
| `idx_pedidos_item_ativo` UNIQUE parcial | **vender a mesma peca duas vezes** (RN-112) |
| `idx_pedidos_canal_numero` UNIQUE global | webhook duplicar a mesma venda |
| `idx_anuncios_item_canal_ativo` | 2o anuncio ativo do mesmo item no mesmo canal |
| `idx_perguntas_id_externo` / `idx_anuncios_id_externo` | reentrega duplicar registro |
| `idx_usuarios_email_ativo` sobre `lower(email)` | duas contas da mesma pessoa |
| `idx_itens_sku_ativo` | SKU repetido entre itens ativos |

Os unicos sao **parciais** (`WHERE is_deleted = false`) porque unique global e
incompativel com soft delete: prenderia o valor para sempre apos a exclusao.
As excecoes deliberadas sao `pedidos(canal, numero)` e
`integracoes_eventos(canal, chave_evento)`, que sao **globais** — nem o numero do
marketplace nem a chave de idempotencia podem ser reaproveitados apos exclusao.

Esse comportamento tem **prova executavel**: `scripts/db/*.sql` exercitam as
constraints em transacao e fazem `ROLLBACK` (12 + 5 + 5 casos). Rode as tres
depois de toda migracao.

### Migracoes

`generate` + `migrate`, nunca `push` (invariante #9). Duas armadilhas ja
documentadas em [back.md](back.md): valor novo de enum exige migracao separada
do seu primeiro uso, e migracao ainda nao aplicada pode ser descartada.

---

## 5. Dinheiro

A formula unica (RN-100) vive em `pricing.ts`:

```
base  = custo + freteEntrada + freteSaida
d     = 1 - taxa_canal - COMISSAO - margem
preco = base / d        (so se d > 0.05; senao a UI mostra "—")
lucro = preco * margem
```

Tres pontos que costumam ser "corrigidos" errado:

- **`lucro = preco * margem` esta certo** (RN-101). A identidade sai da propria
  formula; descontar custo e taxas de novo duplica o desconto.
- **Sao dois fretes.** Entrada (trazer o lote) e saida (enviar ao comprador,
  quando a MM paga). Os dois entram na base. `freteSaida` e **entrada
  obrigatoria sem default**, para nenhuma tela esquecer dele.
- **A leitura inversa e o uso mais valioso:** dado o preco de mercado, qual o
  **lance maximo no leilao**. Ignorar o frete de saida infla esse lance.

O modulo nunca devolve `NaN`: entrada invalida vira uma uniao discriminada
`{ disponivel: false, preco: null }`, e a UI formata como "—".

### O pedido congela o passado (RN-113)

`pedidos` guarda `custo_na_venda` e `vendido_em`. Sem isso, corrigir o custo de
um item hoje reescreveria a margem de um mes ja fechado, e o mes fecharia pela
data da digitacao. `vendido_em` e NOT NULL **sem default** — `defaultNow()`
reintroduziria o bug com nome enganoso.

Toda margem historica le `custo_na_venda`; `itens.custo` serve para precificar o
que ainda esta a venda. Todo agrupamento por periodo usa `vendido_em`, nunca
`created_at`.

---

## 6. Integracoes

Existem hoje **duas** rotas: `POST /api/integracoes/webhook/[canal]` (recebe) e
`POST /api/integracoes/worker` (drena a fila, ver §11).

O desenho central e que **o corpo do POST nao e fonte de verdade**. A URL e
publica; qualquer um pode postar "vendi o item X". O handler faz tres coisas e
para: valida a origem, grava uma linha em `integracoes_eventos` e responde 200.

- **Autenticidade** por segredo na query string (`?t=...`), comparado em tempo
  constante. E o unico canal sob nosso controle: o ML nao assina notificacao nem
  aceita cabecalho customizado. Custo assumido e mitigacao estao no comentario da
  rota. Sem `WEBHOOK_SECRET` configurado o endpoint **falha fechado** (503).
- **Segredo invalido responde 404**, nao 401: para quem varre a internet, a rota
  nao existe.
- **Idempotencia** por SHA-256 do corpo cru + `ON CONFLICT DO NOTHING`. Reentrega
  responde 200 e nada mais executa — devolver erro provocaria nova reentrega.
- **500 e a unica excecao ao "sempre 200"**: se nao conseguimos gravar, o canal
  reentregar e o comportamento desejado. Perder venda, nao.

O processamento real (buscar o dado na API do canal, dar baixa no estoque,
pausar os outros anuncios) **ainda nao existe** — depende das credenciais do ML,
que sao pendencia 🔴.

### A identidade do robo

Webhook e worker nao tem usuario logado, mas `modified_by` e NOT NULL com FK.
Por isso existe um usuario de sistema com UUID fixo
(`00000000-...-0001`, criado na migracao `0004`, exportado por
`src/lib/integracoes/usuario-sistema.ts`). Mantem a coluna obrigatoria e ainda
deixa a trilha mais legivel: da para separar o que o robo fez do que a pessoa fez.

---

## 7. Frontend

App Router com route group `(painel)`. Uma tela construida: **Perguntas**.

```
src/app/
  layout.tsx              raiz: fontes Archivo/Jost via next/font
  page.tsx
  globals.css             tokens no @theme (ver Visual, abaixo)
  icon.png                favicon; o build serve como rota /icon.png
  (painel)/
    layout.tsx            sidebar + badge de pendentes
    _components/sidebar.tsx
    perguntas/
      page.tsx            server component: busca e passa props
      loading.tsx         skeleton com a geometria do componente final
      error.tsx
      _components/lista-perguntas.tsx
  api/integracoes/webhook/[canal]/route.ts
  api/integracoes/worker/route.ts
```

Padrao: `page.tsx` e **server component** e busca os dados; o client component
recebe props e cuida so do que e interativo. Colocation em `_components/` para o
que serve a uma rota so.

A ordenacao da fila de perguntas mora **no SQL**, nao no cliente: ordenar no
navegador exigiria trazer a lista inteira e reimplementar o criterio de SLA — a
duplicacao que a RN-105.1 proibe. A tela avisa quando a fila vem truncada, porque
fila cortada em silencio parece fila vazia e o operador para de atender.

### Visual

Tokens no `@theme` de `globals.css`, espelhados em
[design-system.md](design-system.md). Tema **claro unico** — nao existe `dark:`.
Zero hex cru em `src/`. Ambar e sempre alerta, nunca decoracao.

---

## 8. Testes e verificacao

Duas redes, com alcances diferentes:

| O que | Cobre | Nao cobre |
|---|---|---|
| `npm test` (40, `node:test`) | modulos **puros**: `pricing`, `sla`, `envelope`, `retentativa`/`handlers` | schema, queries, actions, telas |
| `scripts/db/*.sql` (12+5+5) | comportamento real das constraints | logica de aplicacao |

**Restricao que quebra teste de forma confusa:** o `node --test` usa
type-stripping nativo, entao o alias `@/` **nao resolve** e importar `db` cria um
Pool e exige `DATABASE_URL` so para carregar o modulo. Por isso a logica pura
mora separada do acesso a banco (`envelope.ts` x `eventos.ts`). Detalhes em
[back.md](back.md).

Pipeline: `lint` → `typecheck` → `test` → `build`.

---

## 9. Invariantes criticas

Repetidas aqui porque sao o resumo executavel do que nao pode quebrar. A lista
completa esta no [CLAUDE.md](../CLAUDE.md).

1. Calculo de dinheiro so em `pricing.ts`. Escala de SLA so em `sla.ts`.
2. Nunca `drizzle-kit push`. So `generate` + `migrate`.
3. Delete e sempre logico. Cancelamento de pedido usa `status = 'cancelado'`,
   **nao** `is_deleted` — o pedido existiu e continua no relatorio.
4. Chamada externa **nunca** dentro de transacao de banco: segura lock e
   envenena o pool.
5. O corpo do webhook nao e fonte de verdade.
6. Operador nao ve custo — filtrado no **servidor**, nunca escondido na tela.
7. Zero hex cru em `src/`.
8. Os `.dc.html` do handoff sao referencia de design, nao codigo.

---

## 10. Anti-padroes (ja tentados, nao repita)

- **Reimplementar a formula de preco ou a escala de SLA num componente.** Foi
  assim que o prototipo pintou a pergunta de 55min mais calma que a de 3h20.
- **Confiar em `check-then-act` para peca unica.** Sempre ha janela entre o
  `SELECT` e o `INSERT`; quem garante e a constraint.
- **`ON CONFLICT (a, b)` num indice PARCIAL sem repetir o `WHERE`.** Nao infere o
  indice e estoura `42P10`.
- **`defaultNow()` numa coluna que representa quando algo aconteceu no mundo.**
  Vira a hora da digitacao com nome enganoso.
- **Canonizar so o `turbopack.root`** para resolver o build no Windows. Testado;
  quem contamina o grafo e o `cwd` do processo.
- **Trocar `@/` por relativo** achando que resolve teste que importa `db`. Muda a
  mensagem de erro, nao o problema.

---

## 11. O que NAO existe ainda

Para nao procurar o que nunca foi escrito:

- **Autenticacao e sessao.** Nao ha `src/lib/auth/`. A RN-107 depende disso.
- **11 das 12 telas** do painel, e o site publico inteiro.
- **Handler de evento.** A drenagem existe (`src/lib/integracoes/worker.ts` +
  rota `/api/integracoes/worker`), mas `HANDLERS` esta vazio: ninguem sabe
  processar evento nenhum ate haver credencial de canal.
- **Cliente de API** do ML, OLX ou WhatsApp. Faltam credenciais.
- **Emissao de NF-e.** Emissor nao escolhido.
- **Storage de fotos.** Sem isso o CMS e o site nao existem.
- **Escrita na auditoria.** A tabela existe; nada grava nela.
- **Deploy.** O workflow existe, mas nada foi aplicado em HML ou PRD — o banco
  migrado e **so o local**.
