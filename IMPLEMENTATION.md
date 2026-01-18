# Centinela Cloud - Implementation Plan

## Status Overview

| Semana | Objetivo | Estado |
|--------|----------|--------|
| **Semana 1** | Esqueleto y primer ingest | ✅ Completada |
| **Semana 2** | Parsing + reglas + digest | ✅ Completada |
| **Semana 3** | Integración de IA | 🔲 Pendiente |
| **Semana 4** | Dashboard + Multi-tenant | 🔲 Pendiente |

---

## Semana 1 — Esqueleto y primer ingest ✅

### Completado

- [x] Inicializar repo (git) + estructura `backend/collector/ops`
- [x] `docker-compose.yml` con Postgres + Redis
- [x] Backend Fastify con endpoint `/v1/ingest/syslog`
- [x] Autenticación: token simple + HMAC
- [x] Cliente Postgres con connection pooling (`postgres.js`)
- [x] Sistema de migraciones SQL (7 migraciones aplicadas)
- [x] 12 tablas creadas: tenants, sites, sources, raw_events, normalized_events, detections, digests, email_deliveries, ai_analyses, ai_recommendations, ai_config, _migrations
- [x] Inserción de eventos raw verificada

### Commits

- `b5afc4c` - Postgres integration + raw_events persistence

---

## Semana 2 — Parsing + reglas + digest ✅

### Completado

- [x] **Parser FortiGate** (`parsers/fortigate.ts`)
  - Extrae campos `key=value` de logs syslog
  - Detecta tipo de evento: `vpn_*`, `admin_*`, `config_change`, `traffic_*`, `utm_*`
  - Mapea severidad FortiGate → normalizada (critical, high, medium, low, info)
  - Extrae IP de campo `ui` (ej: `GUI(107.216.131.59)`)

- [x] **Normalizer Service** (`services/normalizer.ts`)
  - Procesa `raw_events` → `normalized_events`
  - Extrae timestamp, user, IP, mensaje
  - Guarda `raw_kv` como JSONB

- [x] **Rules Engine** (`services/rules-engine.ts`)
  - `vpn_bruteforce`: 3+ login fails desde misma IP en 15min → HIGH
  - `admin_bruteforce`: 3+ admin login fails → CRITICAL
  - `config_change_burst`: 10+ cambios de config en 5min → MEDIUM
  - Agrupa por `src_ip`, `src_user`, o ambos
  - Registra en tabla `detections`

- [x] **Batcher Service** (`services/batcher.ts`)
  - Agrupa detecciones no reportadas por tenant
  - Crea `digests` con: subject, body_text, severity, window
  - Vincula detecciones al digest (`reported_digest_id`)

- [x] **Email Service** (`services/email.ts`)
  - SMTP con nodemailer
  - Envía digests pendientes
  - Registra en `email_deliveries` (sent/failed)

- [x] **Worker Process** (`worker.ts`)
  - Pipeline periódico cada 60s (configurable)
  - normalize → detect → digest → email
  - Graceful shutdown

### Commits

- `ac9372d` - FortiGate parser + normalizer service
- `eaa29a5` - Rules engine + batcher service
- `e35b067` - Email service + worker process

### Pruebas Realizadas

- ✅ Evento FortiGate real procesado: `config_change` de `carlos.sotolongo`
- ✅ 24 eventos VPN login fail → detección `vpn_bruteforce` (HIGH)
- ✅ Digest creado con subject: `⚠️ Centinela Alert: 1 detección(es) - HIGH`

---

## Semana 3 — Integración de IA (Agentes ATA) 🔄 En Progreso

### Objetivo
Reemplazar la lógica monolítica de IA por un equipo de microservicios (Agentes) que se comunican vía protocolo Agente a Agente (ATA). `services/ai-client.ts` actúa como cliente HTTP del Orquestador.

### Completado

- [x] **Contratos ATA definidos** (`agents/ATA.md`)
  - Endpoints: `/v1/ata/orchestrate`, `/v1/ata/analyze`, `/v1/ata/advise`, `/v1/ata/judge`, `/v1/ata/write`
  - Payloads JSON con `request_id`, `tenant_id`, tipos estrictos
  - Timeouts recomendados y manejo de errores estándar

- [x] **Agente Orquestador** (`agents/orchestrator/index.ts`)
  - Skeleton Fastify en puerto 8080
  - Coordina flujo Analista → Consejero → Juez → Redactor
  - Variables de entorno para URLs de agentes downstream

- [x] **Agente Analista de Logs** (`agents/analyst/index.ts`)
  - Skeleton en puerto 8081
  - Extrae IOCs y cuenta eventos únicos
  - TODO: Integrar LLM (Gemini Flash / OpenAI)

- [x] **Agente Consejero de Acción** (`agents/advisor/index.ts`)
  - Skeleton en puerto 8082
  - Genera comandos CLI FortiGate placeholder por cada IOC
  - Mapea severidad → urgencia

- [x] **Agente Juez de Seguridad** (`agents/judge/index.ts`)
  - Skeleton en puerto 8083
  - Valida sintaxis FortiOS (regex patterns)
  - Bloquea IPs privadas (10.x, 172.16-31.x, 192.168.x, 127.x)

- [x] **Agente Redactor de Reportes** (`agents/writer/index.ts`)
  - Skeleton en puerto 8084
  - Genera Subject/Body con formato ejecutivo
  - Secciones: Resumen, IOCs, Acciones Recomendadas

- [x] **Configuración de Agentes**
  - `agents/package.json` con scripts `dev:*` y `start:*`
  - `agents/tsconfig.json` para TypeScript
  - `agents/Dockerfile` multi-stage con ARG AGENT

- [x] **Cliente HTTP Backend** (`backend/src/services/ai-client.ts`)
  - `AIClient` con retry logic y timeout configurable
  - `AIPersistenceService` para guardar en `ai_analyses` y `ai_recommendations`
  - Factory functions: `createAIClient()`, `createAIPersistenceService()`

### Pendiente

- [ ] **Implementar llamadas LLM reales**
  - Analista: llamar Gemini Flash API
  - Consejero: llamar GPT-4o-mini
  - Redactor: llamar LLM para texto natural

- [ ] **Integración en Worker Pipeline**
  - Modificar `worker.ts` para llamar al Orquestador después de detecciones
  - Persistir resultados antes del Batcher

- [ ] **Plantilla Email con IA**
  - Actualizar `services/email.ts` para incluir sección "Análisis de IA"
  - Renderizar comandos CLI en formato legible

- [ ] **Tests de integración**
  - Mock de agentes para testing local
  - Verificar flujo completo Orchestrator → Judge retry

### Estructura de Archivos Creados

```
agents/
├── ATA.md                    # Contratos y especificación
├── package.json              # Dependencias compartidas
├── tsconfig.json             # Config TypeScript
├── Dockerfile                # Build multi-agente
├── orchestrator/index.ts     # Puerto 8080
├── analyst/index.ts          # Puerto 8081
├── advisor/index.ts          # Puerto 8082
├── judge/index.ts            # Puerto 8083
└── writer/index.ts           # Puerto 8084

backend/src/services/
└── ai-client.ts              # Cliente HTTP + Persistencia
```

### Variables de Entorno (Agentes)

```bash
# Orchestrator
PORT=8080
ANALYST_URL=http://localhost:8081
ADVISOR_URL=http://localhost:8082
JUDGE_URL=http://localhost:8083
WRITER_URL=http://localhost:8084

# Backend
ORCHESTRATOR_URL=http://localhost:8080
AI_TIMEOUT_MS=30000
AI_RETRY_ATTEMPTS=2
AI_RETRY_DELAY_MS=1000
```

### Comandos de Desarrollo

```bash
cd agents
npm install
npm run dev:orchestrator  # Terminal 1
npm run dev:analyst       # Terminal 2
npm run dev:advisor       # Terminal 3
npm run dev:judge         # Terminal 4
npm run dev:writer        # Terminal 5
```

---

## Semana 4 — Dashboard + Multi-tenant 🔲

### Pendiente

- [ ] Frontend Next.js básico
- [ ] Vista de detecciones por tenant
- [ ] Gestión de tenants/sites/sources
- [ ] Autenticación usuario (JWT)
- [ ] API REST para frontend

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgres://centinela:password@localhost:5432/centinela

# Backend Auth
INGEST_SHARED_SECRET=change_me_min_16_chars

# SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=user
SMTP_PASS=password
SMTP_FROM=centinela@example.com

# Alerts
ALERT_RECIPIENT_EMAIL=admin@example.com

# Worker
WORKER_INTERVAL_MS=60000

# AI (Semana 3)
# GEMINI_API_KEY=...
# OPENAI_API_KEY=...
```

---

## NPM Scripts

```bash
npm run dev          # Backend en modo desarrollo
npm run worker       # Worker de pipeline
npm run db:migrate   # Ejecutar migraciones
npm run typecheck    # Verificar tipos TypeScript
npm run lint         # Ejecutar ESLint
```

---

## Arquitectura Actual

```
┌─────────────────┐     ┌──────────────────┐
│    Collector    │────▶│  /v1/ingest/     │
│  (FortiGate)    │     │    syslog        │
└─────────────────┘     └────────┬─────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │  raw_events    │
                        └────────┬───────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Worker (cada 60s)     │
                    ├─────────────────────────┤
                    │ 1. Normalizer           │
                    │ 2. Rules Engine         │
                    │ 3. Batcher              │
                    │ 4. Email Sender         │
                    └────────────┬────────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │ normalized   │ │  detections  │ │   digests    │
        │   _events    │ │              │ │              │
        └──────────────┘ └──────────────┘ └──────────────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │    Email     │
                                          │   (SMTP)     │
                                          └──────────────┘
```
