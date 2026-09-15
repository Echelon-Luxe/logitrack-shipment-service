# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------- deps ---
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# --ignore-scripts blocks postinstall, so the Prisma client is generated
# explicitly below. Running arbitrary install scripts from 400+ transitive
# packages during a build is a supply-chain risk worth removing.
RUN npm ci --ignore-scripts

# --------------------------------------------------------------- build ---
FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npm run build

# ---------------------------------------------------- production deps ---
FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
# The generated client is required at runtime and lives under src/, so it is
# copied from the build stage rather than regenerated here.
COPY --from=build /app/src/generated ./dist/generated

# -------------------------------------------------------------- runtime ---
# Distroless: no shell, no package manager, no busybox. An attacker who gets
# RCE has no /bin/sh to pivot with, and Trivy finds far fewer OS CVEs because
# there is almost no OS left to scan.
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build     --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build     --chown=nonroot:nonroot /app/package.json ./

# Matches runAsUser: 1000 / runAsNonRoot: true in the Helm chart. If these
# disagree the pod fails to start with CreateContainerConfigError.
USER nonroot
EXPOSE 3002

# No shell in distroless, so this is exec form only - shell form would fail.
CMD ["dist/index.js"]
