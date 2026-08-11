CREATE TYPE "public"."tipo_tarefa_integracao" AS ENUM('pausar_anuncio', 'reativar_anuncio', 'tirar_do_site');--> statement-breakpoint
CREATE TABLE "integracoes_tarefas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" "canal" NOT NULL,
	"tipo" "tipo_tarefa_integracao" NOT NULL,
	"referencia_id" uuid,
	"payload" jsonb NOT NULL,
	"chave_idempotencia" text NOT NULL,
	"processado_em" timestamp,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"erro" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "taxa_origem" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "conciliado_em" timestamp;--> statement-breakpoint
ALTER TABLE "integracoes_tarefas" ADD CONSTRAINT "integracoes_tarefas_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_integracoes_tarefas_chave" ON "integracoes_tarefas" USING btree ("chave_idempotencia");--> statement-breakpoint
CREATE INDEX "idx_integracoes_tarefas_pendentes" ON "integracoes_tarefas" USING btree ("created_at") WHERE "integracoes_tarefas"."processado_em" IS NULL AND "integracoes_tarefas"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_integracoes_tarefas_ativos" ON "integracoes_tarefas" USING btree ("is_deleted");