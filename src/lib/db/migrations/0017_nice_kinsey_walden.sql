CREATE TYPE "public"."situacao_devolucao" AS ENUM('a_conferir', 'reintegrada', 'descartada');--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "baixou_estoque" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "devolucao" "situacao_devolucao";--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "id_reclamacao_externo" text;--> statement-breakpoint
-- RN-126: venda do historico (ate o marco da importacao, RN-124) foi gravada SEM
-- baixar estoque. Marcar aqui impede que um cancelamento futuro devolva uma
-- unidade que nunca saiu.
UPDATE "pedidos" p SET "baixou_estoque" = false
FROM "anuncios" a
WHERE a."item_id" = p."item_id" AND a."canal" = p."canal" AND a."is_deleted" = false
  AND a."contado_ate" IS NOT NULL AND p."vendido_em" <= a."contado_ate";
