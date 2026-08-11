-- Prova da trava de COMPRA SIMULTANEA (RN-112). Roda em transacao, faz ROLLBACK.
--
-- Uso: docker exec -i mmsolues-db-1 psql -U dev -d mmsolucoes_dev < scripts/db/prova-compra-simultanea.sql
--
-- Cenario: o mesmo item unico esta anunciado no ML e na OLX. Dois compradores
-- fecham no mesmo instante. So existe UMA peca.
-- Esperado: 5 passaram, 0 falharam.
\set ON_ERROR_STOP off
BEGIN;

DO $$
DECLARE
  u uuid; l uuid; i uuid;
  ok int := 0; falhou int := 0;
  pedido_ml uuid;
  vOlx text := 'OLX-'||substr(gen_random_uuid()::text,1,8);
BEGIN
  INSERT INTO "user" (name, email, papel)
    VALUES ('Anderson', 'teste'||substr(gen_random_uuid()::text,1,8)||'@prova.local', 'administrador') RETURNING id INTO u;
  INSERT INTO lotes (nome, segmento, data_arremate, custo_total, modified_by)
    VALUES ('Lote Oftalmo 01', 'oftalmologia', '2026-08-01', 12000.00, u) RETURNING id INTO l;
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES ('PROVA-'||substr(gen_random_uuid()::text,1,8), 'Lampada de fenda', l, 'oftalmologia', 3300.00, u) RETURNING id INTO i;

  -- o MESMO item anunciado em dois canais (situacao normal do negocio)
  INSERT INTO anuncios (item_id, canal, preco, modified_by) VALUES (i, 'mercado_livre', 5900, u);
  INSERT INTO anuncios (item_id, canal, preco, modified_by) VALUES (i, 'olx', 5700, u);

  -- ---------- 1) comprador do ML fecha primeiro ----------
  INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
    VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), i, 'mercado_livre', now(), 3300.00, 5900, 826, 236, 4838, u)
    RETURNING id INTO pedido_ml;
  RAISE NOTICE 'OK  1) 1a venda (ML) registrada';
  ok := ok + 1;

  -- ---------- 2) comprador da OLX fecha o MESMO item ----------
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES (vOlx, i, 'olx', now(), 3300.00, 5700, 285, 228, 5187, u);
    RAISE NOTICE 'FALHOU 2) VENDEU A MESMA PECA DUAS VEZES — trava ausente!';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK  2) 2a venda do mesmo item em outro canal: BLOQUEADA';
    ok := ok + 1;
  END;

  -- ---------- 3) nem mesmo no mesmo canal ----------
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), i, 'mercado_livre', now(), 3300.00, 5900, 826, 236, 4838, u);
    RAISE NOTICE 'FALHOU 3) 2o pedido do mesmo item no mesmo canal PASSOU';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK  3) 2o pedido do mesmo item no mesmo canal: BLOQUEADO';
    ok := ok + 1;
  END;

  -- ---------- 4) cancelar libera o item para revenda ----------
  UPDATE pedidos SET status = 'cancelado' WHERE id = pedido_ml;
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES (vOlx, i, 'olx', now(), 3300.00, 5700, 285, 228, 5187, u);
    RAISE NOTICE 'OK  4) apos cancelamento, o item volta a poder ser vendido';
    ok := ok + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'FALHOU 4) item ficou preso apos cancelamento — nao da para revender';
    falhou := falhou + 1;
  END;

  -- ---------- 5) o pedido cancelado CONTINUA no banco (nao virou exclusao) ----
  IF (SELECT count(*) FROM pedidos WHERE item_id = i) = 2
     AND (SELECT status FROM pedidos WHERE id = pedido_ml)::text = 'cancelado'
     AND (SELECT is_deleted FROM pedidos WHERE id = pedido_ml) = false THEN
    RAISE NOTICE 'OK  5) pedido cancelado permanece no relatorio (nao foi excluido)';
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 5) cancelamento sumiu com o pedido do relatorio';
    falhou := falhou + 1;
  END IF;

  RAISE NOTICE '-----------------------------------------';
  RAISE NOTICE 'RESULTADO: % passaram, % falharam', ok, falhou;
END $$;

ROLLBACK;
