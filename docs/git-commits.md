# Conventional Commits

Padrao de mensagem de commit. Mantem o historico legivel e habilita changelog
e versionamento semantico automaticos.

## Formato

```
<tipo>(<escopo opcional>): <descricao no imperativo>

[corpo opcional — o "porque", nao o "o que"]

[rodape opcional — BREAKING CHANGE, refs de issue]
```

Exemplos:

```
feat(contratos): adiciona soft delete em lancamentos
fix(auth): corrige expiracao de sessao apos 24h
refactor(actions): centraliza regra de margem em um unico lugar
chore(deps): atualiza drizzle-orm para 0.36
```

## Tipos

| Tipo | Quando usar | Versao (semver) |
|------|-------------|-----------------|
| `feat` | Nova funcionalidade | MINOR |
| `fix` | Correcao de bug | PATCH |
| `refactor` | Refatoracao sem mudar comportamento | — |
| `perf` | Melhoria de performance | PATCH |
| `test` | Adicao/ajuste de testes | — |
| `docs` | Documentacao | — |
| `chore` | Build, deps, config, tarefas | — |
| `ci` | Pipelines de CI/CD | — |
| `style` | Formatacao (sem mudar logica) | — |

## Regras

- Descricao no imperativo, minuscula, sem ponto final: "adiciona", nao "adicionado".
- Escopo = area afetada (modulo, feature): `feat(rbac):`.
- Breaking change: adicionar `!` (`feat!:`) e/ou rodape `BREAKING CHANGE: ...`.
- Um commit = uma mudanca coesa. Nao misturar feat + refactor sem relacao.
- Branch `develop` para desenvolvimento; merge para `master` apos validar em HML.

## Rodape co-autoria (commits feitos via IA)

```
Co-Authored-By: Claude <noreply@anthropic.com>
```
