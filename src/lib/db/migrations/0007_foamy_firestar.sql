CREATE TABLE "itens_fotos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"objeto" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"largura" integer NOT NULL,
	"altura" integer NOT NULL,
	"principal" boolean DEFAULT false NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"alt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itens" ADD COLUMN "exibir_no_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "itens_fotos" ADD CONSTRAINT "itens_fotos_item_id_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."itens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_fotos" ADD CONSTRAINT "itens_fotos_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_itens_fotos_principal" ON "itens_fotos" USING btree ("item_id") WHERE "itens_fotos"."principal" = true AND "itens_fotos"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_itens_fotos_objeto" ON "itens_fotos" USING btree ("objeto");--> statement-breakpoint
CREATE INDEX "idx_itens_fotos_item" ON "itens_fotos" USING btree ("item_id","ordem") WHERE "itens_fotos"."is_deleted" = false;