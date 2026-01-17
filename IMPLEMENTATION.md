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

## Semana 3 — Integración de IA 🔲

### Pendiente

- [ ] **AI Log Analyzer** (`services/ai-analyzer.ts`)
  - Integración con Gemini/OpenAI API
  - Prompt engineering para análisis de logs FortiGate
  - Tabla `ai_analyses` + persistencia
  - Rate limiting y control de costos (tokens)

- [ ] **AI Action Advisor** (`services/ai-advisor.ts`)
  - Prompt especializado en remediación FortiGate
  - Biblioteca de comandos CLI válidos
  - Tabla `ai_recommendations` + persistencia

- [ ] **Integración en Pipeline**
  - Análisis AI después de detección
  - Recomendaciones en digest email

- [ ] **Plantilla Email con IA**
  - Sección "Análisis de IA"
  - Sección "Acciones Recomendadas"

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
