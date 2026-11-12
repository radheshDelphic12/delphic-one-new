# Database snapshot viewer: its own small image, separate from server/ and client/.
# postgresql16-client gives pg_restore / pg_dump that match the Postgres 16 server.
FROM node:22-alpine3.21 AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
RUN npx vite build web

FROM node:22-alpine3.21
RUN apk add --no-cache postgresql16-client
WORKDIR /app
# Sized for the container's 192 MB limit: cap V8's heap and the parsed-table cache; heavy work runs at low priority (nice).
ENV NODE_ENV=production \
    VIEWER_NICE=1 \
    NODE_OPTIONS=--max-old-space-size=96 \
    TABLE_CACHE_MB=40 \
    PORT=8090
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=web /app/web/dist ./web/dist
# The compose file runs this as the owner of ./backups (user:), so files the viewer writes match the host's.
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8090/ >/dev/null || exit 1
CMD ["node", "server/index.js"]
