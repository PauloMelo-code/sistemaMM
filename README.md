# Sistema MM Soluções

Painel de gestão de marketplaces para a **MM Soluções Empresariais** (Maringá/PR), que revende em
Mercado Livre, OLX e WhatsApp produtos arrematados em leilão. Projeto da agência **Orbital**.

São **dois produtos na mesma base**:

- o **painel** (12 telas — Anderson e o operador);
- o **site público** de e-commerce (vitrine + captação por WhatsApp).

O sistema cuida de dinheiro real: precificação, taxa, comissão e margem de uma operação que vive de
giro de estoque. A leitura inversa da precificação define o **lance máximo no leilão** — errar ali
vira prejuízo antes mesmo da venda.

## Stack

Next.js App Router · TypeScript strict · **Drizzle ORM + PostgreSQL** · Tailwind + shadcn/ui.
Banco local na porta **5436** (`docker-compose.yml`). Segue o padrão da estrutura base: Drizzle
(nunca Prisma), PostgreSQL (nunca SQLite), soft delete e colunas de auditoria.

## Setup

```bash
npm install
docker compose up -d          # PostgreSQL na porta 5436
cp .env.example .env
npm run db:migrate
npm run dev                   # http://localhost:3000
```

## Comandos

```bash
npm run dev
npm run build                 # node scripts/build.mjs
npm run lint
npm run typecheck             # next typegen && tsc --noEmit
npm test                      # node --test
npm run db:generate           # drizzle-kit generate  (NUNCA db:push)
npm run db:migrate
npm run db:migrate:prod       # node scripts/migrar.mjs
npm run db:studio
```

> **Nunca rode `drizzle-kit push`** — só `generate` (SQL aditivo) + `migrate`.

## Design

`design_handoff_sistema_mm/` é o protótipo **hi-fi** — referência de design, **não** código de
produção. Não lintar, não refatorar, não mover para `src/`, não aplicar limite de 500 linhas.
Para portar uma tela use a skill `/importar-tela`.

O arquivo `Sistema MM Solucoes.dc.html` tem 121 KB com as 12 telas juntas: porte **uma por vez**,
pela flag `is<Nome>`.

> Cuidado com a nomenclatura do protótipo: o state `itens` é a tela **Estoque**; o state `estoque`
> é a tela **Lotes**.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/known-issues.md](docs/known-issues.md) | **Leia primeiro** — o que bloqueia, o que não foi decidido e o que é divergência intencional |
| [docs/regras-negocio.md](docs/regras-negocio.md) | Regras de dinheiro, estoque e SLA. **Obrigatório antes de qualquer cálculo** |
| [docs/architecture.md](docs/architecture.md) | Arquitetura |
| [docs/design-system.md](docs/design-system.md) · [docs/components.md](docs/components.md) · [docs/front.md](docs/front.md) · [docs/back.md](docs/back.md) | UI e camadas |
| [docs/rbac.md](docs/rbac.md) | Permissões — inclui o sigilo de custo para o operador |
| [docs/runbook-deploy.md](docs/runbook-deploy.md) · [docs/definition-of-done.md](docs/definition-of-done.md) | Deploy e checklist final |
| [docs/adr/](docs/adr/) | Decisões de arquitetura |
| [docs/analise-corretude-2026-08-10.md](docs/analise-corretude-2026-08-10.md) | Análise de corretude |

### Para agentes de IA

| Arquivo | Para quem |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Claude Code |
| [AGENTS.md](AGENTS.md) | Codex, Cursor, Copilot e agentes genéricos |
| [.agents/rules/mm-solucoes.md](.agents/rules/mm-solucoes.md) | Antigravity — regras do workspace |
| [.agents/workflows/bugfix.md](.agents/workflows/bugfix.md) · [.agents/workflows/feature.md](.agents/workflows/feature.md) | Passo a passo por tipo de tarefa |
| `.claude/skills/` | `/criar-tabela`, `/criar-crud`, `/criar-componente`, `/importar-tela`, `/repo-docs-sync`, `/how-to-use-guide` |

**Antes de qualquer cálculo de dinheiro, leia `docs/regras-negocio.md`.** Preço, taxa, comissão,
margem e lucro moram em `src/lib/pricing.ts` — uma vez só.
