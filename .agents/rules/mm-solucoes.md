# Regras do workspace — MM Soluções

Regras para o agente do Antigravity / Codex neste repositório. **A fonte completa é o
[AGENTS.md](../../AGENTS.md) e o [CLAUDE.md](../../CLAUDE.md) na raiz** — este arquivo é o resumo
operacional, não um segundo conjunto de regras. Se divergirem, vale a raiz.

## Contexto

Painel de gestão de marketplaces para a MM Soluções Empresariais (Maringá/PR), que revende em ML, OLX e WhatsApp produtos arrematados em leilão. Projeto da agência Orbital. **Cuida de dinheiro real**: precificação, taxa, comissão e margem de uma operação que vive de giro de estoque. São **dois produtos na mesma base**: o painel (12 telas) e o site público de e-commerce.

Next.js App Router · TypeScript strict · **Drizzle + PostgreSQL** (banco local na porta **5436**).

## Ordem de leitura

1. `docs/known-issues.md` — **primeiro de todos**: o que bloqueia, o que não foi decidido e o que é divergência intencional
2. `docs/regras-negocio.md` — regras de dinheiro, estoque e SLA. **Obrigatório antes de qualquer cálculo**
3. `docs/architecture.md` e `docs/design-system.md`
4. O arquivo real que você vai alterar

## Invariantes

1. **Cálculo de dinheiro mora em `src/lib/pricing.ts`, uma vez só.** Preço, taxa, comissão, margem e lucro são importados dali — nunca reescritos dentro de componente ou action (RN-100)
2. **`lucro = preço × margem` está correto.** Não "conserte" descontando custo e taxas de novo — a fórmula já embute (RN-101)
3. **Valor monetário em `numeric`**, nunca `float`. Exibição pt-BR sem centavos, fonte Archivo
4. **Venda em um canal baixa o estoque, pausa os outros anúncios e tira do site** — ação única e **idempotente**; reprocessar o webhook não pode pausar duas vezes (RN-104)
5. **Operador não vê custo.** Filtrado no **servidor**; o campo não chega ao cliente. Esconder por CSS não conta (RN-107)
6. **Os `.dc.html` não são código de produção** — só `/importar-tela`
7. **Zero hex/rgb cru em `src/`** — toda cor vem de token
8. **Âmbar (#E8A33D) é alerta, nunca decoração.** Verde #1FA855 é só botão de WhatsApp; sucesso é #3E8E55
9. **Nunca rodar `drizzle-kit push`** — só `generate` (aditivo) + `migrate`
10. **Nenhuma tela nova sem tabela** — faltou entidade, `/criar-tabela` primeiro
11. **Regra de negócio nova vai para `docs/regras-negocio.md` antes de virar código**

## Proibido

- Recalcular preço, taxa, comissão ou margem fora de `src/lib/pricing.ts`
- "Corrigir" a fórmula do lucro descontando custo e taxas de novo
- `float` para dinheiro
- Webhook de venda não idempotente
- Esconder custo do operador só no front
- Hex ou rgb cru em `src/`
- Usar âmbar como decoração
- `drizzle-kit push`
- Editar, lintar ou mover os `.dc.html`

## Comandos

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run db:generate` · `npm run db:migrate` · `npm run db:studio`

## Atenção

A **base de cálculo da comissão de 4% ainda não foi confirmada** (`docs/known-issues.md`, 🔴). Não implemente o acerto antes da confirmação — e lembre que a leitura inversa da precificação define o **lance máximo no leilão**: errar ali vira prejuízo antes mesmo da venda.
