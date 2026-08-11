CREATE TYPE "public"."papel_usuario" AS ENUM('administrador', 'operador', 'consultoria');--> statement-breakpoint
CREATE TYPE "public"."situacao_item" AS ENUM('anunciado', 'sem_anuncio', 'reservado', 'pausado', 'vendido');--> statement-breakpoint
CREATE TYPE "public"."canal" AS ENUM('mercado_livre', 'olx', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."status_anuncio" AS ENUM('no_ar', 'negociando', 'pausado');--> statement-breakpoint
CREATE TYPE "public"."status_pergunta" AS ENUM('pendente', 'respondida');--> statement-breakpoint
CREATE TYPE "public"."etapa_expedicao" AS ENUM('aguardando_nfe', 'etiqueta', 'embalado', 'coletado');--> statement-breakpoint
CREATE TYPE "public"."status_pedido" AS ENUM('aguardando_envio', 'em_transporte', 'concluido');--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"papel" "papel_usuario" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"segmento" text NOT NULL,
	"data_arremate" date NOT NULL,
	"custo_total" numeric(14, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"nome" text NOT NULL,
	"lote_id" uuid NOT NULL,
	"segmento" text NOT NULL,
	"custo" numeric(14, 2) NOT NULL,
	"preco_alvo" numeric(14, 2),
	"local_galpao" text,
	"situacao" "situacao_item" DEFAULT 'sem_anuncio' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anuncios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"id_externo" text,
	"preco" numeric(14, 2) NOT NULL,
	"status" "status_anuncio" DEFAULT 'no_ar' NOT NULL,
	"visitas" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perguntas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" "canal" NOT NULL,
	"id_externo" text,
	"item_id" uuid,
	"texto" text NOT NULL,
	"resposta" text,
	"respondida_em" timestamp,
	"prazo_sla" timestamp NOT NULL,
	"status" "status_pergunta" DEFAULT 'pendente' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"item_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"taxa" numeric(14, 2) NOT NULL,
	"comissao" numeric(14, 2) NOT NULL,
	"liquido" numeric(14, 2) NOT NULL,
	"nfe_emitida" boolean DEFAULT false NOT NULL,
	"nfe_chave" text,
	"etapa_expedicao" "etapa_expedicao" DEFAULT 'aguardando_nfe' NOT NULL,
	"rastreio" text,
	"status" "status_pedido" DEFAULT 'aguardando_envio' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"acao" text NOT NULL,
	"tabela" text NOT NULL,
	"registro_id" uuid NOT NULL,
	"detalhes" text NOT NULL,
	"dados_anteriores" text,
	"dados_novos" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens" ADD CONSTRAINT "itens_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens" ADD CONSTRAINT "itens_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anuncios" ADD CONSTRAINT "anuncios_item_id_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."itens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anuncios" ADD CONSTRAINT "anuncios_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perguntas" ADD CONSTRAINT "perguntas_item_id_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."itens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perguntas" ADD CONSTRAINT "perguntas_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_item_id_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."itens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_user_id_usuarios_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_usuarios_email_ativo" ON "usuarios" USING btree (lower("email")) WHERE "usuarios"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_usuarios_ativos" ON "usuarios" USING btree ("is_deleted");--> statement-breakpoint
CREATE INDEX "idx_lotes_ativos" ON "lotes" USING btree ("is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_itens_sku_ativo" ON "itens" USING btree ("sku") WHERE "itens"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_itens_lote" ON "itens" USING btree ("lote_id");--> statement-breakpoint
CREATE INDEX "idx_itens_ativos" ON "itens" USING btree ("is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_anuncios_item_canal_ativo" ON "anuncios" USING btree ("item_id","canal") WHERE "anuncios"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_anuncios_id_externo" ON "anuncios" USING btree ("canal","id_externo") WHERE "anuncios"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_anuncios_item" ON "anuncios" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_anuncios_ativos" ON "anuncios" USING btree ("is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_perguntas_id_externo" ON "perguntas" USING btree ("canal","id_externo") WHERE "perguntas"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_perguntas_sla_pendente" ON "perguntas" USING btree ("prazo_sla") WHERE "perguntas"."status" = 'pendente' AND "perguntas"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_perguntas_item" ON "perguntas" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_perguntas_ativos" ON "perguntas" USING btree ("is_deleted");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pedidos_canal_numero" ON "pedidos" USING btree ("canal","numero");--> statement-breakpoint
CREATE INDEX "idx_pedidos_item" ON "pedidos" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_pedidos_ativos" ON "pedidos" USING btree ("is_deleted");--> statement-breakpoint
CREATE INDEX "idx_auditoria_registro" ON "auditoria" USING btree ("tabela","registro_id");--> statement-breakpoint
CREATE INDEX "idx_auditoria_usuario" ON "auditoria" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_auditoria_data" ON "auditoria" USING btree ("created_at");