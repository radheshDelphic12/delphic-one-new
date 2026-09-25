FROM node:22-alpine AS base
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package.json ./package.json
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm install --workspace server

COPY server ./server
RUN npm run generate --workspace server

ENV NODE_ENV=production
EXPOSE 4000

WORKDIR /app/server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
