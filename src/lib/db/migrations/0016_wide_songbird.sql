ALTER TABLE "pedidos" ADD COLUMN "id_envio_externo" text;--> statement-breakpoint
CREATE INDEX "idx_pedidos_envio_externo" ON "pedidos" USING btree ("id_envio_externo");