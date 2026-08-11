CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"papel" "papel_usuario" DEFAULT 'operador' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
-- ===========================================================================
-- ESCRITO A MAO. O drizzle-kit gera estrutura, nao dado — e sem estas duas
-- linhas a migracao QUEBRA, ou pior, passa e deixa o sistema sem conseguir
-- gravar nada vindo de integracao.
--
-- Por que: as 11 FKs de `modified_by` deixam de apontar para `usuarios` e
-- passam a apontar para `user`. Toda linha ja gravada — e toda escrita futura
-- de webhook e de job — usa o uuid fixo do usuario-sistema
-- ('00000000-0000-0000-0000-000000000001', ver src/lib/integracoes/
-- usuario-sistema.ts). Se esse uuid nao existir em `user` ANTES do ADD
-- CONSTRAINT, o Postgres recusa a constraint em banco com dados, e em banco
-- vazio a primeira venda processada estoura violacao de chave estrangeira.
--
-- `ativo = false` de proposito, exatamente como na semente original da 0004: e
-- o que impede esta linha de virar conta de acesso. Ela nao tem senha (nao ha
-- linha em `account`), entao nao ha por onde entrar nem que quisesse.
-- ===========================================================================
INSERT INTO "user" (id, name, email, email_verified, papel, ativo)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Sistema (integracoes)',
  'sistema@mmsolucoes.invalid',
  false,
  'consultoria',
  false
)
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
-- Leva junto quem ja existia em `usuarios`, PRESERVANDO O ID — senao as linhas
-- de negocio que apontam para essas pessoas perdem o alvo da FK.
--
-- A SENHA NAO VEM: o formato de hash do Better Auth e outro, e copiar o hash
-- antigo produziria uma conta que existe e nunca autentica — falha silenciosa,
-- que e o pior tipo. Quem estava cadastrado precisa de uma senha nova por
-- `node scripts/criar-usuario.mjs <email>`.
INSERT INTO "user" (id, name, email, email_verified, papel, ativo, created_at)
SELECT u.id, u.nome, u.email, false, u.papel, u.ativo, u.created_at
FROM usuarios u
WHERE u.is_deleted = false
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
ALTER TABLE "lotes" DROP CONSTRAINT "lotes_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "itens" DROP CONSTRAINT "itens_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "itens_fotos" DROP CONSTRAINT "itens_fotos_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "anuncios" DROP CONSTRAINT "anuncios_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "perguntas" DROP CONSTRAINT "perguntas_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "pedidos" DROP CONSTRAINT "pedidos_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "auditoria" DROP CONSTRAINT "auditoria_user_id_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "integracoes_eventos" DROP CONSTRAINT "integracoes_eventos_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "integracoes_credenciais" DROP CONSTRAINT "integracoes_credenciais_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "integracoes_tarefas" DROP CONSTRAINT "integracoes_tarefas_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "integracoes_sincronizacoes" DROP CONSTRAINT "integracoes_sincronizacoes_modified_by_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_account_provedor" ON "account" USING btree ("provider_id","account_id") WHERE "account"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_account_usuario" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_session_token" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_session_usuario" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_expira" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_email_ativo" ON "user" USING btree (lower("email")) WHERE "user"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_verification_identificador" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_verification_expira" ON "verification" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens" ADD CONSTRAINT "itens_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_fotos" ADD CONSTRAINT "itens_fotos_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anuncios" ADD CONSTRAINT "anuncios_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perguntas" ADD CONSTRAINT "perguntas_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integracoes_eventos" ADD CONSTRAINT "integracoes_eventos_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integracoes_credenciais" ADD CONSTRAINT "integracoes_credenciais_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integracoes_tarefas" ADD CONSTRAINT "integracoes_tarefas_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integracoes_sincronizacoes" ADD CONSTRAINT "integracoes_sincronizacoes_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;