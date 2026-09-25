FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./package.json
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm install --workspace client

COPY client ./client
ARG VITE_DISABLE_QUICK_LOGIN=true
ENV VITE_DISABLE_QUICK_LOGIN=$VITE_DISABLE_QUICK_LOGIN
RUN npm run build --workspace client

FROM nginx:1.27-alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
