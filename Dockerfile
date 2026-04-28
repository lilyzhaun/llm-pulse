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

RUN npm run build

# ---- Runtime Stage ----
FROM node:22-alpine

RUN addgroup -S llm-pulse && adduser -S llm-pulse -G llm-pulse

WORKDIR /app

# 仅复制运行时需要的构建产物
COPY --from=builder /build/node_modules/ node_modules/
COPY --from=builder /build/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /build/packages/shared/package.json packages/shared/
COPY --from=builder /build/apps/server/dist/ apps/server/dist/
COPY --from=builder /build/apps/server/package.json apps/server/
COPY --from=builder /build/apps/frontend/dist/ apps/frontend/dist/

RUN mkdir -p /var/lib/llm-pulse && chown llm-pulse:llm-pulse /var/lib/llm-pulse

USER llm-pulse

ENV NODE_ENV=production
ENV PORT=43130
ENV PULSE_DB_FILE=/var/lib/llm-pulse/pulse-state.sqlite

EXPOSE 43130

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:43130/status/api/health').then(r=>{if(!r.ok)process.exit(1)})"

CMD ["node", "apps/server/dist/index.js"]
