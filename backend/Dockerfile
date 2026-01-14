```Proyecto SaaS Centinela Cloud/backend/Dockerfile#L1-70
# syntax=docker/dockerfile:1.6
#
# Centinela Cloud - Backend Dockerfile
# - Multi-stage build (deps -> build -> runtime)
# - Node 20 (aligned with package.json engines)
#

FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json ./
# If you add a lockfile later, uncomment the relevant COPY line
# COPY package-lock.json ./
# COPY pnpm-lock.yaml ./
# COPY yarn.lock ./

# Install prod+dev deps (needed for build)
RUN npm install


FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript -> dist
RUN npm run build

# Prune devDependencies for smaller runtime image
RUN npm prune --omit=dev


FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Security hardening: run as non-root
RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 3000

USER app

HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.js"]
