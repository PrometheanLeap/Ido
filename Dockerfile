# ── Ido Dockerfile ────────────────────────────────────────────
# Multi-stage: proxy + web → single production image

# Stage 1: Build proxy
FROM node:22-slim AS proxy-build
WORKDIR /app/proxy
COPY proxy/package.json proxy/package-lock.json* ./
RUN npm ci
COPY proxy/ ./
RUN npm run build

# Stage 2: Build web
FROM node:22-slim AS web-build
WORKDIR /app/web
COPY ido-web/package.json ido-web/package-lock.json* ./
RUN npm ci
COPY ido-web/ ./
RUN npm run build

# Stage 3: Production
FROM node:22-slim
WORKDIR /app

RUN groupadd -r ido && useradd -r -g ido ido && apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY --from=proxy-build /app/proxy/dist ./proxy/dist
COPY --from=proxy-build /app/proxy/package.json ./proxy/
COPY --from=proxy-build /app/proxy/package-lock.json ./proxy/
RUN cd /app/proxy && npm ci --omit=dev

COPY --from=web-build /app/web/dist ./ido-web/dist

COPY VERSION ./

RUN mkdir -p /app/data && chown -R ido:ido /app

USER ido

EXPOSE 8645
ENV NODE_ENV=production
ENV PORT=8645
ENV IDO_MODE=dev

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:8645/api/v1/health || exit 1

CMD ["node", "proxy/dist/index.js"]
