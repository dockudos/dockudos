# syntax=docker/dockerfile:1.7
# The dashboard and editor (Next.js). It reaches the platform API through DOCKUDOS_API_URL, read when it starts.
#
#   docker build -f deploy/docker/editor.Dockerfile -t dockudos/editor .

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS build
ENV CI=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH DOCKUDOS_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm nx build @dockudos/platform-app

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/platform/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/platform/.next/static ./apps/platform/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/platform/server.js"]
