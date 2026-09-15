# syntax=docker/dockerfile:1.7

# --------------------------------------------------------------- build ---
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
# --ignore-scripts blocks postinstall across 300+ transitive packages, so the
# Prisma client is generated explicitly below instead.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
# Generating here produces the LINUX query engine, matching the runtime image.
RUN npx prisma generate && npm run build

# ---------------------------------------------------- production deps ---
FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts \
 # @prisma/client declares the `prisma` CLI as an OPTIONAL PEER dependency, so
 # npm installs it as a production package no matter that our package.json
 # lists it under devDependencies. That drags in @prisma/config, deepmerge-ts
 # and (on Prisma 7) mysql2 - roughly 120 MB of build tooling, plus their CVEs,
 # into a runtime image that never invokes the CLI.
 #
 # The runtime needs only @prisma/client plus the generated .prisma/client
 # (which embeds the query engine), so the CLI is removed explicitly.
 && rm -rf node_modules/prisma \
           node_modules/@prisma/config \
           node_modules/@prisma/engines \
           node_modules/@prisma/engines-version \
           node_modules/deepmerge-ts \
           node_modules/.bin/prisma

# -------------------------------------------------------------- runtime ---
# Distroless: no shell, no package manager. An attacker with RCE has no
# /bin/sh to pivot with, and Trivy finds far fewer OS CVEs because there is
# almost no OS left to scan.
#
# debian13 (trixie), not debian12: the debian12 variant ships libssl3 3.0.18,
# which Trivy flags for six OpenSSL CVEs already patched upstream in 3.0.19.
# Base images lag distro security updates, so "which base tag" is a recurring
# security decision, not a one-off choice.
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps --chown=nonroot:nonroot /app/node_modules ./node_modules
# The generated client lives outside the dependency tree and must come from the
# build stage, where it was produced against the linux target.
COPY --from=build     --chown=nonroot:nonroot /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build     --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build     --chown=nonroot:nonroot /app/package.json ./

# Matches runAsUser: 1000 / runAsNonRoot: true in the Helm chart. A mismatch
# gives CreateContainerConfigError at pod start.
USER nonroot
EXPOSE 3002

# Exec form only - distroless has no shell for the shell form.
CMD ["dist/index.js"]
