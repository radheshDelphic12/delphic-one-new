FROM node:22-alpine AS base
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
# Install exactly what package-lock.json pins (npm ci): a fresh `npm install` picked up rollup 4.68.6 (released 2026-11-18) and broke `vite build` on Alpine.
RUN npm ci --workspace server --no-audit --no-fund

COPY server ./server
RUN npm run generate --workspace server

ENV NODE_ENV=production
EXPOSE 4000

WORKDIR /app/server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
