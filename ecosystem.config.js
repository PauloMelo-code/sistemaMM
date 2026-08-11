/**
 * pm2 — processo da aplicacao em HML e PRD.
 *
 * O deploy (.github/workflows/deploy.yml:96 e :188) termina em
 * `pm2 reload ecosystem.config.js || pm2 start ecosystem.config.js`. Ate agora
 * este arquivo NAO existia: os dois lados falhavam, e como o passo anterior e
 * `npm run db:migrate`, o deploy aplicava a migracao e so entao morria — banco
 * novo, aplicacao velha (ou nenhuma) no ar.
 *
 * NAO e CommonJS por acidente. O package.json declara `"type": "module"`, entao
 * um `.js` na raiz seria ESM e o `module.exports` daqui quebraria. A extensao
 * `.js` e exigida pela linha do deploy; `.cjs` obrigaria a mexer no workflow.
 * O pm2 le este arquivo com require(), fora do runtime da app.
 */
module.exports = {
  apps: [
    {
      name: "mm-solucoes",

      /**
       * `next start` direto, e nao `npm start`.
       *
       * Com `script: "npm"` o pm2 supervisiona o npm, que por sua vez roda o
       * next num processo filho: `pm2 reload` sinaliza o pai, o filho fica
       * orfao segurando a porta, e o restart seguinte falha com EADDRINUSE.
       * Apontar para o binario tira o intermediario.
       */
      script: "node_modules/next/dist/bin/next",
      args: "start",

      /**
       * UMA instancia, modo fork — e isto nao e economia de recurso.
       *
       * Duas razoes concretas nesta base:
       * 1. O portao de rate limit do ML e memoria de processo
       *    (src/lib/integracoes/mercado-livre/client.ts). Com duas instancias,
       *    cada uma aprende o 429 por conta propria e o dobro de chamadas
       *    continua batendo num canal que ja mandou parar.
       * 2. O job de SLA (RN-105, ainda nao construido) nao tem coluna de
       *    "alerta ja enviado". Em cluster, duas instancias alertam a mesma
       *    pergunta duas vezes.
       *
       * Subir para cluster exige resolver os dois ANTES — estado do portao
       * compartilhado e reivindicacao atomica do alerta.
       */
      instances: 1,
      exec_mode: "fork",

      env: {
        NODE_ENV: "production",
        PORT: 3000,

        /**
         * Fuso do processo, cravado.
         *
         * As colunas de instante sao `timestamp` SEM fuso (decisao ainda aberta
         * com o Lucas — ver docs/known-issues.md). Enquanto forem, o driver `pg`
         * serializa `Date` no relogio de parede do processo e o Postgres
         * descarta o offset. Sem TZ aqui, uma venda fechada 31/03 as 21h30 em
         * Maringa e gravada como 01/04 se o processo rodar em UTC — e leva
         * junto a comissao do mes (RN-108) e o faturamento por canal.
         *
         * ⚠️ ISTO SO RESOLVE METADE. A sessao do Postgres precisa do MESMO
         * fuso, senao o `date_trunc('month', now())` das consultas discorda do
         * filtro montado em Node. Ver o runbook: docs/runbook-deploy.md.
         */
        TZ: "America/Sao_Paulo",
      },

      /**
       * Reinicia se passar de 1 GB. A VPS de frontend do padrao da casa tem
       * 8 GB; o teto existe para vazamento, nao para operacao normal.
       */
      max_memory_restart: "1G",

      /**
       * Sem limite de reinicio automatico, mas com espera crescente: app que
       * nao sobe (falta `.env`, porta ocupada) para de girar em loop apertado
       * e enche o disco de log em minutos.
       */
      exp_backoff_restart_delay: 200,

      error_file: "./logs/erro.log",
      out_file: "./logs/saida.log",
      merge_logs: true,
      time: true,
    },
  ],
};
