# Handoff: Sistema MM Soluções — Painel de Gestão de Marketplaces

## Overview
Sistema de acompanhamento comercial para a MM Soluções Empresariais Ltda (Maringá/PR), empresa que revende em marketplaces produtos arrematados em leilão (equipamentos hospitalares/oftalmologia, encadernação, baterias, peças automotivas). O painel centraliza anúncios, perguntas, pedidos, estoque e expedição dos canais Mercado Livre, OLX e WhatsApp, com calculadora de precificação e gestão de equipe/comissões.

Contexto contratual: o sistema faz parte de um contrato da agência Orbital com a MM Soluções (escopo: painel de anúncios/pedidos/perguntas/estoque por lote, alertas de tempo de resposta, relatórios de venda por canal com margem e comissão de 4%, treinamento de operador).

## About the Design Files
Os arquivos deste pacote são **referências de design criadas em HTML** — protótipos que mostram aparência e comportamento pretendidos, não código de produção. A tarefa é **recriar estas telas no ambiente do codebase de destino** (React, Vue, etc.) usando seus padrões e bibliotecas — ou, se ainda não existir ambiente, escolher o framework mais adequado (sugestão: React + backend com as integrações de API descritas abaixo).

## Fidelity
**High-fidelity (hifi).** Cores, tipografia, espaçamentos e conteúdo são finais. Recriar a UI fielmente. Os dados exibidos são de exemplo (mock) — a implementação real deve ligá-los às APIs.

## Arquivos principais
- `Sistema MM Solucoes.dc.html` — SPA com 12 telas trocadas por estado (`state.screen`), navegação na sidebar. Estados: `visao`, `anuncios`, `site` (CMS), `perguntas`, `pedidos`, `expedicao`, `itens` (Estoque), `estoque` (Lotes), `calculadora`, `relatorios`, `equipe`, `integracoes`.
- `Site MM Solucoes.dc.html` — site/e-commerce público da MM Soluções, gerenciado pela tela "Site" do sistema.

## Screens / Views

### 1. Visão geral (`visao`)
- **Propósito**: resumo do dia; primeiro contato do dono com a operação.
- **Layout**: header (título + botões "Ver relatórios" outline e "+ Novo anúncio" primário) → 4 KPI cards em grid `repeat(4,1fr)` gap 16px → grid `1.7fr 1fr` com tabela de anúncios em destaque (esq.) e coluna com cards "Perguntas recentes" e "Estoque por lote" (dir.).
- **KPIs**: Vendas do mês (R$ 38.400), Margem média (41%), Perguntas sem resposta (3 — card com borda âmbar `#E8A33D`, clicável → tela Perguntas), Tempo médio de resposta (1h 12min).

### 2. Anúncios (`anuncios`)
- Filtros em chips (Todos ativo = fundo `#16324F` branco; demais outline `#D4D9E0`): Todos, Mercado Livre, OLX, No ar, Negociando, Pausados.
- Tabela grid `minmax(0,1fr) 52px 88px 88px 72px 104px`: Produto, Canal (ML/OLX), Preço, Margem (verde `#3E8E55` ≥30%, âmbar `#B07514` abaixo), Visitas, Status (pills: No ar verde, Negociando âmbar, Pausado cinza).
- Nota âmbar no rodapé: margem exibida já desconta taxa do canal.

### 3. Perguntas (`perguntas`)
- Caixa unificada ML/OLX/WhatsApp. Grid `1.4fr 1fr`.
- Esquerda: lista de perguntas; pendentes com fundo `#FDF9F0` e pill de SLA (vermelho `#B03A3A` <4h, âmbar), botões "Responder" e "Usar modelo". Respondidas com `opacity:.6` e pill verde.
- Direita: card "Modelos de resposta" (NF + prazo, Garantia e revisão, Retirada em mãos, Negociação de preço).
- **Regra de negócio**: meta de resposta 4h (SLA configurável).

### 4. Pedidos (`pedidos`)
- Tabela grid `76px minmax(0,1fr) 52px 88px 76px 88px 112px`: Nº, Produto, Canal, Valor, Taxa (vermelho), NF-e (Emitida verde), Status (Aguardando envio âmbar / Em transporte azul `#2C6199` / Concluído verde).
- Rodapé: 4 cards — Faturamento bruto R$ 38.400, Taxas − R$ 3.960, Comissões (4%) − R$ 1.536, Líquido R$ 32.904.

### 5. Expedição (`expedicao`)
- Cards por pedido a despachar: título + canal/destino/modalidade, botão "Gerar etiqueta", stepper horizontal de 4 etapas (NF-e emitida → Etiqueta → Embalado → Coletado; concluída = círculo verde ✓, atual = âmbar, futura = cinza), faixa cinza com peso/dimensões/embalagem/prazo ou rastreio.
- Seção "Etiquetas de produto e localização": etiquetas imprimíveis com borda tracejada — produto (QR code + nome + SKU `MM-OFT-1401` + lote + LOCAL em laranja `#D97941`) e etiqueta de localização (fundo navy, código grande "A · 2"). QR real deve apontar para a ficha do item no sistema.
- Nota âmbar: alerta de despacho a 24h do limite (proteção de reputação ML).

### 6. Estoque (`itens`)
- 4 KPIs: Disponíveis 28, Sem anúncio 12 (borda âmbar), Reservados 2, Vendidos no mês 9.
- Chips de segmento: Todos, Oftalmologia, Encadernação, Baterias, Automotivo.
- Tabela grid `minmax(0,1fr) 70px 110px 88px 88px 72px 108px`: Item, Lote, Segmento, Custo, Preço alvo, Canais, Situação (Anunciado verde / Sem anúncio âmbar / Reservado azul / Pausado cinza).
- **Regra**: baixa automática de estoque quando o item vende em qualquer canal; venda em um canal pausa o anúncio nos demais.

### 7. Lotes (`estoque`)
- Grid 2×2 de cards por lote arrematado: nome + segmento, data do arremate, 3 colunas (Custo / Anunciado / Vendido), barra de progresso (% do custo recuperado; verde normal, âmbar para giro lento), linha de resumo (itens, anunciados, vendidos, giro estimado).

### Site — Gestão do site / CMS (`site`)
- **Propósito**: o dono edita o e-commerce sem programador; conteúdo salvo publica no site público.
- KPIs: Status do site (No ar + última publicação), Produtos no site (4 de 16, alerta âmbar para itens sem página), Visitas na semana + contatos via WhatsApp.
- Grid `minmax(0,1fr) minmax(0,1.5fr)`: lista de produtos puxada do estoque (status: No site verde / Sem foto âmbar / Oculto cinza; selecionado com fundo `#F0F4F9` e borda esquerda navy 3px) + editor da página do produto.
- Editor: upload de fotos por drag-and-drop (principal 220×160 + 3 miniaturas 68×52 — no protótipo são `<image-slot>`; em produção, upload real com compressão), campos Título, Descrição (textarea), Preço no site, Valor de novo (exibido riscado), Categoria (select), toggle verde "Exibir no site" (regra: item sai do ar automaticamente ao vender em qualquer canal), botões "Salvar e publicar" / "Descartar".
- Card inferior: edição do banner (image-slot 300×130) e dos textos da home (chamada principal e subtítulo).

### Site público (e-commerce) — `Site MM Solucoes.dc.html`
- **Estratégia**: público-alvo compra equipamento usado de alto valor; o site inteiro trabalha confiança. Conversão via WhatsApp (não carrinho) — é como esse público compra.
- Topbar navy com garantias (NF-e, 90 dias, envio Brasil/retirada) → header (logo, busca, telefone, botão WhatsApp verde `#1FA855`) → nav de categorias → hero grid `1.1fr 1fr` (chamada Archivo 800 42px + stats: 51 itens, até 60% abaixo do novo, 90 dias; imagem à direita) → vitrine "Disponíveis agora" grid 4 colunas (cards: foto 190px com badge de categoria e "Última unidade", preço do novo riscado, preço MM Archivo 800 22px, "em até 12× no cartão", CTA laranja "Consultar disponibilidade") → seção navy "Por que comprar" (4 passos numerados: arremate → revisão → NF-e → envio) → contato (CTAs WhatsApp/tel + formulário de leads "Receba os novos lotes" com nome/WhatsApp/segmento) → footer navy escuro `#0E2136` com CNPJ, endereço e selo "Estoque integrado ao sistema de gestão MM".
- **Integração**: vitrine alimentada pelo sistema (tela Site); disponibilidade em tempo real; formulário de leads registra contatos.

### 8. Calculadora de preço (`calculadora`) — tela interativa
- Grid `1fr 1.6fr`. Esquerda: inputs Custo do item (R$), Frete estimado (R$), slider Margem desejada (10–55%, default 35%).
- Direita: 3 cards de resultado (Mercado Livre com borda navy 2px, OLX, Venda direta/WhatsApp) mostrando preço sugerido e lucro.
- **Fórmula**: `preço = (custo + frete) / (1 − taxa − comissão − margem)`; taxa ML 0,14, OLX 0,05, direta 0; comissão 0,04. Se denominador ≤ 0,05 exibir "—". Lucro = preço × margem. Formato pt-BR sem centavos.
- Nota: leitura inversa = lance máximo no leilão.

### 9. Relatórios (`relatorios`)
- Grid `1.3fr 1fr`. Esquerda: "Vendas por canal (R$ mil)" — barras horizontais por mês (ML navy, OLX laranja, WhatsApp verde).
- Direita: card "Reputação Mercado Livre" (bolinha verde, critérios com limites) e "Top produtos por margem".

### 10. Equipe (`equipe`)
- Usuários com papéis: Anderson (Administrador, pill navy), Operador(a) (Em treinamento, pill âmbar; sem acesso a custos), Orbital (Consultoria, pill cinza).
- Comissões do mês (4% por venda): linhas por pedido + total, acerto todo dia 5.
- Trilha de treinamento do operador: 5 semanas com estados ✓ / ● / ○.

### 11. Integrações (`integracoes`)
- 5 cards de conexão + registro de sincronização (log com timestamps relativos):
  - **Mercado Livre · API oficial** (Conectado): OAuth na conta do vendedor; sincroniza anúncios, perguntas, pedidos, reputação; webhooks/notificações em tempo real.
  - **OLX · API de importação de anúncios** (Conectado): autoupload — publica/atualiza anúncios; pausa automática de item vendido em outro canal. Docs: developers.olx.com.br.
  - **WhatsApp Business** (Vinculado): catálogo, respostas rápidas, registro de venda direta como pedido manual.
  - **Google · Perfil da Empresa** (No ar): endereço/horários/WhatsApp, pedido de avaliação pós-venda, monitoramento de buscas pela marca.
  - **Emissão de NF-e** (A configurar): conexão com emissor fiscal, certificado A1.

## Interactions & Behavior
- Navegação: clique nos itens da sidebar troca `state.screen`; item ativo ganha ponto âmbar 6px à esquerda; hover `rgba(255,255,255,.08)`.
- Badge "3" (perguntas pendentes) na sidebar em âmbar; badge "2" (expedição) em cinza translúcido.
- Calculadora: recálculo imediato a cada input/slider (controlled inputs).
- KPI "Perguntas sem resposta" e links "Responder →" navegam para a tela Perguntas.
- Sem animações de transição entre telas (troca direta).
- Produção: perguntas novas chegam via webhook e devem atualizar badge/lista em tempo real; alertas de SLA e de despacho enviados por WhatsApp.

## State Management
- `screen` (string), `custo` (number), `frete` (number), `margem` (number 10–55).
- Produção: entidades Item (SKU, lote, segmento, custo, preço alvo, local no galpão, situação), Lote (custo, data, itens), Anúncio (canal, preço, status, visitas), Pergunta (canal, texto, SLA, status), Pedido (canal, valor, taxa, comissão, NF-e, etapa de expedição, rastreio), Usuário (papel, permissões — operador sem acesso a custos).

## Design Tokens
**Cores**
- Navy primário: `#16324F` (sidebar, botões, títulos)
- Tinta: `#2B3440` · Texto secundário: `#6B7684` · Texto claro sidebar: `#C7D2DD` / `#9FB0C2`
- Laranja marca (setas do logo, destaques de local): `#D97941` · Âmbar alerta: `#E8A33D` (texto `#B07514`, fundo `#FDF3E1`, aviso `#7A5410`)
- Verde sucesso: `#3E8E55` (fundo `#E7F4EB`) · status online `#5FBF77`
- Vermelho: `#B03A3A` (fundo `#FDE8E8`) · Azul info: `#2C6199` (fundo `#E3EEF9`)
- Fundos: página `#EDEFF2`, cards `#FFF`, cabeçalho de tabela `#F7F8FA`, bordas `#E0E4EA` / linhas `#EDF0F3`, borda input `#D4D9E0`
**Tipografia**
- Display/números: Archivo (700/800) — títulos 22px, KPIs 26px (800), card titles 15px (700)
- Texto: Jost (300/400/500/600) — corpo 13px, secundário 12px, labels uppercase 11–12px letter-spacing .12–.14em
**Outros**: radius 8px cards / 6px botões e inputs / 20px pills; padding cards 18–22px; gap grids 16–20px; sidebar 236px.

## Assets
- Logo MM Soluções (opção "1c"): wordmark "MM" Archivo 800 + duas setas paralelas inclinadas laranja `#D97941` (segunda com opacity .55) + subtítulo "SOLUÇÕES EMPRESARIAIS" espaçado. SVG inline no arquivo; variações PNG em `logo-mm/` (principal, fundo escuro, avatar redondo, avatar quadrado).
- QR codes das etiquetas: no protótipo são SVG decorativos; em produção gerar QR reais (lib de QR) apontando para a URL da ficha do item.

## Files
- `Sistema MM Solucoes.dc.html` — protótipo completo (12 telas, template + lógica de navegação e calculadora)
- `Site MM Solucoes.dc.html` — site/e-commerce público (uma página, âncoras internas)
- `image-slot.js` — componente de placeholder de imagem usado nos protótipos (substituir por upload real)
- `logo-mm/logo-principal.png`, `logo-mm/logo-fundo-escuro.png`, `logo-mm/avatar-redondo.png`, `logo-mm/avatar-quadrado.png`
- `Logo MM Solucoes.dc.html` — estudo das 3 opções de logo (1c escolhida)

## Screenshots
Capturas em `screenshots/`: 01-visao-geral … 12-integracoes (ordem do menu lateral, incluindo 03-site-cms) e 13-site-ecommerce (página pública).

## Dados da empresa (para telas e NF-e)
MM SOLUCOES EMPRESARIAIS LTDA · CNPJ 61.968.512/0001-30 · Av. Horácio Raccanello Filho 6326, Pav. 2 Sala 01, Zona 01, Maringá/PR, CEP 87.020-035 · Responsável: Anderson Antonio Merlos.
