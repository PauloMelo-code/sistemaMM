CREATE TABLE "integracoes_sincronizacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" "canal" NOT NULL,
	"recurso" text NOT NULL,
	"ate_qual_instante" timestamp,
	"ultimo_sucesso_em" timestamp,
	"resultado" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integracoes_sincronizacoes" ADD CONSTRAINT "integracoes_sincronizacoes_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_integracoes_sincronizacoes_canal_recurso" ON "integracoes_sincronizacoes" USING btree ("canal","recurso") WHERE "integracoes_sincronizacoes"."is_deleted" = false;