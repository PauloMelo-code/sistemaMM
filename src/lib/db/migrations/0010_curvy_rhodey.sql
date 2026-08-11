CREATE TABLE "usuarios_sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp NOT NULL,
	"ultimo_acesso_em" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "senha_hash" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "tentativas_falhas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "bloqueado_ate" timestamp;--> statement-breakpoint
ALTER TABLE "usuarios_sessoes" ADD CONSTRAINT "usuarios_sessoes_user_id_usuarios_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios_sessoes" ADD CONSTRAINT "usuarios_sessoes_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_usuarios_sessoes_token" ON "usuarios_sessoes" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_usuarios_sessoes_usuario" ON "usuarios_sessoes" USING btree ("user_id") WHERE "usuarios_sessoes"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_usuarios_sessoes_expira" ON "usuarios_sessoes" USING btree ("expira_em");