-- Prova das regras do CRUD de Lotes e Itens (RN-121 e RN-122).
-- Roda em transacao, faz ROLLBACK. Nao deixa sujeira.
--
-- Uso: docker exec -i mmsolues-db-1 psql -U dev -d mmsolucoes_dev < scripts/db/prova-mutacoes-crud.sql
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA PROVA E, E O QUE ELA NAO E.
--
-- As demais `prova-*.sql` conferem constraints: o banco DEFENDE a regra e a
-- prova mostra o `unique_violation`. Aqui e o contrario. Todas as regras do
-- CRUD que entrou em 2026-08-11 vivem SO em `src/lib/actions/lotes-mutacoes.ts`
-- e `estoque-mutacoes.ts` — exclusao logica nao dispara chave estrangeira, e
-- nenhuma delas tem trigger, check ou indice atras.
--
-- Entao cada caso aqui prova DUAS coisas, e as duas importam:
--   (a) que o BANCO deixa passar — logo a regra e mesmo so da action, e apagar
--       a linha de codigo nao quebra teste nenhum;
--   (b) que a CONSULTA-GUARDA que a action roda devolve a resposta certa contra
--       dado real — que e a unica parte da action verificavel sem o runtime do
--       Next (a action e `"use server"` e chama `revalidatePath`).
--
-- O que continua SEM cobertura, e esta prova nao alcanca: a action de fato
-- CHAMAR a guarda antes de gravar. Isso so um teste de integracao com o Next
-- pega. Ver o relatorio.
-- ---------------------------------------------------------------------------
--
-- ⚠️ ESPERADO HOJE: 23 passaram, 1 FALHOU.
-- O caso 4c ja foi um BUG REAL (edicao legitima recusada por microssegundos e
-- fuso). Corrigido em 2026-08-11: a comparacao passou a ser por ::text. O 4e
-- guarda a regressao.
-- Quando ele for corrigido, o esperado passa a ser 24 / 0.

\set ON_ERROR_STOP off
BEGIN;

DO $$
DECLARE
  u uuid; l uuid; l2 uuid; i uuid; i2 uuid; i3 uuid; iL2 uuid; ped uuid; anu uuid;
  ok int := 0; falhou int := 0;
  linhas int;
  guarda int;
  micros text;
  custoDepois numeric;
  vSku  text := 'PROVA-'||substr(gen_random_uuid()::text,1,8);
  vSku2 text := 'PROVA-'||substr(gen_random_uuid()::text,1,8);
  vSku3 text := 'PROVA-'||substr(gen_random_uuid()::text,1,8);
  vSkuL2 text := 'PROVA-'||substr(gen_random_uuid()::text,1,8);
  -- Instante com microssegundos, igual ao que `now()` grava (provado em 4d).
  vCarimbo timestamp := '2026-08-11 14:22:33.123456';
BEGIN
  -- ---------------------------- seed ----------------------------
  INSERT INTO "user" (name, email, papel)
    VALUES ('Anderson', 'teste'||substr(gen_random_uuid()::text,1,8)||'@prova.local', 'administrador')
    RETURNING id INTO u;

  INSERT INTO lotes (nome, segmento, data_arremate, custo_total, modified_by)
    VALUES ('Lote Oftalmo 01', 'oftalmologia', '2026-08-01', 12000.00, u) RETURNING id INTO l;
  INSERT INTO lotes (nome, segmento, data_arremate, custo_total, modified_by)
    VALUES ('Lote Odonto 02', 'odontologia', '2026-08-02', 8000.00, u) RETURNING id INTO l2;

  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES (vSku, 'Lampada de fenda', l, 'oftalmologia', 3300.00, u) RETURNING id INTO i;
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES (vSku2, 'Tonometro', l, 'oftalmologia', 1800.00, u) RETURNING id INTO i2;
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES (vSkuL2, 'Cadeira odontologica', l2, 'odontologia', 2500.00, u) RETURNING id INTO iL2;

  -- ==========================================================================
  -- 1) LOTE COM ITEM ATIVO NAO PODE SER EXCLUIDO (RN-122)
  --    `excluirLote` em lotes-mutacoes.ts:178-184
  -- ==========================================================================

  -- 1a) o banco DEIXA passar: soft delete nao dispara a FK de itens.lote_id.
  --     E por isso que a regra precisa existir na action.
  UPDATE lotes SET is_deleted = true, deleted_at = now() WHERE id = l2;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  IF linhas = 1 AND (SELECT is_deleted FROM itens WHERE id = iL2) = false THEN
    RAISE NOTICE 'OK     1a) o BANCO exclui o lote e deixa o item orfao (FK intacta) — a regra e so da action';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 1a) o banco bloqueou sozinho — reescreva esta prova, a premissa mudou';
    falhou := falhou + 1;
  END IF;
  UPDATE lotes SET is_deleted = false, deleted_at = NULL WHERE id = l2;  -- desfaz

  -- 1b) a guarda da action conta os itens ATIVOS do lote.
  SELECT count(*)::int INTO guarda FROM itens WHERE lote_id = l2 AND is_deleted = false;
  IF guarda = 1 THEN
    RAISE NOTICE 'OK     1b) guarda de excluirLote: % item(ns) ativo(s) -> RECUSA', guarda;
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 1b) guarda contou % — deveria contar 1', guarda;
    falhou := falhou + 1;
  END IF;

  -- 1c) item excluido logicamente para de contar: o lote libera.
  UPDATE itens SET is_deleted = true, deleted_at = now(), updated_at = now() WHERE id = iL2;
  SELECT count(*)::int INTO guarda FROM itens WHERE lote_id = l2 AND is_deleted = false;
  IF guarda = 0 THEN
    RAISE NOTICE 'OK     1c) com o item excluido, a guarda zera -> o lote PODE ser excluido';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 1c) guarda ainda conta % apos exclusao logica do item', guarda;
    falhou := falhou + 1;
  END IF;

  -- 1d) item de OUTRO lote nao interfere (a guarda filtra por lote_id).
  SELECT count(*)::int INTO guarda FROM itens WHERE lote_id = l AND is_deleted = false;
  IF guarda = 2 THEN
    RAISE NOTICE 'OK     1d) a guarda e por lote: o lote vizinho segue com 2 itens';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 1d) contagem vazou entre lotes (% no lote vizinho)', guarda;
    falhou := falhou + 1;
  END IF;

  -- ==========================================================================
  -- 2) ITEM COM PEDIDO NAO PODE SER EXCLUIDO (RN-122)
  --    `excluirItem` em estoque-mutacoes.ts:197-204
  -- ==========================================================================
  INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda,
                       valor, taxa, comissao, liquido, modified_by)
    VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), i, 'mercado_livre', now(),
            3300.00, 5900, 826, 236, 4838, u)
    RETURNING id INTO ped;

  -- 2a) o banco DEIXA excluir logicamente o item, com a venda apontando p/ ele.
  UPDATE itens SET is_deleted = true, deleted_at = now() WHERE id = i;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  IF linhas = 1 AND (SELECT is_deleted FROM pedidos WHERE id = ped) = false THEN
    RAISE NOTICE 'OK     2a) o BANCO some com o item e a venda fica apontando para o vazio';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 2a) o banco bloqueou sozinho — premissa da prova mudou';
    falhou := falhou + 1;
  END IF;
  UPDATE itens SET is_deleted = false, deleted_at = NULL WHERE id = i;  -- desfaz

  -- 2b) a guarda conta o pedido ativo.
  SELECT count(*)::int INTO guarda FROM pedidos WHERE item_id = i AND is_deleted = false;
  IF guarda = 1 THEN
    RAISE NOTICE 'OK     2b) guarda de excluirItem: % pedido -> RECUSA', guarda;
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 2b) guarda contou % pedidos — deveria contar 1', guarda;
    falhou := falhou + 1;
  END IF;

  -- 2c) pedido CANCELADO continua protegendo: a venda existiu, gerou taxa e
  --     talvez NF-e. A guarda nao filtra status, e esta certo assim.
  UPDATE pedidos SET status = 'cancelado', updated_at = now() WHERE id = ped;
  SELECT count(*)::int INTO guarda FROM pedidos WHERE item_id = i AND is_deleted = false;
  IF guarda = 1 THEN
    RAISE NOTICE 'OK     2c) pedido CANCELADO ainda bloqueia a exclusao (historico preservado)';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 2c) cancelar o pedido liberou a exclusao do item';
    falhou := falhou + 1;
  END IF;
  UPDATE pedidos SET status = 'aguardando_envio', updated_at = now() WHERE id = ped;

  -- 2d) ⚠️ COMPORTAMENTO, nao regra confirmada: pedido excluido LOGICAMENTE
  --     para de proteger, porque a guarda filtra `is_deleted = false`. O item
  --     entao some, e sobra um pedido (logicamente excluido) apontando para
  --     ele. Registrado para a decisao do Anderson, nao para conserto silencioso.
  UPDATE pedidos SET is_deleted = true, deleted_at = now(), updated_at = now() WHERE id = ped;
  SELECT count(*)::int INTO guarda FROM pedidos WHERE item_id = i AND is_deleted = false;
  IF guarda = 0 THEN
    RAISE NOTICE 'OK     2d) pedido excluido logicamente PARA de proteger o item (comportamento atual)';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 2d) esperava que a guarda zerasse com o pedido excluido';
    falhou := falhou + 1;
  END IF;
  UPDATE pedidos SET is_deleted = false, deleted_at = NULL, updated_at = now() WHERE id = ped;

  -- ==========================================================================
  -- 3) ITEM COM ANUNCIO NO AR NAO PODE SER EXCLUIDO (RN-122)
  --    `excluirItem` em estoque-mutacoes.ts:206-215
  --    Excluir aqui NAO tira o anuncio do canal.
  -- ==========================================================================
  INSERT INTO anuncios (item_id, canal, preco, status, modified_by)
    VALUES (i2, 'mercado_livre', 5900.00, 'no_ar', u) RETURNING id INTO anu;

  -- 3a) 'no_ar' bloqueia.
  SELECT count(*)::int INTO guarda FROM anuncios
    WHERE item_id = i2 AND is_deleted = false AND status <> 'pausado';
  IF guarda = 1 THEN
    RAISE NOTICE 'OK     3a) anuncio no_ar: guarda conta % -> RECUSA', guarda;
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 3a) anuncio no ar nao foi contado pela guarda';
    falhou := falhou + 1;
  END IF;

  -- 3b) 'negociando' TAMBEM bloqueia — e o estado mais perigoso dos tres, tem
  --     comprador conversando do outro lado.
  UPDATE anuncios SET status = 'negociando', updated_at = now() WHERE id = anu;
  SELECT count(*)::int INTO guarda FROM anuncios
    WHERE item_id = i2 AND is_deleted = false AND status <> 'pausado';
  IF guarda = 1 THEN
    RAISE NOTICE 'OK     3b) anuncio NEGOCIANDO tambem bloqueia';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 3b) anuncio negociando escapou da guarda — item some com negociacao aberta';
    falhou := falhou + 1;
  END IF;

  -- 3c) 'pausado' NAO bloqueia — e a saida prevista: pause, depois exclua.
  UPDATE anuncios SET status = 'pausado', updated_at = now() WHERE id = anu;
  SELECT count(*)::int INTO guarda FROM anuncios
    WHERE item_id = i2 AND is_deleted = false AND status <> 'pausado';
  IF guarda = 0 THEN
    RAISE NOTICE 'OK     3c) com o anuncio PAUSADO a guarda zera -> exclusao liberada';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 3c) anuncio pausado ainda bloqueia — o operador fica sem saida';
    falhou := falhou + 1;
  END IF;

  -- 3d) o banco DEIXA excluir o item com o anuncio no ar.
  UPDATE anuncios SET status = 'no_ar', updated_at = now() WHERE id = anu;
  UPDATE itens SET is_deleted = true, deleted_at = now() WHERE id = i2;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  IF linhas = 1 AND (SELECT status FROM anuncios WHERE id = anu)::text = 'no_ar' THEN
    RAISE NOTICE 'OK     3d) o BANCO exclui o item e o anuncio continua no_ar — a peca segue a venda';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 3d) premissa mudou: o banco passou a bloquear';
    falhou := falhou + 1;
  END IF;
  UPDATE itens SET is_deleted = false, deleted_at = NULL WHERE id = i2;  -- desfaz

  -- ==========================================================================
  -- 4) OPTIMISTIC LOCKING (CLAUDE.md, "Controle de Colisao")
  --    `atualizarLote` em lotes-mutacoes.ts:118-130
  -- ==========================================================================

  -- 4d) primeiro a PREMISSA: `now()` grava MICROSSEGUNDOS neste banco, e a
  --     coluna e timestamp(6). Todo lote criado por `criarLote` nasce assim,
  --     porque `updated_at` usa DEFAULT now().
  SELECT to_char(updated_at, 'US') INTO micros FROM lotes WHERE id = l;
  IF micros <> '000000' THEN
    RAISE NOTICE 'OK     4d) lote recem-criado tem microssegundos em updated_at (.%)', micros;
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 4d) now() nao trouxe microssegundos — 4c fica sem premissa';
    falhou := falhou + 1;
  END IF;

  -- Carimbo deterministico com microssegundos, no lugar do valor de now().
  UPDATE lotes SET updated_at = vCarimbo WHERE id = l;

  -- 4a) `updated_at` DEFASADO: a segunda gravacao tem que ser recusada.
  UPDATE lotes SET nome = 'Alterado pelo 2o usuario', updated_at = now(), modified_by = u
    WHERE id = l AND updated_at = vCarimbo - interval '1 minute' AND is_deleted = false;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  IF linhas = 0 AND (SELECT nome FROM lotes WHERE id = l) = 'Lote Oftalmo 01' THEN
    RAISE NOTICE 'OK     4a) UPDATE com updated_at defasado afetou 0 linhas — 2a gravacao RECUSADA';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 4a) o UPDATE defasado afetou % linha(s) — sobrescreveu em silencio!', linhas;
    falhou := falhou + 1;
  END IF;

  -- 4b) `updated_at` EXATO (ao microssegundo): a gravacao passa. Prova que o
  --     mecanismo esta certo — o problema do 4c e o VALOR que chega ate aqui.
  UPDATE lotes SET nome = 'Alterado pelo 1o usuario', updated_at = now(), modified_by = u
    WHERE id = l AND updated_at = vCarimbo AND is_deleted = false;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  IF linhas = 1 THEN
    RAISE NOTICE 'OK     4b) UPDATE com o updated_at exato afetou 1 linha — gravacao ACEITA';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 4b) nem com o valor exato o UPDATE passou';
    falhou := falhou + 1;
  END IF;

  -- 4c) 🔴 O VALOR QUE A ACTION REALMENTE ENVIA.
  --
  --     `atualizadoEm` sai do banco e volta como Date do JS, que so tem
  --     MILISSEGUNDOS. O drizzle manda `.toISOString()` no WHERE, entao os
  --     microssegundos sao cortados no caminho. Simulado aqui com
  --     date_trunc('milliseconds', ...). Ver o teste puro em
  --     src/lib/actions/travamento-otimista.test.ts, que prova o corte.
  UPDATE lotes SET updated_at = vCarimbo WHERE id = l;
  UPDATE lotes SET nome = 'Edicao legitima do dono', updated_at = now(), modified_by = u
    WHERE id = l
      AND updated_at::text = vCarimbo::text
      AND is_deleted = false;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  IF linhas = 1 THEN
    RAISE NOTICE 'OK     4c) edicao legitima ACEITA — o carimbo vai e volta como texto exato';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 4c) a edicao LEGITIMA foi recusada — o optimistic locking';
    RAISE NOTICE '           voltou a recusar quem nao colidiu com ninguem.';
    falhou := falhou + 1;
  END IF;

  -- 4e) GUARDA DE REGRESSAO: o valor truncado a MILISSEGUNDOS — que e o que um
  --     `Date` do JS produz — NAO pode casar. Foi exatamente assim que o bug
  --     nasceu: a action mandava `new Date(carimbo)` e o WHERE procurava um
  --     instante que nao existe.
  --
  --     Se este caso um dia passar a casar, alguem trocou a coluna para
  --     `timestamp(3)` ou pos trigger de arredondamento — e ai o motivo da
  --     comparacao por ::text deixou de existir. Reavalie antes de simplificar.
  UPDATE lotes SET updated_at = vCarimbo WHERE id = l;
  UPDATE lotes SET nome = 'Nao deveria gravar', updated_at = now(), modified_by = u
    WHERE id = l
      AND updated_at::text = date_trunc('milliseconds', vCarimbo)::text
      AND is_deleted = false;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  IF linhas = 0 THEN
    RAISE NOTICE 'OK     4e) carimbo truncado a ms NAO casa — por isso a comparacao e por texto';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 4e) o truncado casou: a coluna perdeu os microssegundos?';
    falhou := falhou + 1;
  END IF;
  UPDATE lotes SET nome = 'Lote Oftalmo 01', updated_at = now() WHERE id = l;

  -- ==========================================================================
  -- 5) AUDITORIA NA MESMA TRANSACAO DA MUTACAO
  --    `registrarAuditoria` recebe `tx` (audit/logger.ts:68)
  -- ==========================================================================

  -- 5a) mutacao que FALHA nao pode deixar linha de auditoria para tras.
  --     O bloco BEGIN/EXCEPTION do PL/pgSQL e um savepoint: e exatamente a
  --     semantica de `db.transaction` do drizzle quando a callback lanca.
  BEGIN
    INSERT INTO auditoria (user_id, acao, tabela, registro_id, detalhes)
      VALUES (u, 'criar', 'itens', i, 'PROVA-5A: auditoria gravada antes da falha');
    -- a mutacao estoura DEPOIS da auditoria (SKU duplicado, o caso real)
    INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
      VALUES (vSku, 'Duplicata', l, 'oftalmologia', 100.00, u);
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- a action devolveria { ok: false, erro: "Ja existe um item ativo..." }
  END;
  SELECT count(*)::int INTO guarda FROM auditoria WHERE detalhes LIKE 'PROVA-5A:%';
  IF guarda = 0 THEN
    RAISE NOTICE 'OK     5a) mutacao falhou -> a linha de auditoria sumiu junto (mesma transacao)';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 5a) sobrou % linha(s) de auditoria de uma mutacao que nao aconteceu', guarda;
    falhou := falhou + 1;
  END IF;

  -- 5b) e o contraprova: mutacao que da certo DEIXA o rastro.
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES (vSku3, 'Retinografo', l, 'oftalmologia', 4200.00, u) RETURNING id INTO i3;
  INSERT INTO auditoria (user_id, acao, tabela, registro_id, detalhes)
    VALUES (u, 'criar', 'itens', i3, 'PROVA-5B: cadastrou o item '||vSku3);
  SELECT count(*)::int INTO guarda FROM auditoria WHERE registro_id = i3;
  IF guarda = 1 THEN
    RAISE NOTICE 'OK     5b) mutacao ok -> a trilha ficou (1 linha para o item novo)';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 5b) mutacao com sucesso nao registrou auditoria';
    falhou := falhou + 1;
  END IF;

  -- ==========================================================================
  -- 6) CUSTO DE ITEM VENDIDO NAO MUDA (RN-122)
  --    `atualizarItem` em estoque-mutacoes.ts:130-132
  -- ==========================================================================
  UPDATE itens SET situacao = 'vendido', updated_at = now() WHERE id = i;

  -- 6a) o banco DEIXA mudar. Nao ha check nem trigger: a regra e so da action.
  UPDATE itens SET custo = 9999.00, updated_at = now() WHERE id = i;
  SELECT custo INTO custoDepois FROM itens WHERE id = i;
  IF custoDepois = 9999.00 THEN
    RAISE NOTICE 'OK     6a) o BANCO troca o custo de item VENDIDO sem reclamar — a regra e so da action';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 6a) premissa mudou: o banco passou a impedir';
    falhou := falhou + 1;
  END IF;
  UPDATE itens SET custo = 3300.00, updated_at = now() WHERE id = i;

  -- 6b) a condicao da action identifica o caso.
  IF (SELECT situacao::text = 'vendido' AND custo::text <> '4100.00' FROM itens WHERE id = i) THEN
    RAISE NOTICE 'OK     6b) condicao da action (vendido + custo diferente) pega o caso -> RECUSA';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 6b) a condicao da action nao reconhece o item vendido';
    falhou := falhou + 1;
  END IF;

  -- 6c) ⚠️ a action compara TEXTO, e o banco compara NUMERO. Para o Postgres
  --     3300 e 3300.00 sao o mesmo valor; para `String(antes.custo) !==
  --     validado.data.custo` sao strings diferentes. Quem redigitar "3300"
  --     leva "o custo nao pode ser alterado" sem ter alterado nada.
  IF (SELECT custo = 3300 FROM itens WHERE id = i)
     AND (SELECT custo::text FROM itens WHERE id = i) <> '3300' THEN
    RAISE NOTICE 'OK     6c) confirmado: banco diz 3300 = %, e o texto e diferente -> a action se engana',
                 (SELECT custo::text FROM itens WHERE id = i);
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 6c) nao reproduzi a divergencia texto x numero';
    falhou := falhou + 1;
  END IF;
  UPDATE itens SET situacao = 'sem_anuncio', updated_at = now() WHERE id = i;

  -- ==========================================================================
  -- 7) SKU: UNICO ENTRE ATIVOS, E EXCLUSAO LOGICA LIBERA
  --    indice parcial `idx_itens_sku_ativo` (schema/itens.ts)
  -- ==========================================================================

  -- 7a) duplicado entre ativos: bloqueado pelo BANCO (aqui a regra e do banco).
  BEGIN
    INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
      VALUES (vSku3, 'Clone', l, 'oftalmologia', 100.00, u);
    RAISE NOTICE 'FALHOU 7a) SKU duplicado entre itens ativos: PASSOU';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK     7a) SKU duplicado entre ativos: BLOQUEADO (indice parcial)';
    ok := ok + 1;
  END;

  -- 7b) apos a exclusao logica, o SKU volta a ficar livre (efeito colateral
  --     conhecido do soft delete, em known-issues).
  UPDATE itens SET is_deleted = true, deleted_at = now(), updated_at = now() WHERE id = i3;
  BEGIN
    INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
      VALUES (vSku3, 'Retinografo (recadastro)', l, 'oftalmologia', 4200.00, u);
    RAISE NOTICE 'OK     7b) item excluido libera o SKU para novo cadastro';
    ok := ok + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'FALHOU 7b) SKU ficou preso ao item excluido (unique global?)';
    falhou := falhou + 1;
  END;

  -- 7c) reativar o excluido com o SKU ja retomado tem que COLIDIR. E o caso
  --     "excluiu por engano e quer voltar atras" — a action precisa tratar
  --     23505 aqui, e hoje nao ha caminho de reativacao no painel.
  BEGIN
    UPDATE itens SET is_deleted = false, deleted_at = NULL, updated_at = now() WHERE id = i3;
    RAISE NOTICE 'FALHOU 7c) reativou criando 2 itens ativos com o mesmo SKU';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK     7c) reativar com o SKU ja tomado: BLOQUEADO (tratar na UI)';
    ok := ok + 1;
  END;

  RAISE NOTICE '-----------------------------------------';
  RAISE NOTICE 'RESULTADO: % passaram, % falharam', ok, falhou;
  RAISE NOTICE '(esperado hoje: 23 passaram, 1 falhou — o 4c e bug aberto)';
END $$;

ROLLBACK;

-- Confirma que nada sobrou.
SELECT 'lotes' AS tabela, count(*) FROM lotes
UNION ALL SELECT 'itens', count(*) FROM itens
UNION ALL SELECT 'anuncios', count(*) FROM anuncios
UNION ALL SELECT 'pedidos', count(*) FROM pedidos
UNION ALL SELECT 'auditoria', count(*) FROM auditoria;
