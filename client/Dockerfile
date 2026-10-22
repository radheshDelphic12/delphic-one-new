FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./package.json
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm install --workspace client

COPY client ./client
ARG VITE_DISABLE_QUICK_LOGIN=true
ENV VITE_DISABLE_QUICK_LOGIN=$VITE_DISABLE_QUICK_LOGIN
# Build info for the page's <meta name="build-commit"> tags (client/build-info.js). The deploy passes them in: .git is not in the build context.
ARG BUILD_COMMIT_SHA
ARG BUILD_COMMIT_DATE
ARG BUILD_COMMIT_MESSAGE
ARG BUILD_BRANCH
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA BUILD_COMMIT_DATE=$BUILD_COMMIT_DATE BUILD_COMMIT_MESSAGE=$BUILD_COMMIT_MESSAGE BUILD_BRANCH=$BUILD_BRANCH
RUN npm run build --workspace client

FROM nginx:1.27-alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
