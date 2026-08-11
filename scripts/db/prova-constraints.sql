-- Prova de comportamento das constraints do banco (roda em transacao, faz ROLLBACK).
--
-- Uso:  docker exec -i mmsolues-db-1 psql -U dev -d mmsolucoes_dev < scripts/db/prova-constraints.sql
--
-- Verifica no BANCO (nao no SQL da migracao) que: email e case-insensitive,
-- soft delete libera email/SKU, um anuncio por item por canal, webhook de
-- pedido e idempotente mesmo apos exclusao, FK RESTRICT protege usuario,
-- reentrega de pergunta nao duplica e NULL em id_externo nao colide.
-- Esperado: 12 passaram, 0 falharam. Rode depois de toda migracao nova.

\set ON_ERROR_STOP off
BEGIN;

DO $$
DECLARE
  u uuid; l uuid; i uuid; i2 uuid;
  ok int := 0; falhou int := 0;
  msg text;
  vEmail text := 'teste'||substr(gen_random_uuid()::text,1,8)||'@prova.local';
  vEmailMaiusc text;
  vSku1 text := 'PROVA-'||substr(gen_random_uuid()::text,1,8);
  vSku2 text := 'PROVA-'||substr(gen_random_uuid()::text,1,8);
  vNumPedido text := 'PV-'||substr(gen_random_uuid()::text,1,8);
  vQid text := 'Q-'||substr(gen_random_uuid()::text,1,8);
BEGIN
  vEmailMaiusc := upper(left(vEmail,1))||substr(vEmail,2);
  -- ---------- seed minimo ----------
  INSERT INTO usuarios (nome, email, papel, modified_by)
    VALUES ('Anderson', vEmailMaiusc, 'administrador', gen_random_uuid())
    RETURNING id INTO u;
  INSERT INTO lotes (nome, segmento, data_arremate, custo_total, modified_by)
    VALUES ('Lote Oftalmo 01', 'oftalmologia', '2026-08-01', 12000.00, u)
    RETURNING id INTO l;
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES (vSku1, 'Lampada de fenda', l, 'oftalmologia', 3300.00, u)
    RETURNING id INTO i;
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES (vSku2, 'Tonometro', l, 'oftalmologia', 1800.00, u)
    RETURNING id INTO i2;

  -- ---------- 1) email case-insensitive ----------
  BEGIN
    INSERT INTO usuarios (nome, email, papel, modified_by)
      VALUES ('Anderson (2a conta)', vEmail, 'operador', u);
    RAISE NOTICE 'FALHOU  1) email so difere no case: DEIXOU criar 2a conta ativa';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK      1) email so difere no case: BLOQUEADO (lower(email))';
    ok := ok + 1;
  END;

  -- ---------- 2) soft delete libera o email ----------
  UPDATE usuarios SET is_deleted = true, deleted_at = now() WHERE id = u;
  BEGIN
    INSERT INTO usuarios (nome, email, papel, modified_by)
      VALUES ('Anderson recadastrado', vEmail, 'administrador', u);
    RAISE NOTICE 'OK      2) apos soft delete, o email volta a ficar livre';
    ok := ok + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'FALHOU  2) email preso apos exclusao logica (unique global?)';
    falhou := falhou + 1;
  END;
  -- 2b) REATIVAR o excluido enquanto o recadastrado esta ativo tem que COLIDIR.
  -- E o caso operacional real: "excluiu por engano, quer voltar atras".
  BEGIN
    UPDATE usuarios SET is_deleted = false, deleted_at = NULL WHERE id = u;
    RAISE NOTICE 'FALHOU 2b) reativou criando 2 contas ativas com o mesmo email';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK     2b) reativar com email ja tomado: BLOQUEADO (tratar na UI)';
    ok := ok + 1;
  END;
  -- limpa o recadastrado e so entao reativa o original
  DELETE FROM usuarios WHERE email = vEmail AND id <> u;
  UPDATE usuarios SET is_deleted = false, deleted_at = NULL WHERE id = u;

  -- ---------- 3) SKU duplicado entre itens ativos ----------
  BEGIN
    INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
      VALUES (vSku1, 'Duplicata', l, 'oftalmologia', 100.00, u);
    RAISE NOTICE 'FALHOU  3) SKU duplicado entre ativos: DEIXOU passar';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK      3) SKU duplicado entre ativos: BLOQUEADO';
    ok := ok + 1;
  END;

  -- ---------- 4) um anuncio por item por canal ----------
  INSERT INTO anuncios (item_id, canal, preco, modified_by)
    VALUES (i, 'mercado_livre', 5900.00, u);
  BEGIN
    INSERT INTO anuncios (item_id, canal, preco, modified_by)
      VALUES (i, 'mercado_livre', 6100.00, u);
    RAISE NOTICE 'FALHOU  4) 2o anuncio ativo do mesmo item no mesmo canal: PASSOU';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK      4) 2o anuncio no mesmo canal: BLOQUEADO (RN-104)';
    ok := ok + 1;
  END;
  -- o mesmo item em OUTRO canal tem que passar
  BEGIN
    INSERT INTO anuncios (item_id, canal, preco, modified_by)
      VALUES (i, 'olx', 5700.00, u);
    RAISE NOTICE 'OK      4b) mesmo item em outro canal: PERMITIDO';
    ok := ok + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'FALHOU  4b) bloqueou anuncio do mesmo item em canal diferente';
    falhou := falhou + 1;
  END;

  -- ---------- 5) idempotencia do pedido (RN-104) ----------
  INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
    VALUES (vNumPedido, i, 'mercado_livre', now(), 3300.00, 5900, 826, 236, 4838, u);
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES (vNumPedido, i, 'mercado_livre', now(), 3300.00, 5900, 826, 236, 4838, u);
    RAISE NOTICE 'FALHOU  5) webhook reprocessado: DUPLICOU o pedido';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK      5) webhook reprocessado: BLOQUEADO (canal, numero)';
    ok := ok + 1;
  END;

  -- ---------- 6) pedido EXCLUIDO nao pode ser recriado ----------
  UPDATE pedidos SET is_deleted = true, deleted_at = now() WHERE numero = vNumPedido;
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda, valor, taxa, comissao, liquido, modified_by)
      VALUES (vNumPedido, i, 'mercado_livre', now(), 3300.00, 5900, 826, 236, 4838, u);
    RAISE NOTICE 'FALHOU  6) pedido excluido: webhook RECRIOU a venda (unique parcial?)';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK      6) pedido excluido: numero segue reservado (unique GLOBAL)';
    ok := ok + 1;
  END;

  -- ---------- 7) FK RESTRICT protege o usuario ----------
  BEGIN
    DELETE FROM usuarios WHERE id = u;
    RAISE NOTICE 'FALHOU  7) DELETE fisico de usuario com registros: PASSOU';
    falhou := falhou + 1;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'OK      7) DELETE de usuario com registros: BLOQUEADO (RESTRICT)';
    ok := ok + 1;
  END;

  -- ---------- 8) idempotencia da pergunta (id_externo) ----------
  INSERT INTO perguntas (canal, id_externo, item_id, texto, prazo_sla, modified_by)
    VALUES ('mercado_livre', vQid, i, 'Tem nota fiscal?', now() + interval '4 hours', u);
  BEGIN
    INSERT INTO perguntas (canal, id_externo, item_id, texto, prazo_sla, modified_by)
      VALUES ('mercado_livre', vQid, i, 'Tem nota fiscal?', now() + interval '4 hours', u);
    RAISE NOTICE 'FALHOU  8) reentrega de pergunta: DUPLICOU';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK      8) reentrega de pergunta: BLOQUEADO (canal, id_externo)';
    ok := ok + 1;
  END;

  -- ---------- 9) NULL em id_externo nao colide ----------
  INSERT INTO perguntas (canal, id_externo, item_id, texto, prazo_sla, modified_by)
    VALUES ('whatsapp', NULL, i, 'Aceita retirada?', now() + interval '4 hours', u);
  BEGIN
    INSERT INTO perguntas (canal, id_externo, item_id, texto, prazo_sla, modified_by)
      VALUES ('whatsapp', NULL, i2, 'Tem garantia?', now() + interval '4 hours', u);
    RAISE NOTICE 'OK      9) duas perguntas de WhatsApp sem id_externo: PERMITIDO';
    ok := ok + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'FALHOU  9) NULL colidiu — WhatsApp so aceitaria 1 pergunta';
    falhou := falhou + 1;
  END;

  -- ---------- 10) auditoria e append-only por contrato ----------
  BEGIN
    INSERT INTO auditoria (user_id, acao, tabela, registro_id, detalhes)
      VALUES (u, 'criar', 'itens', i, 'Criou item MM-OFT-1401');
    RAISE NOTICE 'OK     10) auditoria aceita registro (user_id com FK)';
    ok := ok + 1;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    RAISE NOTICE 'FALHOU 10) auditoria recusou insert: %', msg;
    falhou := falhou + 1;
  END;

  RAISE NOTICE '-----------------------------------------';
  RAISE NOTICE 'RESULTADO: % passaram, % falharam', ok, falhou;
END $$;

ROLLBACK;

-- Confirma que nada sobrou.
SELECT 'usuarios' AS tabela, count(*) FROM usuarios
UNION ALL SELECT 'itens', count(*) FROM itens
UNION ALL SELECT 'pedidos', count(*) FROM pedidos
UNION ALL SELECT 'auditoria', count(*) FROM auditoria;
