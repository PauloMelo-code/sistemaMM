---
# Tokens legiveis por maquina — CONTRATO do design system MM Solucoes.
# Origem: design_handoff_sistema_mm/README.md + prototipos .dc.html. Design final.
# Coluna `class` = nome Tailwind ja implementado no @theme de src/app/globals.css.
# O @theme e a fonte da verdade; este bloco e o espelho legivel dele.
# Mudou um, mude o outro NA MESMA alteracao.
color:
  # Marca
  navy:            { class: "navy",            var: "--navy",            value: "#16324F" }  # sidebar, botoes, titulos
  navy-deep:       { class: "navy-deep",       var: "--navy-deep",       value: "#0E2136" }  # footer do site publico
  orange:          { class: "orange",          var: "--orange",          value: "#D97941" }  # setas do logo, local no galpao, CTA do site
  # Texto
  ink:             { class: "ink",             var: "--ink",             value: "#2B3440" }
  ink-2:           { class: "ink-2",           var: "--ink-2",           value: "#6B7684" }  # secundario
  on-navy:         { class: "on-navy",         var: "--on-navy",         value: "#C7D2DD" }  # texto claro na sidebar
  on-navy-2:       { class: "on-navy-2",       var: "--on-navy-2",       value: "#9FB0C2" }  # secundario na sidebar
  # Superficies
  page:            { class: "page",            var: "--page",            value: "#F7F8FA" }  # clareado na casca de 2026-08-11 (era #EDEFF2)
  card:            { class: "card",            var: "--card",            value: "#FFFFFF" }
  table-head:      { class: "table-head",      var: "--table-head",      value: "#F7F8FA" }
  row-selected:    { class: "row-selected",    var: "--row-selected",    value: "#F0F4F9" }  # item selecionado no CMS
  border:          { class: "border",          var: "--border",          value: "#E0E4EA" }
  divider:         { class: "divider",         var: "--divider",         value: "#EDF0F3" }  # linhas de tabela
  border-input:    { class: "border-input",    var: "--border-input",    value: "#D4D9E0" }
  # Semanticas
  success:         { class: "success",         var: "--success",         value: "#3E8E55" }
  success-soft:    { class: "success-soft",    var: "--success-soft",    value: "#E7F4EB" }
  online:          { class: "online",          var: "--online",          value: "#5FBF77" }
  warning:         { class: "warning",         var: "--warning",         value: "#E8A33D" }  # borda/ponto de alerta
  warning-text:    { class: "warning-text",    var: "--warning-text",    value: "#B07514" }
  warning-soft:    { class: "warning-soft",    var: "--warning-soft",    value: "#FDF3E1" }
  warning-note:    { class: "warning-note",    var: "--warning-note",    value: "#7A5410" }  # texto de nota de aviso
  pending-bg:      { class: "pending-bg",      var: "--pending-bg",      value: "#FDF9F0" }  # fundo de pergunta pendente
  danger:          { class: "danger",          var: "--danger",          value: "#B03A3A" }
  danger-soft:     { class: "danger-soft",     var: "--danger-soft",     value: "#FDE8E8" }
  info:            { class: "info",            var: "--info",            value: "#2C6199" }  # em transporte / reservado
  info-soft:       { class: "info-soft",       var: "--info-soft",       value: "#E3EEF9" }
  whatsapp:        { class: "whatsapp",        var: "--whatsapp",        value: "#1FA855" }  # so botoes de WhatsApp
radius:
  card:   { class: "rounded-card",   var: "--radius-card",   value: "14px" }  # era 8px ate a casca de 2026-08-11
  button: { class: "rounded-button", var: "--radius-button", value: "6px"  }  # botoes e inputs
  pill:   { class: "rounded-pill",   var: "--radius-pill",   value: "20px" }
elevation:
  # NOVOS na casca de 2026-08-11. Sombra tingida de navy, nao preta: preto puro
  # sobre #F7F8FA acinzenta a paleta.
  card:  { class: "shadow-(--shadow-card)",  var: "--shadow-card",  value: "0 1px 2px rgba(22,50,79,.06), 0 1px 3px rgba(22,50,79,.04)" }
  hover: { class: "shadow-(--shadow-hover)", var: "--shadow-hover", value: "0 4px 12px rgba(22,50,79,.10), 0 2px 4px rgba(22,50,79,.06)" }
motion:
  duracao: { var: "--duracao-rapida", value: "150ms" }
  ease:    { var: "--ease-padrao",    value: "cubic-bezier(.4,0,.2,1)" }
typography:
  display: { class: "font-display", var: "--font-display", value: "Archivo", weights: [500, 600, 700, 800] }
  body:    { class: "font-body",    var: "--font-body",    value: "Jost",    weights: [300, 400, 500, 600] }
  sizes:
    titulo-tela:  { size: 22, family: "Archivo", weight: 700 }
    kpi:          { size: 26, family: "Archivo", weight: 800 }
    card-title:   { size: 15, family: "Archivo", weight: 700 }
    corpo:        { size: 13, family: "Jost" }
    secundario:   { size: 12, family: "Jost" }
    label:        { size: "11-12", family: "Jost", transform: "uppercase", tracking: ".12-.14em" }
    hero-site:    { size: 42, family: "Archivo", weight: 800 }
    preco-site:   { size: 22, family: "Archivo", weight: 800 }
spacing:
  card_padding: "18-22px"
  grid_gap: "16-20px"
  sidebar_width: "200px"   # era 236px; o icone assumiu parte do reconhecimento
grids:
  # larguras de coluna sao intencionais — reproduzir exatamente
  anuncios:  "minmax(0,1fr) 52px 88px 88px 72px 104px"
  pedidos:   "76px minmax(0,1fr) 52px 88px 76px 88px 112px"
  estoque:   "minmax(0,1fr) 70px 110px 88px 88px 72px 108px"
  kpis:      "repeat(4,1fr)"
  visao:     "1.7fr 1fr"
  perguntas: "1.4fr 1fr"
  site_cms:  "minmax(0,1fr) minmax(0,1.5fr)"
  relatorios: "1.3fr 1fr"
  calculadora: "1fr 1.6fr"
theme: light-only
tokens_source: src/app/globals.css     # o @theme manda; este doc e o espelho legivel
design_source: design_handoff_sistema_mm/
---

# Design System — Sistema MM Soluções

Padrao visual **extraido do prototipo hi-fi**. Leia antes de qualquer mudanca de
UI ou componente novo.

**Fonte da verdade:** o bloco `@theme` de `src/app/globals.css` — os 27 tokens de
cor, 3 raios e 2 familias ja estao la. O bloco YAML no topo deste doc e o
espelho legivel, e o handoff
([`design_handoff_sistema_mm/README.md`](../design_handoff_sistema_mm/README.md))
e a origem historica do design.

> ⚠️ **ISTO MUDOU EM 2026-08-11.** Ate essa data valia "divergiu do screenshot,
> esta errado". Por decisao do Paulo, o painel adotou uma **casca visual nova**
> (fundo mais claro, raio de card maior, sombra, sidebar de 200px com icones).
> A partir daqui o **handoff nao e mais o arbitro do shell e das superficies** —
> quem manda e este doc mais o `@theme`. O que o handoff continua arbitrando:
> **conteudo de cada tela, larguras de coluna, e toda a semantica de cor**
> (navy e laranja da marca; ambar/verde/vermelho/azul de status). Detalhes e o
> porque em [known-issues.md](known-issues.md).
>
> Os **dados** do prototipo sao mock — esses sim vem da API/banco.

---

## Dois produtos, um design system

| | Painel (`Sistema MM Solucoes.dc.html`) | Site publico (`Site MM Solucoes.dc.html`) |
|---|---|---|
| Publico | Anderson + operador | comprador de equipamento usado |
| Tom | denso, operacional | confianca, poucos elementos |
| Acento | navy + ambar de alerta | navy + **laranja** nos CTAs |
| Conversao | — | **WhatsApp**, nao carrinho |

Mesmos tokens, densidades diferentes. Nao leve a densidade do painel para o site.

---

## Cor

Tema **claro unico**. Nao escreva variantes `dark:`.

- **Navy `#16324F`** e a cor do sistema: sidebar, botoes primarios, titulos.
- **Laranja `#D97941`** e da marca (setas do logo). No painel aparece so em
  destaque de **local no galpao**; no site publico e a cor dos CTAs.
  Nao use laranja como cor de status.
- **Ambar `#E8A33D`** e sempre **alerta**, nunca decoracao: borda do KPI de
  perguntas sem resposta, SLA estourando, item sem anuncio, giro lento.
- **Verde WhatsApp `#1FA855`** e exclusivo de botao de WhatsApp — nao e a cor de
  sucesso (`#3E8E55`).

### Cor por status (nao invente outras)

| Contexto | Estado → cor |
|---|---|
| Anuncio | No ar `success` · Negociando `warning` · Pausado cinza |
| Margem | ≥30% `success` · abaixo `warning-text` |
| Pedido | Aguardando envio `warning` · Em transporte `info` · Concluido `success` |
| Item | Anunciado `success` · Sem anuncio `warning` · Reservado `info` · Pausado cinza |
| Pergunta | pendente fundo `pending-bg` + pill SLA (`danger` <4h) · respondida `opacity:.6` + pill `success` |
| Site/CMS | No site `success` · Sem foto `warning` · Oculto cinza |
| Taxa (Pedidos) | sempre `danger` — e valor que sai |

---

## Tipografia

Duas familias, papeis fixos:

- **Archivo** — display e **todo numero que importa** (KPI, preco, valor).
  Pesos 700/800.
- **Jost** — texto corrido, labels, tabela. Pesos 300–600.

Label de secao: 11–12px, uppercase, `letter-spacing: .12–.14em`.
Nao troque de familia por "ficar melhor"; a hierarquia do produto depende disso.

## Raio e espacamento

Escala fechada: card **14px** · botao/input 6px · pill 20px.
Padding de card 18–22px, gap de grid 16–20px, sidebar **200px**.
Valor fora da escala continua sendo erro — o que mudou foi o VALOR do token de
card, nao a liberdade de inventar raios. Escreva `rounded-card`, nunca
`rounded-[14px]`: no dia em que o raio mudar de novo, o literal fica para tras.

## Elevacao e movimento

Card separa-se da pagina por **sombra**, nao mais por contraste de fundo — o
`--page` clareou para `#F7F8FA` e a borda de 1px sozinha dava ar de prototipo.
Use `--shadow-card` em repouso e `--shadow-hover` no estado interativo.
Transicao: `--duracao-rapida` (150ms) com `--ease-padrao`. Nada mais longo:
painel operacional usado o dia inteiro transforma animacao em espera.

---

## Componentes base

Ainda **nao existem em codigo**. Quem precisar primeiro cria em
`src/components/ui/` e registra aqui. Inventario que o prototipo exige:

Sidebar (item ativo com ponto ambar 6px; hover `rgba(255,255,255,.08)`; badges),
KPI Card (variante alerta com borda ambar, clicavel), Chip de filtro, Table
(header `table-head`, colunas de largura fixa), Pill de status, Card, Button
(primario navy / outline), Input, Select, Textarea, Slider, Toggle, Modal,
ModalConfirmacaoBlock, Skeleton, EmptyState, Stepper (expedicao, 4 etapas),
Barra de progresso (lotes), Etiqueta imprimivel (produto e localizacao),
Upload de foto (drag-and-drop).

> `image-slot.js` do handoff e **placeholder de prototipo**. Em producao vira
> upload real com compressao — nao porte o componente.

---

## Regras de uso (valem como bloqueio de review)

1. **Zero hex/rgb cru** em `src/`. So token.
2. **Sem `dark:`** — tema claro unico.
3. **Sem raio ou espacamento fora da escala.**
4. **Sem `alert()` / `window.confirm()`** — modal do design system; acao critica
   usa `ModalConfirmacaoBlock` (block 3s).
5. **Numero de dinheiro sempre em Archivo**, formato pt-BR sem centavos.
6. **Ambar = alerta.** Se nao for alerta, nao e ambar.
7. **Largura de coluna de tabela conforme o README** — nao troque por `auto`.
8. **Grid de tela empilha abaixo do ponto de corte.** O handoff so desenhou
   desktop; reproduzir o grid fixo sem breakpoint deixa a tela inutilizavel no
   estreito. Fidelidade vale **acima** do corte. O shell (sidebar e layout do
   painel) ja resolve o dele — nao refazer. Como escolher o ponto e o que mais
   verificar (esqueleto, largura cravada, linha com pill): secao
   "Responsividade" da skill `/importar-tela`.

## Manutencao

Mudou token no `@theme` → atualize o bloco do topo na mesma alteracao.
Divergencia entre este doc e o codigo vai para
[known-issues.md](known-issues.md), nao e "resolvida" no silencio.
