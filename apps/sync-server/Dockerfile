# Basalt Sync server. Build from the repository root:
#   docker build -f apps/sync-server/Dockerfile -t basalt-sync .
FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN npm ci --ignore-scripts --workspace @basalt/sync-server --include-workspace-root \
 && npm run build -w @basalt/sync-server

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data/blobs
RUN mkdir -p /data/blobs && chown -R node:node /data
WORKDIR /app
COPY --from=build /src/apps/sync-server/dist/server.mjs ./server.mjs
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
