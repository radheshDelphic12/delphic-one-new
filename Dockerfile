FROM node:22-alpine AS build
WORKDIR /app

# Prisma 5's engines need openssl on Alpine (same as server/Dockerfile).
RUN apk add --no-cache openssl libc6-compat

COPY package.json ./package.json
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm install --workspace server --workspace client --include-workspace-root

COPY server ./server
COPY client ./client

# Optional build-time flag: set VITE_DISABLE_QUICK_LOGIN=true in Render to hide the dev quick-login bar.
ARG VITE_DISABLE_QUICK_LOGIN
ENV VITE_DISABLE_QUICK_LOGIN=$VITE_DISABLE_QUICK_LOGIN

RUN npm run generate --workspace server
RUN npm run build --workspace client

FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache nginx gettext openssl libc6-compat

# Copy installed workspace dependencies and app files from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist /usr/share/nginx/html

# Render injects PORT; nginx must listen on that port while the API remains on 4000.
# Alpine's nginx only loads server blocks from /etc/nginx/http.d (conf.d is included at the
# top level, where `server` is illegal and nginx exits with [emerg]).
RUN mkdir -p /etc/nginx/templates /etc/nginx/http.d
RUN cat > /etc/nginx/templates/default.conf.template <<'EOF'
server {
    listen ${PORT};
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    location = /index.html {
        add_header Cache-Control "no-store, must-revalidate";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
    }

    location / {
        add_header Cache-Control "no-store, must-revalidate";
        try_files $uri /index.html;
    }
}
EOF

EXPOSE 4000

# API side: scripts/staging-bootstrap.js migrates (and seeds when SEED_STAGING=true), then the API starts on 4000.
# nginx side: serves the SPA and proxies /api and /uploads on Render's $PORT.
# The API runs in a restart loop: nginx keeps the container alive, so if node exits
# (e.g. a crash after Neon drops connections) nothing else would bring it back and
# every /api call would 502 until Render's health check recycled the container.
CMD sh -c "cd /app/server && (node scripts/staging-bootstrap.js && while true; do PORT=4000 node src/index.js; echo \"[api] exited with code \$?, restarting in 2s\"; sleep 2; done) & envsubst '\$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/http.d/default.conf && nginx -g 'daemon off;'"
