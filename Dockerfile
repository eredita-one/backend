# syntax=docker/dockerfile:1
ARG NODE_VERSION=24

# ─── Build ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
# O Prisma usa a OpenSSL para escolher e rodar o schema engine; a imagem slim não traz.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.4.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
# O postinstall roda `prisma generate`, por isso o schema entra antes do install.
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm prune --prod

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.4.2

# O pnpm-lock.yaml vai junto: sem ele, o pnpm 12 acha que as dependências estão
# desatualizadas e, antes de qualquer `pnpm <script>` (ex.: `pnpm db:deploy`), tenta
# reinstalar tudo pela internet.
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma

USER node
EXPOSE 3333

# As migrations rodam num passo separado do deploy (`pnpm db:deploy`), não a cada
# container que sobe: com mais de uma réplica, todas tentariam migrar ao mesmo tempo.
CMD ["node", "dist/main.js"]
