DROP INDEX "idx_pedidos_item_ativo";--> statement-breakpoint
ALTER TABLE "itens" ADD COLUMN "quantidade" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "quantidade" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "itens" ADD CONSTRAINT "chk_itens_quantidade_nao_negativa" CHECK ("itens"."quantidade" >= 0);--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "chk_pedidos_quantidade_positiva" CHECK ("pedidos"."quantidade" >= 1);--> statement-breakpoint
-- ADR-0002: item ja vendido nao tem unidade em estoque. Sem isto ele nasceria
-- com quantidade 1 e o modelo novo o trataria como vendavel de novo.
UPDATE "itens" SET "quantidade" = 0 WHERE "situacao" = 'vendido';
