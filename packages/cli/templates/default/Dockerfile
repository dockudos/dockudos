# syntax=docker/dockerfile:1.7
# Your docs site as a small production image.
#
#   docker build -t my-docs .
#   docker run -p 3000:3000 --env-file .env my-docs
#
# Add `output: 'standalone'` to your Next.js config for the smallest image; without it the image runs `next start`.

FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* package-lock.json* yarn.lock* ./
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else npm install; fi

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx dockudos build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Secrets (DOCKUDOS_LLM_API_KEY, DOCKUDOS_AUTH_SECRET, ...) come from the environment, never from the image.
CMD ["npx", "next", "start"]
