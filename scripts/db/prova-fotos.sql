-- Prova das constraints de `itens_fotos` (RN-109). Transacao + ROLLBACK.
--
-- Uso: docker exec -i mmsolues-db-1 psql -U dev -d mmsolucoes_dev < scripts/db/prova-fotos.sql
--
-- O que se prova: (a) um item nunca tem duas fotos de capa; (b) excluir a capa
-- libera o posto para a proxima; (c) o indice parcial NAO atrapalha as fotos
-- comuns; (d) a chave do objeto no MinIO nunca e reaproveitada, nem depois de
-- exclusao logica; (e) item com foto nao some por baixo dela.
-- Esperado: 5 passaram, 0 falharam.
\set ON_ERROR_STOP off
BEGIN;

DO $$
DECLARE
  u uuid; l uuid; i uuid; f1 uuid; f2 uuid;
  ok int := 0; falhou int := 0;
  chave text := 'itens/prova/'||gen_random_uuid()||'.jpg';
  quantasPrincipais int;
BEGIN
  INSERT INTO "user" (name, email, papel)
    VALUES ('Anderson', 'teste'||substr(gen_random_uuid()::text,1,8)||'@prova.local',
            'administrador') RETURNING id INTO u;
  INSERT INTO lotes (nome, segmento, data_arremate, custo_total, modified_by)
    VALUES ('Lote Oftalmo', 'oftalmologia', '2026-02-10', 12000.00, u) RETURNING id INTO l;
  INSERT INTO itens (sku, nome, lote_id, segmento, custo, modified_by)
    VALUES ('PROVA-'||substr(gen_random_uuid()::text,1,8), 'Autorrefrator', l,
            'oftalmologia', 3300.00, u) RETURNING id INTO i;

  INSERT INTO itens_fotos (item_id, objeto, mime, bytes, largura, altura, principal, ordem, modified_by)
    VALUES (i, chave, 'image/jpeg', 240000, 1600, 1200, true, 0, u) RETURNING id INTO f1;

  -- ---------- 1) segunda capa no MESMO item e recusada ----------
  -- Sem isto, card do site, miniatura do painel e capa do anuncio podem escolher
  -- fotos diferentes para o mesmo produto, e ninguem entende por que.
  BEGIN
    INSERT INTO itens_fotos (item_id, objeto, mime, bytes, largura, altura, principal, ordem, modified_by)
      VALUES (i, 'itens/prova/'||gen_random_uuid()||'.jpg', 'image/jpeg', 200000, 1200, 900, true, 1, u);
    RAISE NOTICE 'FALHOU 1) gravou DUAS fotos principais no mesmo item';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK  1) segunda foto principal do mesmo item recusada';
    ok := ok + 1;
  END;

  -- ---------- 2) fotos comuns convivem (o unico e PARCIAL) ----------
  -- Se o indice pegasse todas as linhas, a galeria teria no maximo uma foto.
  BEGIN
    INSERT INTO itens_fotos (item_id, objeto, mime, bytes, largura, altura, principal, ordem, modified_by)
      VALUES (i, 'itens/prova/'||gen_random_uuid()||'.jpg', 'image/jpeg', 190000, 1200, 900, false, 1, u),
             (i, 'itens/prova/'||gen_random_uuid()||'.jpg', 'image/webp', 150000, 1024, 768, false, 2, u);
    RAISE NOTICE 'OK  2) duas fotos NAO principais no mesmo item convivem';
    ok := ok + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'FALHOU 2) o indice parcial esta pegando foto comum';
    falhou := falhou + 1;
  END;

  -- ---------- 3) excluir a capa libera o posto ----------
  -- E o caso real do "troquei a foto de capa": sem isto, o operador exclui a
  -- capa e nao consegue promover nenhuma outra.
  UPDATE itens_fotos SET is_deleted = true, deleted_at = now() WHERE id = f1;
  BEGIN
    INSERT INTO itens_fotos (item_id, objeto, mime, bytes, largura, altura, principal, ordem, modified_by)
      VALUES (i, 'itens/prova/'||gen_random_uuid()||'.jpg', 'image/png', 300000, 1500, 1500, true, 0, u)
      RETURNING id INTO f2;
    RAISE NOTICE 'OK  3) apos excluir a capa, outra foto assume';
    ok := ok + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'FALHOU 3) capa excluida continua ocupando o posto';
    falhou := falhou + 1;
  END;

  SELECT count(*) INTO quantasPrincipais
    FROM itens_fotos WHERE item_id = i AND principal AND is_deleted = false;
  IF quantasPrincipais <> 1 THEN
    RAISE NOTICE 'FALHOU 3b) item ficou com % capas ativas', quantasPrincipais;
    falhou := falhou + 1;
  END IF;

  -- ---------- 4) a chave do objeto NUNCA e reaproveitada ----------
  -- O unico de `objeto` e GLOBAL, sem WHERE: a exclusao e logica e o arquivo
  -- CONTINUA no bucket. Se a chave voltasse a ficar livre, um upload novo
  -- sobrescreveria o arquivo de uma foto que ainda pode ser restaurada.
  BEGIN
    INSERT INTO itens_fotos (item_id, objeto, mime, bytes, largura, altura, principal, ordem, modified_by)
      VALUES (i, chave, 'image/jpeg', 240000, 1600, 1200, false, 9, u);
    RAISE NOTICE 'FALHOU 4) reusou a chave de um objeto de foto EXCLUIDA';
    falhou := falhou + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK  4) chave de objeto excluido continua reservada';
    ok := ok + 1;
  END;

  -- ---------- 5) item com foto nao pode ser apagado fisicamente ----------
  BEGIN
    DELETE FROM itens WHERE id = i;
    RAISE NOTICE 'FALHOU 5) apagou item que tem foto (FK deveria ser RESTRICT)';
    falhou := falhou + 1;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'OK  5) item com foto protegido por FK RESTRICT';
    ok := ok + 1;
  END;

  RAISE NOTICE '-----------------------------------------';
  RAISE NOTICE 'RESULTADO: % passaram, % falharam', ok, falhou;
END $$;

ROLLBACK;
