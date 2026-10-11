# syntax=docker/dockerfile:1.7
# The platform process: API, webhooks, analytics, auth, workers, agent and site hosting. Which roles run is chosen with
# DOCKUDOS_SERVICES, so this one image is every service in docker-compose.yml and the Helm chart.
#
#   docker build -f deploy/docker/platform.Dockerfile -t dockudos/platform .

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS build
ENV CI=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm nx build @dockudos/platform
# Only what the server needs at run time, with its workspace dependencies copied in.
RUN pnpm --filter @dockudos/platform deploy --prod /out

FROM node:${NODE_VERSION}-slim AS runtime
# git: builds fetch repositories with `git fetch --depth 1`. tini: forwards signals so shutdown drains jobs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
ENV NODE_ENV=production DOCKUDOS_DATA_DIR=/var/lib/dockudos DOCKUDOS_PORT=4000
RUN mkdir -p /var/lib/dockudos && chown node:node /var/lib/dockudos
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 4000
VOLUME ["/var/lib/dockudos"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DOCKUDOS_PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini", "--", "node", "dist/server.js"]
