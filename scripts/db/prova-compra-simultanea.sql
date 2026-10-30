-- Prova da trava de COMPRA SIMULTANEA (RN-112, ADR-0002). Roda em transacao,
-- faz ROLLBACK.
--
-- Uso: docker exec -i mmsolues-db-1 psql -U dev -d mmsolucoes_dev < scripts/db/prova-compra-simultanea.sql
--
-- Modelo com quantidade: cada venda grava o pedido E baixa `itens.quantidade`
-- no mesmo commit (e o que o handler de venda faz). A trava e o
-- `CHECK (quantidade >= 0)`: vender unidade que nao existe leva a -1 e o banco
-- recusa (check_violation, 23514).
-- Esperado: 6 passaram, 0 falharam.
\set ON_ERROR_STOP off
BEGIN;

DO $$
DECLARE
  u uuid; l uuid; unica uuid; rele uuid;
  ok int := 0; falhou int := 0;
  pedido_ml uuid;
BEGIN
  INSERT INTO "user" (name, email, papel)
    VALUES ('Anderson', 'teste'||substr(gen_random_uuid()::text,1,8)||'@prova.local', 'administrador') RETURNING id INTO u;
  INSERT INTO lotes (nome, segmento, data_arremate, custo_total, modified_by)
    VALUES ('Lote Prova', 'automotivo', '2026-08-01', 12000.00, u) RETURNING id INTO l;

  -- peca unica (quantidade padrao = 1) e um item de 2 unidades
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES ('PROVA-'||substr(gen_random_uuid()::text,1,8), 'Lampada de fenda', l, 'oftalmologia', 3300.00, u)
    RETURNING id INTO unica;
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, quantidade, modified_by)
    VALUES ('PROVA-'||substr(gen_random_uuid()::text,1,8), 'Rele pisca', l, 'automotivo', 10.00, 2, u)
    RETURNING id INTO rele;

  -- ---------- 1) peca unica: a 1a venda (ML) grava e zera ----------
  INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
    VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), unica, 'mercado_livre', now(), 3300.00, 5900, 826, 236, 4838, u)
    RETURNING id INTO pedido_ml;
  UPDATE itens SET quantidade = quantidade - 1 WHERE id = unica;
  IF (SELECT quantidade FROM itens WHERE id = unica) = 0 THEN
    RAISE NOTICE 'OK  1) peca unica: 1a venda registrada, quantidade foi a 0';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 1) baixa da peca unica nao zerou';
    falhou := falhou + 1;
  END IF;

  -- ---------- 2) peca unica: a 2a venda (OLX) esbarra no CHECK ----------
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES ('OLX-'||substr(gen_random_uuid()::text,1,8), unica, 'olx', now(), 3300.00, 5700, 285, 228, 5187, u);
    UPDATE itens SET quantidade = quantidade - 1 WHERE id = unica;
    RAISE NOTICE 'FALHOU 2) VENDEU A MESMA PECA DUAS VEZES — trava ausente!';
    falhou := falhou + 1;
  EXCEPTION WHEN check_violation THEN
    -- o bloco desfaz o INSERT do pedido junto: nada fica gravado pela metade
    RAISE NOTICE 'OK  2) 2a venda da peca unica em outro canal: BLOQUEADA (e o pedido nao ficou)';
    ok := ok + 1;
  END;

  -- ---------- 3) item de 2 unidades: duas vendas passam ----------
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), rele, 'mercado_livre', now(), 10.00, 26, 4, 1, 21, u);
    UPDATE itens SET quantidade = quantidade - 1 WHERE id = rele;
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES ('OLX-'||substr(gen_random_uuid()::text,1,8), rele, 'olx', now(), 10.00, 26, 1, 1, 24, u);
    UPDATE itens SET quantidade = quantidade - 1 WHERE id = rele;
    RAISE NOTICE 'OK  3) 2 unidades: duas vendas do mesmo item PASSARAM (o indice antigo recusaria)';
    ok := ok + 1;
  EXCEPTION WHEN unique_violation OR check_violation THEN
    RAISE NOTICE 'FALHOU 3) segunda venda legitima de item com 2 unidades foi recusada';
    falhou := falhou + 1;
  END;

  -- ---------- 4) ... e a terceira, sem unidade, e recusada ----------
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), rele, 'mercado_livre', now(), 10.00, 26, 4, 1, 21, u);
    UPDATE itens SET quantidade = quantidade - 1 WHERE id = rele;
    RAISE NOTICE 'FALHOU 4) vendeu a 3a unidade de um item que tinha 2';
    falhou := falhou + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK  4) 3a venda de item com 2 unidades: BLOQUEADA';
    ok := ok + 1;
  END;

  -- ---------- 5) pedido de zero unidades nao existe ----------
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, quantidade, modified_by)
      VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), rele, 'mercado_livre', now(), 0, 0, 0, 0, 0, 0, u);
    RAISE NOTICE 'FALHOU 5) aceitou pedido com quantidade 0';
    falhou := falhou + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK  5) pedido com quantidade 0: RECUSADO';
    ok := ok + 1;
  END;

  -- ---------- 6) o pedido cancelado CONTINUA no banco (nao virou exclusao) ----
  UPDATE pedidos SET status = 'cancelado' WHERE id = pedido_ml;
  IF (SELECT count(*) FROM pedidos WHERE item_id = unica) = 1
     AND (SELECT status FROM pedidos WHERE id = pedido_ml)::text = 'cancelado'
     AND (SELECT is_deleted FROM pedidos WHERE id = pedido_ml) = false THEN
    RAISE NOTICE 'OK  6) pedido cancelado permanece no relatorio (nao foi excluido)';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 6) cancelamento sumiu com o pedido do relatorio';
    falhou := falhou + 1;
  END IF;

  RAISE NOTICE '-----------------------------------------';
  RAISE NOTICE 'RESULTADO: % passaram, % falharam', ok, falhou;
END $$;

ROLLBACK;
