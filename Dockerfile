# Imagem da aplicacao — EasyPanel (HML e PRD).
#
# Substitui o modelo antigo de SSH + `git reset --hard` + pm2, que nunca chegou
# a rodar. Multi-stage: as dependencias de build ficam no estagio `construtor` e
# NAO entram na imagem final.
#
# Node 24: e o que o CI usa, e o `package.json` exige >= 22.6 (o `node --test`
# roda .ts direto por type stripping a partir dessa versao).
FROM node:24-alpine AS base

# ---------------------------------------------------------------------------
# 1) Dependencias — camada separada para o cache do Docker so cair quando o
#    package-lock mudar, e nao a cada linha de codigo alterada.
# ---------------------------------------------------------------------------
FROM base AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# 2) Build
# ---------------------------------------------------------------------------
FROM base AS construtor
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .

# ⚠️ ESTES DOIS SAO DE BUILD, NAO DE RUNTIME — e essa distincao morde.
#
# `next.config.ts` monta `images.remotePatterns` a partir de MINIO_PUBLIC_URL na
# CARGA DA CONFIG, ou seja, durante o build. Se a variavel faltar aqui, a funcao
# devolve `[]` EM SILENCIO e a imagem sai recusando toda foto com "hostname not
# configured" — sintoma que so aparece na tela do visitante, muito depois.
# Passar em runtime nao adianta: o valor ja foi cozido no build.
ARG MINIO_PUBLIC_URL
ENV MINIO_PUBLIC_URL=$MINIO_PUBLIC_URL

# O build avalia toda rota para coletar page data, e `src/lib/db/index.ts` valida
# DATABASE_URL na avaliacao do modulo. Valor de FACHADA de proposito: o Pool nao
# abre conexao durante o build, e a string real de producao nao tem por que
# existir dentro de uma camada de imagem.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build

RUN npm run build

# ---------------------------------------------------------------------------
# 3) Runtime
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Fuso cravado. As colunas de instante sao `timestamp` SEM fuso, entao o driver
# `pg` serializa `Date` no relogio de parede do processo: sem isto, uma venda
# fechada 31/03 as 21h30 em Maringa e gravada como 01/04 e leva junto a comissao
# do mes (RN-108).
# ⚠️ ISTO E METADE. A sessao do Postgres precisa do MESMO fuso — ver o runbook.
ENV TZ=America/Sao_Paulo
ENV PORT=3000
# O server.js do standalone escuta em localhost por padrao, o que dentro de um
# container significa "ninguem de fora alcanca".
ENV HOSTNAME=0.0.0.0

# Nao rodar como root. `node` ja existe na imagem oficial (uid 1000).
RUN mkdir -p .next && chown node:node .next

# O standalone traz o server.js e so as dependencias que a app realmente importa.
COPY --from=construtor --chown=node:node /app/.next/standalone ./
# Estes dois o standalone NAO copia (ver o comentario em next.config.ts).
COPY --from=construtor --chown=node:node /app/.next/static ./.next/static
COPY --from=construtor --chown=node:node /app/public ./public

# Migracoes: o `.sql` e o journal precisam existir na imagem, senao nao ha o que
# aplicar. `scripts/migrar.mjs` usa o migrador do proprio drizzle-orm (que ja e
# dependencia de runtime) em vez do drizzle-kit, que e de desenvolvimento e nao
# entra aqui.
COPY --from=construtor --chown=node:node /app/src/lib/db/migrations ./src/lib/db/migrations
COPY --from=construtor --chown=node:node /app/scripts/migrar.mjs ./scripts/migrar.mjs
COPY --from=construtor --chown=node:node /app/scripts/criar-usuario.mjs ./scripts/criar-usuario.mjs

USER node
EXPOSE 3000

# Healthcheck do proprio container: app que sobe e morre em 2 segundos deixa de
# parecer saudavel. `/api/saude` responde sem sessao e consulta o banco.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
