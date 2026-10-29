CREATE TABLE "integracoes_ml_anuncios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_externo" text NOT NULL,
	"titulo" text NOT NULL,
	"family_name" text,
	"sku" text,
	"campo_vendedor" text,
	"status" text NOT NULL,
	"preco" numeric(14, 2) NOT NULL,
	"moeda" text NOT NULL,
	"qtd_disponivel" integer NOT NULL,
	"qtd_vendida" integer NOT NULL,
	"categoria_id" text NOT NULL,
	"tipo_anuncio" text NOT NULL,
	"condicao" text,
	"permalink" text,
	"fotos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"descricao" text,
	"criado_no_ml" timestamp,
	"atualizado_no_ml" timestamp,
	"sincronizado_em" timestamp NOT NULL,
	"item_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integracoes_ml_anuncios" ADD CONSTRAINT "integracoes_ml_anuncios_item_id_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."itens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integracoes_ml_anuncios" ADD CONSTRAINT "integracoes_ml_anuncios_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_integracoes_ml_anuncios_id_externo" ON "integracoes_ml_anuncios" USING btree ("id_externo") WHERE "integracoes_ml_anuncios"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_integracoes_ml_anuncios_sku" ON "integracoes_ml_anuncios" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "idx_integracoes_ml_anuncios_item" ON "integracoes_ml_anuncios" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_integracoes_ml_anuncios_ativos" ON "integracoes_ml_anuncios" USING btree ("is_deleted");