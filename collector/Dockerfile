# syntax=docker/dockerfile:1.6
#
# Centinela Cloud - Collector Dockerfile
# Builds a small Go binary and runs it in a minimal image.
#

FROM golang:1.22-alpine AS build
WORKDIR /src

# Install CA certs (for HTTPS calls in some environments during build)
RUN apk add --no-cache ca-certificates

# Cache deps
COPY go.mod ./
# If you add go.sum later, uncomment:
# COPY go.sum ./
RUN go mod download

# Copy source
COPY cmd ./cmd

# Build static-ish binary (CGO disabled)
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags="-s -w" -o /out/centinela-collector ./cmd/collector


FROM alpine:3.20 AS runtime
WORKDIR /app

# Needed for HTTPS (TLS) to backend
RUN apk add --no-cache ca-certificates && update-ca-certificates

# Security hardening: non-root user
RUN addgroup -S app && adduser -S app -G app

COPY --from=build /out/centinela-collector /app/centinela-collector

# Default syslog listener ports (non-privileged by default; mapping handled by docker-compose)
# Expose both UDP/TCP for the same port; actual port is set by LISTEN_UDP/LISTEN_TCP.
EXPOSE 5514/udp
EXPOSE 5514/tcp

USER app

ENTRYPOINT ["/app/centinela-collector"]
