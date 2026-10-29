# Notas da API do Mercado Livre — conferencia da documentacao oficial

Conferido em **2026-10-29** nas paginas `/pt_br/` de
`developers.mercadolivre.com.br`. Tudo foi lido no navegador, so leitura: o
fetch automatico leva 403 nesse dominio. Nenhuma chamada a API foi feita.

Origem: secao 14 da especificacao do Sistema de Anuncios ("pontos a confirmar
antes de codar"). Cada item diz o que a pagina **confirma** e o que ficou
**sem confirmacao**. Item sem confirmacao nao vira regra no codigo sem antes ser
testado na conta real.

> ⚠️ **Fora da secao 14, mas urgente:** a doc trata o multiget `GET /items?ids=`
> como descontinuado, com prazo de migracao ate **25/10/2026**, que ja passou.
> O substituto e `GET /items/bulk?ids=`. Nele, `code` virou `status_code` e a
> selecao de campos usa o prefixo `body.` (ex.: `attributes=body.id`). Hoje o
> `src/` nao usa nenhum dos dois; a Fase 1 (importacao da conta) ja deve nascer
> no `/items/bulk`.

---

## 1. `family_name` × `title` (User Products)

**Confirmado:**

- Com o vendedor em UP, o `POST /items` leva `family_name` (obrigatorio) e
  **nao** leva `title`. O ML gera o titulo a partir do dominio, dos atributos e
  do `family_name`. O formato antigo (`title` + `variations`) da 400.
- Limite: o `family_name` nao pode passar do `max_title_length` do dominio.
- `title` nao muda por `PUT` (bad request). O `family_name` muda so enquanto
  nenhum item do UP tiver venda. A troca recalcula o titulo, propaga para todos
  os itens do UP e pode mudar o `family_id`. Para mudar a familia inteira, a rota
  e `PUT /user-products-families/{family_id}`.
- Cada UP aceita no maximo 30 condicoes de venda (itens).
- A conta esta em UP quando `GET /users/{id}` traz a tag `user_product_seller`.
  Um item esta no modelo novo quando tem `family_name` diferente de nulo (ou a
  tag `user_product_listing`).
- A ativacao e por **vendedor**, nao por categoria. A doc diz que todos os
  vendedores seriam ativados ao longo de 2025.

**Sem confirmacao:**

- O valor numerico de `max_title_length` e o endpoint que o expoe. A doc nao
  traz os dois. O "60" da spec continua sem fonte.
- Os exemplos de `POST` da pagina sao do Mexico (MLM), nao do MLB.

**Consequencia para a spec:** a deteccao "tentar `title`, depois `family_name`"
(secao 8.4) e desnecessaria. Basta ler a tag `user_product_seller` em
`/users/me`, que esta tela ja busca.

Fontes:
- https://developers.mercadolivre.com.br/pt_br/user-products
- https://developers.mercadolivre.com.br/pt_br/preco-variacao

## 2. Custo do frete gratis antes de publicar

**Confirmado:** a rota da spec esta certa.

`GET /users/{user_id}/shipping_options/free`

- Obrigatorio: `item_id` **ou** `dimensions`.
- `dimensions` vai no formato `AxLxC,peso`, com medidas em cm e peso em gramas
  inteiros. Exemplo da doc: `9x17x22,462`.
- Parametros uteis: `item_price`, `listing_type_id`, `mode` (`me2`/`me1`/
  `custom`), `condition`, `logistic_type` (`cross_docking`, `drop_off`,
  `fulfillment`, `xd_drop_off`, `self_service`), `free_shipping`, `verbose`,
  `category_id`, `zip_code`.
- O custo vem em `coverage.all_country.list_cost`. O objeto `discount` so
  aparece quando ha desconto.
- O valor e uma estimativa para 1 unidade.
- So `dimensions` pode devolver `list_cost = 0`. Mande tambem `item_price`,
  `listing_type_id` e `logistic_type`.
- O `free_shipping` agora e esperado. Para comparar, consulte com `True` e com
  `False`.
- O custo real cobrado depois da venda fica em `GET /shipments/{id}/costs`,
  campo `senders[].cost`.

**Sem confirmacao:** as unidades (cm e g) estao nas FAQs, nao na pagina
principal da rota.

Fontes:
- https://developers.mercadolivre.com.br/pt_br/custos-de-envio
- https://developers.mercadolivre.com.br/pt_br/mercado-envios-custos-e-cotacoes
- https://developers.mercadolivre.com.br/pt_br/itens-atributos-de-envio-e-dimensoes

## 3. Trocar o tipo de anuncio

**Confirmado:**

- Trocar: `POST /items/{id}/listing_type` com corpo `{"id": "gold_pro"}`. E
  **POST**, nao PUT.
- Consultar o que e possivel:
  - `GET /items/{id}/available_listing_types`
  - `GET /items/{id}/available_upgrades`
  - `GET /items/{id}/available_downgrades`
- Antes de publicar: `GET /users/{user_id}/available_listing_types?category_id=`.
- No MLB, `gold_special` = Classico e `gold_pro` = Premium. A troca entre os dois
  e permitida a qualquer momento, sem custo (depende do site).
- So se sobe de exposicao uma vez (upgrade). Anuncio gratuito nao pode ser
  rebaixado (downgrade).

Fonte:
- https://developers.mercadolivre.com.br/pt_br/tutorial-tipos-de-publicacao-y-atualizacao-de-artigos

## 4. Limites de requisicao

**Confirmado:**

- O controle e por Client ID e por endpoint. A recomendacao contra 429 e backoff
  exponencial com jitter e menos concorrencia. Aumento de cota se pede a equipe
  comercial, com evidencia de uso. O `client.ts` ja pausa o app inteiro no 429.
- Multiget: ate **20** ids por chamada (ver o aviso do `/items/bulk` no topo).
- Scan (`/users/{id}/items/search?search_type=scan`) serve para passar de 1000
  itens. O `scroll_id` expira em 5 minutos e nao se mistura com
  `offset`/`limit`. O `limit` padrao e 50, o maximo 100.
- `POST /items/validate` devolve **204** quando o JSON e valido.

**Sem confirmacao:**

- **Numero nenhum** de requisicoes por minuto (por app ou por usuario) e
  publicado.
- Nao ha limite especifico documentado para o `/items/validate`.
- O teto de 20 aparece na secao do endpoint antigo. Que o `/items/bulk` tambem
  aceite 20 e inferencia.

Fontes:
- https://developers.mercadolivre.com.br/pt_br/rate-limit-erro-429
- https://developers.mercadolivre.com.br/pt_br/itens-e-buscas
- https://developers.mercadolivre.com.br/pt_br/validador-de-publicacoes

## 5. Escopos e permissoes do app

**Confirmado:**

- O DevCenter tem dois escopos, Leitura (GET) e Escrita (PUT/POST/DELETE), e
  alem deles as **permissoes funcionais**, que precisam ser ativadas:

  | Recurso | Permissao funcional |
  |---|---|
  | Pedidos, envios | Vendas e envios |
  | Perguntas, mensagens, reclamacoes, devolucoes | Comunicacao pre e pos-venda |
  | Publicar e editar itens | Publicacao e sincronizacao |
  | Usuarios (`/users/me`) | ativa por padrao |

- Sem a permissao funcional, a API responde 403
  `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`.
- Os **Topicos** do DevCenter so escolhem quais notificacoes o app recebe. Nao
  dao acesso a nada.
- O access token dura 6 h (`expires_in: 21600`).
- O refresh token e de uso unico: cada renovacao devolve um novo. Ele expira em
  6 meses e e invalidado se a autorizacao for revogada (`invalid_grant`). O
  `token.ts` ja trata isso com lock e com `ReautorizacaoNecessariaError`.
- PKCE e opcional, mas, uma vez ativado no app, `code_challenge` e
  `code_verifier` passam a ser obrigatorios. Use S256. O codigo sempre manda os
  dois, entao **o app precisa ser criado com PKCE ativo** (como ja esta no
  known-issues).

**Sem confirmacao:** a pagina atual de criacao de app nao mostra um campo com o
nome `offline_access`. O exemplo de resposta traz `scope: "offline_access read
write"`, e a doc so diz que o acesso offline e concedido quando o app precisa
agir com o usuario ausente. Como isso aparece hoje na tela do DevCenter fica
para conferir na hora de criar o app.

Fontes:
- https://developers.mercadolivre.com.br/pt_br/permissoes-funcionais
- https://developers.mercadolivre.com.br/pt_br/crie-uma-aplicacao-no-mercado-livre
- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao

## 6. `SELLER_SKU` em todas as categorias

**Confirmado:**

- O jeito certo de mandar o SKU e o **atributo `SELLER_SKU`**. A doc diz que
  `seller_custom_field` e um campo interno do vendedor, **sem relacao** com o
  `SELLER_SKU`. Isso contradiz a spec (secao 3.1), que manda gravar o SKU nos
  dois "por compatibilidade".
- O `SELLER_SKU` aparece em `/items` e em `/orders`.
- Busca por SKU:
  - `GET /users/{id}/items/search?seller_sku=X` (pelo atributo)
  - `?sku=X` (pelo `seller_custom_field`)

**Sem confirmacao:** se **todas** as categorias aceitam `SELLER_SKU`. A doc nao
diz. A explicacao esta na pagina de Variacoes, que e do modelo anterior a UP, e
a pagina de atributos nao o cita. Para cada categoria usada, conferir em
`GET /categories/{id}/attributes` se ele aparece. Essa e uma recomendacao nossa,
nao da doc.

Fontes:
- https://developers.mercadolivre.com.br/pt_br/variacoes
- https://developers.mercadolivre.com.br/pt_br/itens-e-buscas
- https://developers.mercadolivre.com.br/pt_br/atributos
