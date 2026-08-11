-- Prova de que a venda CONGELA custo e data (RN-113). Transacao + ROLLBACK.
--
-- Uso: docker exec -i mmsolues-db-1 psql -U dev -d mmsolucoes_dev < scripts/db/prova-congelamento-venda.sql
--
-- O que se prova: corrigir o custo de um item DEPOIS da venda nao pode mexer na
-- margem de um mes ja fechado, e o mes fecha pela data em que a venda ACONTECEU,
-- nao pela data em que alguem digitou.
-- Esperado: 5 passaram, 0 falharam.
\set ON_ERROR_STOP off
BEGIN;

DO $$
DECLARE
  u uuid; l uuid; i uuid; p uuid;
  ok int := 0; falhou int := 0;
  custoOriginal numeric := 3300.00;
  custoCorrigido numeric := 4100.00;   -- rateio do lote revisado depois
  custoGravado numeric;
  margemAntes numeric; margemDepois numeric;
  vendaEm timestamp := '2026-03-18 14:22:00';  -- venda de MARCO
  digitadoEm timestamp;
BEGIN
  INSERT INTO "user" (name, email, papel)
    VALUES ('Anderson', 'teste'||substr(gen_random_uuid()::text,1,8)||'@prova.local',
            'administrador') RETURNING id INTO u;
  INSERT INTO lotes (nome, segmento, data_arremate, custo_total, modified_by)
    VALUES ('Lote Oftalmo', 'oftalmologia', '2026-02-10', 12000.00, u) RETURNING id INTO l;
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES ('PROVA-'||substr(gen_random_uuid()::text,1,8), 'Autorrefrator', l,
            'oftalmologia', custoOriginal, u) RETURNING id INTO i;

  -- venda ocorrida em MARCO, digitada AGORA (abril+)
  INSERT INTO pedidos (numero, item_id, canal, vendido_em, custo_na_venda,
                       valor, taxa, comissao, frete_saida, liquido, modified_by)
    VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), i, 'mercado_livre',
            vendaEm, (SELECT custo FROM itens WHERE id = i),
            7500.00, 1050.00, 300.00, 620.00, 5530.00, u)
    RETURNING id INTO p;

  -- ---------- 1) o custo foi congelado a partir do item ----------
  SELECT custo_na_venda INTO custoGravado FROM pedidos WHERE id = p;
  IF custoGravado = custoOriginal THEN
    RAISE NOTICE 'OK  1) custo do item foi congelado no pedido (R$ %)', custoGravado;
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 1) custo congelado (%) != custo do item (%)', custoGravado, custoOriginal;
    falhou := falhou + 1;
  END IF;

  margemAntes := (SELECT valor - taxa - comissao - frete_saida - custo_na_venda
                  FROM pedidos WHERE id = p);

  -- ---------- 2) corrigir o custo do item NAO mexe no pedido ----------
  UPDATE itens SET custo = custoCorrigido, updated_at = now() WHERE id = i;

  SELECT custo_na_venda INTO custoGravado FROM pedidos WHERE id = p;
  IF custoGravado = custoOriginal THEN
    RAISE NOTICE 'OK  2) custo do item mudou p/ R$ % e o pedido NAO se mexeu', custoCorrigido;
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 2) o pedido seguiu o item — mes fechado se reescreve!';
    falhou := falhou + 1;
  END IF;

  -- ---------- 3) a margem do mes fechado continua a mesma ----------
  margemDepois := (SELECT valor - taxa - comissao - frete_saida - custo_na_venda
                   FROM pedidos WHERE id = p);
  IF margemAntes = margemDepois THEN
    RAISE NOTICE 'OK  3) margem do mes fechado inalterada (R$ %)', margemDepois;
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 3) margem mudou de % para % sozinha', margemAntes, margemDepois;
    falhou := falhou + 1;
  END IF;

  -- ---------- 4) a venda pertence a MARCO, nao ao mes da digitacao ----------
  SELECT created_at INTO digitadoEm FROM pedidos WHERE id = p;
  IF to_char(vendaEm,'YYYY-MM') <> to_char(digitadoEm,'YYYY-MM')
     AND (SELECT to_char(vendido_em,'YYYY-MM') FROM pedidos WHERE id = p) = '2026-03' THEN
    RAISE NOTICE 'OK  4) venda fecha em % mesmo digitada em %',
                 to_char(vendaEm,'MM/YYYY'), to_char(digitadoEm,'MM/YYYY');
    ok := ok + 1;
  ELSE
    RAISE NOTICE 'FALHOU 4) a venda esta caindo no mes da digitacao';
    falhou := falhou + 1;
  END IF;

  -- ---------- 5) pedido sem data de venda nao entra ----------
  BEGIN
    INSERT INTO pedidos (numero, item_id, canal, custo_na_venda,
                         valor, taxa, comissao, frete_saida, liquido, modified_by)
      VALUES ('ML-'||substr(gen_random_uuid()::text,1,8), i, 'olx',
              1000, 2000, 100, 80, 0, 1820, u);
    RAISE NOTICE 'FALHOU 5) gravou pedido SEM data de venda';
    falhou := falhou + 1;
  EXCEPTION WHEN not_null_violation THEN
    RAISE NOTICE 'OK  5) pedido sem `vendido_em` recusado (sem default silencioso)';
    ok := ok + 1;
  END;

  RAISE NOTICE '-----------------------------------------';
  RAISE NOTICE 'RESULTADO: % passaram, % falharam', ok, falhou;
END $$;

ROLLBACK;
