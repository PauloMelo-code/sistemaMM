ALTER TABLE "perguntas" ADD COLUMN "id_anuncio_externo" text;--> statement-breakpoint
CREATE INDEX "idx_perguntas_anuncio_externo" ON "perguntas" USING btree ("id_anuncio_externo");