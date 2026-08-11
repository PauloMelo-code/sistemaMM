CREATE TABLE "integracoes_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" "canal" NOT NULL,
	"topico" text,
	"recurso" text,
	"chave_evento" text NOT NULL,
	"corpo" jsonb NOT NULL,
	"recebido_em" timestamp DEFAULT now() NOT NULL,
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
ALTER TABLE "integracoes_eventos" ADD CONSTRAINT "integracoes_eventos_modified_by_usuarios_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_integracoes_eventos_chave" ON "integracoes_eventos" USING btree ("canal","chave_evento");--> statement-breakpoint
CREATE INDEX "idx_integracoes_eventos_pendentes" ON "integracoes_eventos" USING btree ("recebido_em") WHERE "integracoes_eventos"."processado_em" IS NULL AND "integracoes_eventos"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "idx_integracoes_eventos_ativos" ON "integracoes_eventos" USING btree ("is_deleted");--> statement-breakpoint
-- ============================================================================
-- SEMENTE: usuario de sistema (escrito a mao, nao gerado pelo drizzle-kit)
--
-- Toda tabela tem `modified_by` NOT NULL com FK para `usuarios` (RN-002). O
-- webhook e os workers nao tem usuario logado, entao sem esta linha NENHUMA
-- escrita de integracao consegue gravar: o INSERT viola a FK.
--
-- O UUID e fixo e vive em `src/lib/integracoes/usuario-sistema.ts`. Precisa ser
-- igual em dev, HML e PRD — um id por ambiente quebraria a FK no deploy.
--
-- `ativo = false` de proposito: e o que impede esta linha de virar conta de
-- acesso quando a autenticacao existir. O papel e `consultoria`, o mais fraco
-- da matriz (docs/rbac.md) — se algum dia o RBAC ler este registro, que leia o
-- minimo. Robo nao precisa de papel para gravar; precisa de identidade.
-- ============================================================================
INSERT INTO "usuarios" ("id", "nome", "email", "papel", "ativo", "modified_by")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Sistema (integracoes)',
  'sistema@mmsolucoes.invalid',
  'consultoria',
  false,
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT DO NOTHING;