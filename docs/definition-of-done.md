# Definition of Done (DoD)

Uma tarefa so esta "pronta" quando TODOS os itens abaixo sao verdadeiros.
Vale para devs e para agentes de IA. Antes de dizer "concluido", rode o checklist.

## Codigo

- [ ] Faz exatamente o que foi pedido — nada a mais, nada a menos.
- [ ] Nenhum arquivo novo na raiz (usa `src/`, `tests/`, `docs/`, `config/`, `scripts/`).
- [ ] Nenhum arquivo com mais de 500 linhas.
- [ ] Logica de negocio centralizada (nao duplicada entre telas/menus).
- [ ] Leu o arquivo antes de editar.

## Banco de Dados

- [ ] Tabela nova tem `created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by`.
- [ ] FK com `onDelete: restrict` (nunca cascade em dado critico).
- [ ] Exclusao e soft delete (nunca `db.delete`).
- [ ] Toda query filtra `is_deleted = false`.
- [ ] Update concorrente protegido por optimistic locking.
- [ ] PostgreSQL (nunca SQLite) + Drizzle (nunca Prisma).

## Seguranca e Auditoria

- [ ] Autenticacao + RBAC verificados na action.
- [ ] Entrada validada (Zod + regex onde aplicavel).
- [ ] Mutacao gera registro de auditoria (quem/o que/quando).
- [ ] Nenhum secret, `.env` ou credencial commitado.
- [ ] Acao critica passa por modal de confirmacao com block de 3s.

## Qualidade

- [ ] `node scripts/check-compliance.mjs` passa sem ERROS.
- [ ] `npm run lint` e `tsc --noEmit` sem erros.
- [ ] `npm test` verde; caminho critico tem teste.
- [ ] `npm run build` passa.

## Documentacao e Processo

- [ ] Regra de negocio nova registrada em `docs/regras-negocio.md`.
- [ ] Decisao de arquitetura significativa virou ADR em `docs/adr/`.
- [ ] Commit segue Conventional Commits (`docs/git-commits.md`).
- [ ] Backup do banco feito ANTES de deploy em PRD.
