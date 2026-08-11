/**
 * Better Auth — configuracao unica.
 *
 * Substitui o login proprio (scrypt + `usuarios_sessoes`) por decisao do Paulo
 * em 2026-08-11. O que a troca resolve de imediato: **passa a existir um caminho
 * versionado para criar o primeiro usuario**. Antes nao havia — a unica linha
 * semeada em `usuarios` era o robo das integracoes (`ativo = false`), e
 * `definir-senha.mjs` so faz UPDATE. Banco novo em PRD = painel trancado.
 *
 * O que a troca CUSTA esta escrito onde acontece:
 * - `session.token` em claro (ver `db/schema/auth.ts`);
 * - o bloqueio por tentativas passa a ser em memoria de processo (abaixo).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/lib/db";
import { account, session, user, verification } from "@/lib/db/schema/auth";

/** 12h cobre um dia de trabalho sem virar acesso eterno. Era o mesmo antes. */
const DOZE_HORAS = 60 * 60 * 12;

export const auth = betterAuth({
  /**
   * ⚠️ DUAS VARIAVEIS NOVAS DE AMBIENTE, as duas obrigatorias em producao:
   *
   * - `BETTER_AUTH_SECRET`: assina cookie e token. Trocar o valor invalida
   *   todas as sessoes abertas — o que e o botao de emergencia se algo vazar.
   *   Gere com `openssl rand -base64 32`.
   * - `BETTER_AUTH_URL`: a URL publica do painel. Sem ela a biblioteca deduz a
   *   origem do cabecalho da requisicao, o que funciona ate ter proxy reverso
   *   na frente — e ai a checagem de origem passa a comparar contra o host
   *   interno e recusa o login com "invalid origin".
   *
   * As duas sao lidas do ambiente pela propria biblioteca; estao declaradas
   * aqui so para o leitor saber que existem. Estao no runbook de deploy.
   */
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,

    /**
     * ⚠️ CADASTRO PUBLICO DESLIGADO — e isto NAO e preferencia.
     *
     * `enabled: true` sozinho abre `POST /api/auth/sign-up/email` para a
     * internet. Como `papel` tem `defaultValue: "operador"` e `ativo` nasce
     * `true`, qualquer pessoa que achasse a URL criaria uma conta valida e
     * entraria no painel — vendo estoque, pedidos e anuncios do cliente.
     *
     * Este sistema tem DOIS usuarios conhecidos. Cadastro e ato administrativo,
     * nunca auto-servico. Quem cria conta e `scripts/criar-usuario.mjs`.
     * Conferido em `better-auth/dist/api/routes/sign-up.mjs:144`: com a flag, a
     * rota responde BAD_REQUEST.
     */
    disableSignUp: true,

    /** Sem cadastro publico, isto nunca dispara — fica explicito mesmo assim. */
    autoSignIn: false,
    /**
     * O Better Auth usa scrypt por padrao — o mesmo KDF que ja tinhamos
     * escolhido, e pelo mesmo motivo: e memory-hard, o que encarece ataque com
     * GPU. Nao trocar por bcrypt sem revisar `docs/oauth.md`, que ainda pede
     * bcrypt e continua desatualizado nesse ponto.
     */
    minPasswordLength: 12,
  },

  session: {
    expiresIn: DOZE_HORAS,
    /** Renova a validade a cada hora de uso, sem recriar a linha. */
    updateAge: 60 * 60,
  },

  user: {
    additionalFields: {
      /**
       * RN-107 mora neste campo.
       *
       * `input: false` NAO e detalhe: sem isso o papel viria do corpo da
       * requisicao de cadastro, e qualquer um que chamasse a rota escolheria o
       * proprio nivel de acesso — `papel: "administrador"` no JSON e o operador
       * passa a ver custo. Papel so muda por caminho administrativo.
       */
      papel: {
        type: ["administrador", "operador", "consultoria"],
        required: false,
        defaultValue: "operador",
        input: false,
      },
      ativo: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
      /**
       * Declarado como campo do usuario para que `getSession` o TRAGA de volta
       * — sem isso, `lerSessao` teria de fazer uma segunda consulta so para
       * saber se o usuario foi excluido logicamente, ou (pior) confiar que
       * `ativo` sempre acompanha a exclusao.
       */
      is_deleted: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },

  advanced: {
    database: {
      /**
       * uuid, e nao o id de texto padrao da biblioteca.
       *
       * As 13 FKs de `modified_by` das tabelas de negocio ja sao `uuid`.
       * Mantendo o tipo, a migracao troca o ALVO da FK; com id de texto, seria
       * ALTER TYPE em 11 tabelas de dados reais.
       */
      generateId: "uuid",
    },
    cookiePrefix: "mm",
  },

  /**
   * ⚠️ LIMITE DE TENTATIVAS: vale por PROCESSO, nao por usuario no banco.
   *
   * O `politica-login.ts` que sai daqui contava as falhas em `usuarios`
   * (`tentativas_falhas`, `bloqueado_ate`) — de proposito, porque contador em
   * memoria zera a cada deploy e nao existe entre instancias. O do Better Auth
   * e em memoria.
   *
   * Hoje isso e aceitavel porque `ecosystem.config.js` fixa `instances: 1` e o
   * bloqueio ainda vale dentro do processo. Deixa de ser aceitavel no dia em
   * que houver cluster — e ai a saida e o storage secundario do Better Auth,
   * nao voltar ao contador antigo. Registrado em known-issues.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    customRules: {
      "/sign-in/email": { window: 900, max: 5 },
    },
  },

  /**
   * `nextCookies` precisa ser o ULTIMO plugin. Ele e quem grava o cookie de
   * sessao quando o login acontece dentro de uma server action — sem ele o
   * login "funciona" (200) e o usuario continua deslogado, porque o Set-Cookie
   * nunca chega na resposta.
   */
  plugins: [nextCookies()],
});
