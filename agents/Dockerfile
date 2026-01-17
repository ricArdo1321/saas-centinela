# Multi-stage Dockerfile for Centinela Cloud AI Agents
# Build: docker build --build-arg AGENT=orchestrator -t centinela-orchestrator .
# Run: docker run -p 8080:8080 centinela-orchestrator

FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Build stage
FROM base AS builder
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY orchestrator ./orchestrator
COPY analyst ./analyst
COPY advisor ./advisor
COPY judge ./judge
COPY writer ./writer
RUN npm run build

# Production stage
FROM base AS runner

ARG AGENT=orchestrator
ENV NODE_ENV=production
ENV AGENT_NAME=${AGENT}

# Default ports per agent
# orchestrator: 8080
# analyst: 8081
# advisor: 8082
# judge: 8083
# writer: 8084
ENV PORT=8080
ENV HOST=0.0.0.0

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 centinela
USER centinela

# Copy production dependencies
COPY --from=deps --chown=centinela:nodejs /app/node_modules ./node_modules

# Copy built files
COPY --from=builder --chown=centinela:nodejs /app/dist ./dist
COPY --from=builder --chown=centinela:nodejs /app/package.json ./package.json

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/healthz || exit 1

# Start the agent
CMD ["sh", "-c", "node dist/${AGENT_NAME}/index.js"]
