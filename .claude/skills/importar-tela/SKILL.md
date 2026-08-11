---
name: importar-tela
description: Converte uma tela do prototipo hi-fi (design_handoff_sistema_mm/) em rota e componentes Next.js do padrao da base, mantendo fidelidade e ligando os dados mock as tabelas reais. Use quando o usuario pedir para implementar, portar ou recriar uma tela do Sistema MM Solucoes (visao geral, anuncios, site/CMS, perguntas, pedidos, expedicao, estoque, lotes, calculadora, relatorios, equipe, integracoes) ou o site publico.
---

# Importar Tela do Prototipo

Os arquivos de `design_handoff_sistema_mm/` sao **referencia de design hi-fi**.
Nao sao codigo de producao e nunca vao para `src/`.

Complementa `/criar-componente` (padrao de componente) — aqui entram a fidelidade
visual e a ligacao com dados reais.

## Onde a tela mora no prototipo

Diferente de outros projetos, **as 12 telas do painel vivem num arquivo so**:
`Sistema MM Solucoes.dc.html` — um SPA que troca `state.screen`.

- O markup esta em `<x-dc>…</x-dc>`, a logica em `<script data-dc-script>`.
- Cada tela tem uma flag `is<Nome>` (`isVisao`, `isAnuncios`, `isPerguntas`,
  `isPedidos`, `isExpedicao`, `isItens`, `isEstoque`, `isCalculadora`,
  `isRelatorios`, `isEquipe`, `isIntegracoes`, `isSite`) — use a flag para
  localizar o bloco daquela tela.
- Atencao a nomenclatura do prototipo: **`itens` = tela Estoque** e
  **`estoque` = tela Lotes**. Nas rotas use os nomes corretos (`/estoque`,
  `/lotes`), nao os do state.
- O site publico e outro arquivo: `Site MM Solucoes.dc.html` (pagina unica com
  ancoras).

## Antes de comecar

1. Leia `docs/known-issues.md` — pode haver decisao pendente que bloqueia a tela.
2. Leia a secao da tela no `design_handoff_sistema_mm/README.md` (grids, colunas,
   cores por status, regra de negocio).
3. Abra o `screenshots/NN-*.png` correspondente.
4. Confira `docs/regras-negocio.md` — se a tela mexe com dinheiro, estoque ou
   SLA, a regra ja esta escrita la e **nao se reinterpreta**.

## Regras de fidelidade

- **Pixel-perfect**: grid, colunas, cor por status, peso e tamanho de fonte
  conforme o README. Nao "melhore" o design.
- **Sempre via token** (`docs/design-system.md`). Hex cru em `src/` e erro.
- Fontes: **Archivo** (display/numeros, 700/800) e **Jost** (texto, 300–600).
  Nao troque por outra fonte nem use peso fora dessas faixas.
- Larguras de coluna do README sao intencionais (`minmax(0,1fr) 52px 88px …`) —
  reproduza; e o que impede a tabela de "dançar".

## Dados

O prototipo usa mock. Na conversao:

- Busca de dados no server component; nunca no client.
- Query sempre com `eq(tabela.is_deleted, false)`.
- Entidades ja mapeadas no README (secao "State Management"): Item, Lote,
  Anuncio, Pergunta, Pedido, Usuario. Faltou tabela → `/criar-tabela` antes.
- **Valor monetario em `numeric`**, nunca `float`. Formato pt-BR sem centavos na
  exibicao, conforme o prototipo.
- Nenhum calculo de preco, taxa, comissao ou margem dentro de componente —
  importe de `src/lib/pricing.ts` (fonte unica, ver `docs/regras-negocio.md`).

## Server vs client

- `page.tsx` (server): busca dados, resolve RBAC, passa props.
- Client component pequeno so para o interativo. Nesta base normalmente:
  chips de filtro, ordenacao, calculadora (recalculo a cada input/slider),
  toggles do CMS, upload de fotos, stepper de expedicao.
- A navegacao do prototipo e `state.screen`; em producao vira **rota real**
  (`/anuncios`, `/pedidos`…), nao estado.

## RBAC — nao e opcional nesta tela

O papel **Operador nao ve custo**. Isso vale em Estoque, Lotes, Calculadora,
Pedidos e Relatorios. Filtrar no **servidor** (nao esconder no CSS): o campo
nao pode nem chegar ao cliente. Ver `docs/rbac.md`.

## Estados obrigatorios

Carregando (skeleton com a geometria do componente final), vazio, erro e
sucesso. O prototipo so mostra o estado cheio — os outros sao seus.

## Acoes criticas

Usam `<ModalConfirmacaoBlock>` (block 3s, sem fechar por ESC/clique fora):
publicar ou pausar anuncio, emitir NF-e, gerar etiqueta, dar baixa em item,
salvar e publicar no site, acertar comissao.

## Checklist

- [ ] Bati a tela contra o screenshot e a secao do README?
- [ ] Zero hex cru — tudo via token de `docs/design-system.md`?
- [ ] Archivo/Jost nos pesos certos?
- [ ] Dados no server, query com `is_deleted = false`, dinheiro em `numeric`?
- [ ] Calculo financeiro importado de `src/lib/pricing.ts`, nao reescrito?
- [ ] Operador sem acesso a custo, filtrado no servidor?
- [ ] Carregando + vazio + erro tratados?
- [ ] Acao critica com modal block 3s?
- [ ] `node scripts/check-compliance.mjs` limpo?
