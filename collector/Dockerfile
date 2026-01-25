# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package configuration
COPY package.json ./

# Install dependencies (including devDependencies for building)
RUN npm install

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript to JavaScript
RUN npm run build

# Remove devDependencies to shrink image size
RUN npm prune --production

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy necessary files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create a non-root user for security
RUN addgroup -S centinela && adduser -S centinela -G centinela
USER centinela

# Expose ports
# UDP Syslog (standard: 514, non-privileged: 5140)
EXPOSE 5140/udp

# TCP Syslog (standard: 514, non-privileged: 5140)
EXPOSE 5140/tcp

# Health check HTTP endpoint
EXPOSE 8080/tcp

# Health check for Docker/Kubernetes
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1

# Start the collector
CMD ["node", "dist/index.js"]
