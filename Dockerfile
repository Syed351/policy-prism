# Policy Prism — production image.
#
# Multi-stage so the shipped image carries only what runs: the compiled server,
# the built client, and production dependencies. Build tooling (TypeScript,
# Vite, the whole devDependency tree) stays in the builder and never reaches
# the running container.
#
# Node is pinned rather than floating. A newer major ships a TypeScript that
# removed the module resolution mode this codebase uses, which broke a
# deployment once already.

# ---------------------------------------------------------------------------
# Stage 1 — install every dependency, including build tooling
# ---------------------------------------------------------------------------
FROM node:20.18.1-alpine AS deps

WORKDIR /app

# Copy only manifests first. Docker caches this layer, so dependencies are
# reinstalled only when a package.json actually changes, not on every edit.
COPY package.json package-lock.json* ./
COPY shared/package.json  ./shared/
COPY server/package.json  ./server/
COPY client/package.json  ./client/

# --include=dev is required: NODE_ENV is production in the final image, and npm
# would otherwise skip the compiler and bundler this build needs.
RUN npm ci --include=dev || npm install --include=dev

# ---------------------------------------------------------------------------
# Stage 2 — compile the workspaces
# ---------------------------------------------------------------------------
FROM node:20.18.1-alpine AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Order matters: the server and client both import the shared package.
RUN npm run build --workspace shared \
 && npm run build --workspace client \
 && npm run build --workspace server

# ---------------------------------------------------------------------------
# Stage 3 — the runtime image
# ---------------------------------------------------------------------------
FROM node:20.18.1-alpine AS runtime

# dumb-init gives the container a real init process, so SIGTERM reaches Node
# and connections close cleanly instead of being killed mid-request.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    PORT=4000

WORKDIR /app

# Production dependencies only.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev || npm install --omit=dev

# Compiled output. The server resolves client/dist relative to its own
# location, so this layout must mirror the repository.
COPY --from=build /app/shared/dist  ./shared/dist
COPY --from=build /app/server/dist  ./server/dist
COPY --from=build /app/client/dist  ./client/dist
COPY --from=build /app/server/drizzle ./server/drizzle

# Uploads are staged here before parsing. Owned by the app user so a
# non-root process can write to it.
RUN mkdir -p server/uploads && chown -R node:node /app

# Never run as root. A parser handling uploaded files is exactly the component
# you want confined.
USER node

EXPOSE 4000

# The platform's own health check can use /health; this covers plain Docker.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/dist/server.js"]
