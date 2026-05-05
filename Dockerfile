# ---- Build Stage ----
FROM node:22-alpine AS builder

WORKDIR /build

# 利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/frontend/package.json apps/frontend/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src/ packages/shared/src/
COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src/ apps/server/src/
COPY apps/frontend/tsconfig.json apps/frontend/
COPY apps/frontend/vite.config.ts apps/frontend/
COPY apps/frontend/index.html apps/frontend/
COPY apps/frontend/src/ apps/frontend/src/
COPY biome.json ./

RUN npm run build --workspace @llm-pulse/shared \
 && npm run build --workspace @llm-pulse/frontend \
 && npm run build --workspace @llm-pulse/server

# ---- Runtime Stage ----
FROM node:22-alpine

RUN addgroup -S llm-pulse && adduser -S llm-pulse -G llm-pulse
RUN apk add --no-cache tini

WORKDIR /app

RUN mkdir -p /app/apps/server/data && chown -R llm-pulse:llm-pulse /app

# 仅复制运行时需要的构建产物
COPY --from=builder /build/node_modules/ node_modules/
COPY --from=builder /build/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /build/packages/shared/package.json packages/shared/
COPY --from=builder /build/apps/server/dist/ apps/server/dist/
COPY --from=builder /build/apps/server/package.json apps/server/
COPY --from=builder /build/apps/frontend/dist/ apps/frontend/dist/

USER llm-pulse

LABEL org.opencontainers.image.title="llm-pulse" \
  org.opencontainers.image.description="LLM Pulse dashboard" \
  org.opencontainers.image.version="0.1.0" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.source="https://github.com/exesim/llm-pulse"

ENV NODE_ENV=production
ENV PORT=43130
ENV BFF_BIND_HOST=0.0.0.0
ENV PULSE_SNAPSHOT_ENABLED=false
ENV PULSE_SNAPSHOT_PATH=apps/server/data/pulse-snapshot.sqlite

EXPOSE 43130

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:43130/status/api/health').then(r=>{if(!r.ok)process.exit(1)})"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
