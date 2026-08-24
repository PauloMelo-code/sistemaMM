# Workflow — nova funcionalidade no MM Soluções

## 1. Ler antes de projetar

- `docs/known-issues.md` — **primeiro de todos**: o que bloqueia, o que não foi decidido e o que é divergência intencional
- `docs/regras-negocio.md` — regras de dinheiro, estoque e SLA. **Obrigatório antes de qualquer cálculo**
- `docs/architecture.md` e `docs/design-system.md`
- O arquivo real que você vai alterar

A funcionalidade pode já existir com outro nome — confira a documentação antes de escrever.

## 2. Decidir onde mora

| Tipo de mudança | Onde |
| :--- | :--- |
| Cálculo de dinheiro | `src/lib/pricing.ts` — **uma** implementação |
| Regra de negócio | `docs/regras-negocio.md` primeiro, depois o código |
| Tabela ou coluna | schema Drizzle + `/criar-tabela` + `db:generate` e `db:migrate` |
| Tela nova | `/importar-tela` a partir do `.dc.html` (121 KB, 12 telas — uma por vez, pela flag `is<Nome>`) |
| Token de design | `docs/design-system.md` |
| Integração de marketplace | webhook idempotente + baixa de estoque em ação única |

Regra de negócio fica em **um** lugar e é consumida por todas as telas. Se você está copiando a
mesma lógica para um segundo arquivo, pare.

## 3. Implementar respeitando os invariantes

Os da seção "Invariantes" em [../rules/mm-solucoes.md](../rules/mm-solucoes.md) valem todos. Em especial:

- **Cálculo de dinheiro mora em `src/lib/pricing.ts`, uma vez só.** Preço, taxa, comissão, margem e lucro são importados dali — nunca reescritos dentro de componente ou action (RN-100)
- **`lucro = preço × margem` está correto.** Não "conserte" descontando custo e taxas de novo — a fórmula já embute (RN-101)
- **Valor monetário em `numeric`**, nunca `float`. Exibição pt-BR sem centavos, fonte Archivo
- **Venda em um canal baixa o estoque, pausa os outros anúncios e tira do site** — ação única e **idempotente**; reprocessar o webhook não pode pausar duas vezes (RN-104)

## 4. Testar

```bash
npm run typecheck
npm test
npm run lint
```

## 5. Documentar na mesma alteração

- Módulo, integração ou invariante novo → a doc de arquitetura do projeto
- Invariante que os agentes precisam respeitar → `AGENTS.md` **e** `CLAUDE.md` (os dois)
- Decisão de arquitetura → ADR, se o projeto tiver `docs/adr/`

## 6. Reportar

Arquivos criados/alterados · invariantes tocados · saída dos comandos acima · docs atualizados ·
o que ficou fora do escopo.
