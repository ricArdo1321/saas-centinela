graph TD
    subgraph Client_Network
        FG[FortiGate] -->|UDP 514| COL[Smart Collector]
    end

    COL -->|HTTPS + API Key| LB[Load Balancer / Ingress]
    
    subgraph Cloud_Infrastructure
        LB --> API[Backend API]
        
        API -->|Auth Check| DB_AUTH[(Auth DB)]
        API -->|Job| Q_ING[Redis: Ingest Queue]
        
        subgraph Workers
            W_NORM[Pipeline Worker]
            W_AI[AI Worker]
        end
        
        Q_ING --> W_NORM
        W_NORM --> DB[(Postgres)]
        W_NORM -->|High Sev| Q_AI[Redis: AI Queue]
        
        Q_AI --> W_AI
        
        subgraph AI_Mesh
            W_AI -->|HTTP| ORCH[Orchestrator]
            ORCH --> ANA[Analyst Agent]
            ORCH --> ADV[Advisor Agent]
            ORCH --> JDG[Judge Agent]
            ORCH --> WRT[Writer Agent]
        end
        
        WRT -->|Report| DB
        
        W_NORM -->|Batch & Send| SMTP[Email Service]
    end

```

---

## Fase 1 — Arquitectura Asíncrona (Queues) ✅

### Objetivos
Eliminar bloqueos en el procesamiento de logs y permitir escalabilidad horizontal.

### Implementado
- [x] **Infraestructura BullMQ** (`backend/src/lib/queue.ts`)
  - Conexión Redis compartida
  - Colas definidas: `ingest-queue`, `ai-analysis-queue`, `pipeline-queue`
- [x] **AI Worker** (`backend/src/workers/ai-worker.ts`)
  - Proceso dedicado para análisis de amenazas
  - Reintentos automáticos (Backoff exponencial)
- [x] **Pipeline Worker** (`backend/src/worker.ts`)
  - Refactorizado de `setInterval` a Job recurrente
  - Orquesta: Normalización -> Detección -> Batching -> Email

### Commits Clave
- Instalación de `bullmq` y `ioredis`
- Refactorización completa de `worker.ts`

---

## Fase 2 — Ingesta Multi-Tenant Segura ✅

### Objetivos
Permitir que múltiples clientes envíen logs de forma segura e identificada.

### Implementado
- [x] **Base de Datos**
  - Tabla `api_keys` creada (Migración `010_api_keys.sql`)
  - Índices para búsqueda rápida por hash
- [x] **Plugin de Autenticación** (`backend/src/plugins/auth.ts`)
  - Estrategia `Bearer Token`
  - Hashing SHA-256 de keys (nunca se guardan en plano)
  - Decorador `verifyApiKey` para Fastify
- [x] **Pipeline de Ingesta Asíncrona**
  - Endpoint `/v1/ingest/syslog` protegido con `authPlugin`
  - Encolado de eventos en `ingest-queue` (Redis)
  - Worker dedicado `ingest-worker.ts` para persistencia en DB
- [x] **Middleware de Rate Limiting por Tenant** (`backend/src/plugins/rate-limit-tenant.ts`)
  - Límites configurables por plan (free/basic/pro/enterprise)
  - Sliding window usando Redis sorted sets
  - Headers estándar: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - Fail-open para no bloquear tráfico en caso de error de Redis

---

## Fase 3 — Smart Collector (Agente de Borde) ✅

### Objetivos
Crear un agente ligero desplegable en la red del cliente que reenvíe syslogs locales a la nube vía HTTPS seguro.

### Implementado
- [x] **Workspace Setup** (`collector/`)
  - TypeScript + Node.js 20
  - Dockerfile multi-stage optimizado
  - Configuración con Zod validation
- [x] **Servidor UDP** (`src/index.ts`)
  - Escucha syslog en puerto configurable
  - Buffer en memoria con tail-drop
- [x] **Servidor TCP** (`src/tcp-server.ts`)
  - Conexiones concurrentes
  - Parsing line-based (newline-delimited)
  - Timeout y cleanup de conexiones
- [x] **Reintentos con Backoff** (`src/retry-queue.ts`)
  - Exponential backoff con jitter
  - Dead Letter Queue (DLQ) para fallos permanentes
  - Configurable: max retries, delays
- [x] **Cliente HTTP con Bulk** (`src/transport.ts`)
  - Usa endpoint `/v1/ingest/syslog/bulk` (100 eventos/request)
  - Fallback a envío individual si bulk falla
  - Tracking de métricas y latencia
- [x] **Health Check Server** (`src/health-server.ts`)
  - Endpoints: `/healthz`, `/readyz`, `/metrics`, `/status`
  - Docker HEALTHCHECK integrado
- [x] **Métricas** (`src/metrics.ts`)
  - Eventos: received/sent/failed/dropped
  - Retries: queued/success/dlq
  - Latency y success rate

### Archivos Principales
```

collector/
├── src/
│   ├── index.ts          # Entry point + UDP server
│   ├── config.ts         # Zod-validated config
│   ├── buffer.ts         # In-memory FIFO buffer
│   ├── transport.ts      # HTTP client with bulk + retry
│   ├── retry-queue.ts    # Exponential backoff queue
│   ├── tcp-server.ts     # TCP syslog server
│   ├── health-server.ts  # HTTP health/metrics
│   └── metrics.ts        # In-memory metrics
├── Dockerfile
├── .env.example
├── package.json
└── tsconfig.json

```

---

## Histórico (Semanas 1-3)

### Semana 1-2: MVP Monolítico ✅
- Ingesta Syslog básica
- Parsing FortiGate y Normalización
- Motor de Reglas y Emails

### Semana 3: Agentes AI (ATA) ✅
- Arquitectura de microservicios para IA
- Orquestador, Analista, Juez, Redactor

---

## Environment Variables Nuevas

```bash
# Redis / Queues
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=...

# Security
INTERNAL_AGENT_SECRET=super_long_secret_shared_between_agents
```
