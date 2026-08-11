CREATE TABLE "integracoes_credenciais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" "canal" NOT NULL,
	"conta_externa_id" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expira_em" timestamp NOT NULL,
	"escopo" text,
	"renovado_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integracoes_credenciais" ADD CONSTRAINT "integracoes_credenciais_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_integracoes_credenciais_canal_ativo" ON "integracoes_credenciais" USING btree ("canal") WHERE "integracoes_credenciais"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_integracoes_credenciais_expira" ON "integracoes_credenciais" USING btree ("expira_em") WHERE "integracoes_credenciais"."is_deleted" = false;