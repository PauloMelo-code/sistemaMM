# Descricao

<!-- O que esta PR faz e por que. Link para issue/ADR se houver. -->

## Tipo

- [ ] feat (nova funcionalidade)
- [ ] fix (correcao de bug)
- [ ] refactor
- [ ] docs
- [ ] chore / ci

## Checklist (Definition of Done)

> Detalhes em `docs/definition-of-done.md`.

### Banco e dados
- [ ] Tabelas novas com colunas de auditoria (`created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by`).
- [ ] FK com RESTRICT; exclusao por soft delete; queries filtram `is_deleted`.
- [ ] PostgreSQL + Drizzle (sem SQLite, sem Prisma).

### Seguranca e auditoria
- [ ] Autenticacao + RBAC na action.
- [ ] Entrada validada (Zod + regex).
- [ ] Mutacao gera auditoria.
- [ ] Acao critica com modal block 3s.
- [ ] Nenhum secret/`.env` commitado.

### Qualidade
- [ ] `node scripts/check-compliance.mjs` sem erros.
- [ ] lint + `tsc --noEmit` + testes + build passando.
- [ ] Caminho critico coberto por teste.

### Processo
- [ ] Regra de negocio nova em `docs/regras-negocio.md`.
- [ ] Decisao de arquitetura em `docs/adr/` (se aplicavel).
- [ ] Commits no padrao Conventional Commits.

## Como testar

<!-- Passos para o revisor validar localmente. -->

## Screenshots / evidencias

<!-- Se houver mudanca de UI. -->
