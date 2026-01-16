```Proyecto SaaS Centinela Cloud/README.md#L1-220
# Centinela Cloud (MVP) — FortiGate Syslog → Detección → Batching → Email

Centinela Cloud es un SaaS B2B orientado a equipos IT pequeños/medianos que necesitan convertir syslog (FortiGate primero) en **decisiones operativas claras** sin “alert spam”.  
El MVP prioriza: **anti-spam by design**, **email-first**, instalación simple con **collector ligero**, y **retención de 7 días**.

---

## Estado del proyecto

Este repositorio está inicializándose. El objetivo inmediato es dejar un esqueleto funcional **listo para producción** con:

- `collector`: escucha syslog (UDP/TCP), adjunta metadatos y reenvía al backend.
- `backend`: API de ingesta + normalización + motor de reglas + batching + envío de emails + endpoints para UI.
- `worker`: procesamiento asíncrono (parsing, reglas, batching, IA).
- `ops`: Docker Compose para levantar todo **en un VPS (Hostinger KM1)** y también en local.
- `frontend`: se desplegará en **Vercel** (fuera de este repo o en un repo separado), consumiendo la API del VPS por HTTPS.

Además, el MVP incluirá **IA** para:
- enriquecimiento/clasificación durante la ingesta (sin reemplazar el parsing determinista),
- procesamiento (resumen, priorización, agrupación),
- proposición de soluciones (recomendaciones accionables basadas en playbooks).

---

## Objetivo del MVP (30 días)

Entregar un MVP operable con:
- **Backend + DB + workers en un VPS Hostinger KM1** (Docker Compose) detrás de TLS.
- **Frontend en Vercel** consumiendo `https://api.tu-dominio.com`.
- Pipeline completo: **syslog FortiGate → detección → batching → email**, con **IA** para enriquecer, resumir y recomendar acciones.

### Qué hace (MVP)
1. Recibe syslog FortiGate desde un `collector` (Docker) dentro de la red del cliente.
2. Normaliza eventos y ejecuta detecciones (reglas) para casos comunes (VPN/login/bruteforce/admin/config).
3. Agrupa eventos en ventanas (batching) para evitar alert fatigue.
4. Envía **correos consolidados** con:
   - resumen ejecutivo
   - timeline
   - IPs/usuarios afectados
   - severidad
   - recomendaciones accionables
5. Guarda evidencia mínima con **retención 7 días**.

### Qué NO hace (a propósito)
- No pretende ser un SIEM.
- No requiere dashboards complejos (UI mínima solo para configuración y revisión básica).
- No envía un correo por evento.
- No depende de IA para parsear syslog: el parsing/normalización es **determinista** y auditable.

---

## Decisiones de producto / arquitectura (MVP)

### Deploy target: VPS + Vercel
- **VPS Hostinger KM1**: `backend`, `worker`, `postgres`, `redis`, reverse proxy con TLS.
- **Vercel**: `frontend` (ej. Next.js) consumiendo la API del VPS.
- El backend debe soportar `X-Forwarded-*` y CORS limitado al/los dominios del frontend.

### Mercado inicial
- FortiGate como fuente principal (syslog).
- Diseño extensible a otros vendors por “parsers” y “rulesets”.

### Tenancy
- **Multi-tenant** a nivel de aplicación (un solo backend para múltiples clientes), con separación por `tenant_id`.
- Para cliente final (no MSP) seguimos permitiendo múltiples “sites/sources” por tenant.

### Retención
- 7 días de:
  - eventos normalizados (mínimo)
  - detecciones/incidentes
  - bitácora de emails enviados

### Canales de notificación
- Email (principal).
- En el roadmap: Slack/Teams/Webhooks.

---

## Componentes (carpetas)

- `collector/`  
  Servicio ligero para recibir syslog (UDP/TCP), agregar metadatos (`tenant`, `site`, `source`) y reenviar por HTTPS al backend.

- `backend/`  
  API + módulos para:
  - ingesta autenticada
  - parsing/normalización determinista
  - exposición de datos para UI (detecciones/digests)
  - configuración mínima por tenant (destinatarios, ventanas, etc.)

- `ops/`  
  Infra para local/VPS:
  - Docker Compose (dev/prod)
  - reverse proxy + TLS
  - variables de entorno y scripts de deploy

> Nota: el `frontend` se desplegará en **Vercel** (idealmente como proyecto Next.js) y consumirá la API del VPS.

- `collector/`  
  Servicio ligero para recibir syslog (UDP/TCP), agregar metadatos (`tenant`, `site`, `source`) y reenviar por HTTPS al backend.

- `backend/`  
  API + workers para:
  - ingesta
  - parsing/normalización
  - motor de reglas
  - batching
  - envío de emails

- `ops/`  
  Infra para local/VPS:
  - `docker-compose.yml`
  - variables de entorno
  - scripts de deploy

---

## Flujo de datos (end-to-end)

1. **FortiGate** envía syslog a IP:puerto del `collector` (UDP o TCP).
2. `collector` recibe la línea syslog y crea un `RawLogEvent` con:
   - `received_at`, `source_ip`, `raw_message`
   - `tenant_key`/`ingest_token` (según diseño)
   - `site_id` (opcional)
3. `collector` hace POST al backend: `/v1/ingest/syslog`.
4. `backend`:
   - valida autenticación del collector
   - parsea FortiGate (`kv` típico: `key=value`)
   - normaliza a un esquema común (`NormalizedEvent`)
   - ejecuta reglas y genera `Detections`
   - inserta en DB (Postgres) con `tenant_id`
5. Worker de batching:
   - agrupa detecciones por ventana (ej. 15 min / 60 min)
   - dedup (misma IP/usuario/tipo)
   - calcula severidad final
6. Scheduler:
   - cada `N` minutos genera digest por tenant y envía email
7. Se registra el email enviado para evitar duplicados (anti-spam).

---

## Anti-spam by design (reglas del sistema)

- Nunca enviar “un evento = un correo”.
- Ventanas configurables por tipo de detección (ej. bruteforce: 15m; config-change: inmediato pero consolidado por 5m).
- Deduplicación por firma: `(tenant, detection_type, user, src_ip, dest, window)`.
- Rate limit por destinatario y por tenant (ej. máximo X correos/hora).
- Siempre incluir:
  - conteo agregado
  - primer/último evento
  - “qué hacer ahora” (acciones concretas)

---

## Soporte “logs salen a la nube” vs “on-prem” (ambos caminos)

Aún no está decidido para todos los clientes, así que el diseño contempla 2 modos:

### Modo A — SaaS Cloud (por defecto)
- El `collector` envía eventos al backend en tu VPS.
- Pros: sencillo de operar, centralizado, rápido para iterar.
- Cons: requiere salida a internet desde el cliente.

### Modo B — On-prem / Private (opcional en roadmap)
- `collector + backend` corren en infraestructura del cliente.
- Pros: compliance, no exfiltración de logs.
- Cons: upgrades/soporte más complejos.

El MVP se construye para Modo A, manteniendo la posibilidad de empaquetarlo para Modo B sin rehacer todo.

---

## Stack propuesto (MVP en VPS/Docker)

Stack orientado a **VPS Hostinger KM1 + Frontend en Vercel**:

- **Backend**: Node.js + TypeScript (Fastify recomendado por footprint)  
- **Worker/Jobs**: BullMQ + Redis (procesamiento asíncrono: parsing, reglas, batching, IA)  
- **DB**: Postgres  
- **Reverse proxy + TLS**: Caddy (recomendado por simplicidad) o Nginx  
- **Emails**: SMTP vía proveedor (Mailgun/SendGrid). Evitar “correo directo” desde VPS por deliverability.  
- **Collector**: Go (recomendado por robustez UDP/TCP y footprint)  
- **Frontend**: Vercel (Next.js recomendado), consumiendo `https://api.tu-dominio.com`

### IA (en el MVP)
En KM1 normalmente no conviene correr modelos locales. Para el MVP se recomienda:
- **IA vía API cloud** (OpenAI/Anthropic/Azure OpenAI u otro), llamada desde el `worker`.
- IA siempre **asíncrona** (no bloquea la ingesta).
- Minimización/redacción de datos antes de enviar a IA (según política del tenant).

---

## Configuración FortiGate (referencia rápida)

En FortiGate, configura syslog hacia el `collector`:

- Destination: IP del host donde corre el `collector`
- Port: `514` (o el que definas)
- Protocol: UDP (simple) o TCP (más confiable)

---

## Variables de entorno (planeadas)

### Backend
- `DATABASE_URL=postgres://...`
- `REDIS_URL=redis://...` (si aplica)
- `APP_BASE_URL=https://...`
- `INGEST_SHARED_SECRET=...` (token/hmac para collectors)
- `EMAIL_FROM=Centinela <alerts@...>`
- `SMTP_HOST=...`
- `SMTP_PORT=...`
- `SMTP_USER=...`
- `SMTP_PASS=...`
- `RETENTION_DAYS=7`
- `DEFAULT_LOCALE=es` (emails bilingües por destinatario)

### Collector
- `BACKEND_INGEST_URL=https://.../v1/ingest/syslog`
- `INGEST_TOKEN=...`
- `LISTEN_UDP=:514`
- `LISTEN_TCP=:514` (opcional)
- `TENANT_ID=...`
- `SITE_ID=...`

---

## Desarrollo local (plan)

1. Levanta infraestructura:
   - `docker compose up -d` (en `ops/`)
2. Levanta backend + worker:
   - `pnpm dev` / `npm run dev` (backend)
   - `pnpm worker` / `npm run worker` (worker) (según scripts)
3. Levanta collector:
   - `docker compose up collector` o binario local
4. Envía un syslog de prueba:
   - `echo "<134>date host ... msg" | nc -u 127.0.0.1 5514`

> En producción, el `frontend` se despliega en Vercel y el backend en el VPS con TLS (reverse proxy).

---

## Plan de desarrollo (VPS Hostinger KM1 + Vercel + IA)

### Arquitectura de despliegue (target)
- **VPS (KM1)**:
  - reverse proxy con TLS (Caddy/Nginx)
  - `backend` (API)
  - `worker` (jobs: parsing, reglas, batching, IA)
  - `postgres` (persistente)
  - `redis` (colas)
  - (opcional) SMTP de dev local; en prod usar Mailgun/SendGrid
- **Vercel**:
  - `frontend` (Next.js recomendado)
  - `NEXT_PUBLIC_API_BASE_URL=https://api.tu-dominio.com`

### IA: alcance y enfoque (MVP)
- **No** usar IA para parsear syslog crudo como mecanismo principal.
- Sí usar IA para:
  1) **Ingesta (enriquecimiento y clasificación)**: familia de evento, confianza, `risk_score` y “razones”.
  2) **Procesamiento**: resumen ejecutivo, priorización y agrupación de detecciones en “incidentes” (opcional v2).
  3) **Proposición de soluciones**: recomendaciones accionables basadas en un catálogo de playbooks (IA redacta/adapta, no inventa pasos).

### Plan por fases (resumen)
1. **Base prod en VPS**: DNS + TLS + compose prod (sin exponer DB/Redis) + healthchecks.
2. **Backend listo para Vercel**: CORS, soporte `X-Forwarded-*`, endpoints mínimos para UI.
3. **Ingesta + collector**: `/v1/ingest/syslog` autenticado + syslog UDP/TCP → POST.
4. **Parsing/normalización determinista**: FortiGate key=value robusto.
5. **Reglas MVP + batching + email**: 1–2 reglas + digest consolidado + auditoría `email_digests`.
6. **IA v1**: resumen + recomendaciones guiadas por playbooks (async, con caching y rate limit).
7. **Hardening**: retención, backups `pg_dump`, seguridad de red, costos/limitación por tenant.

---

## Backlog técnico (primer corte)

### Infra
- [ ] `docker-compose.yml` con `postgres`, `redis` (opcional), `backend`, `collector`
- [ ] migraciones DB

### Ingesta
- [ ] endpoint `/v1/ingest/syslog` autenticado
- [ ] almacenamiento `raw_events` (mínimo) + `normalized_events`

### Parsing FortiGate
- [ ] parser `key=value` robusto
- [ ] normalización: `event_type`, `subtype`, `user`, `src_ip`, `dst_ip`, `action`, `device_id`

### Reglas (MVP)
- [ ] VPN login failures (bruteforce por user/IP)
- [ ] admin login failures
- [ ] successful admin login desde IP nueva
- [ ] config change
- [ ] IPS/AV critical
- [ ] port scan / deny spikes (heurística simple)
- [ ] geo-anomalía (opcional si se usa GeoIP)
- [ ] múltiples usuarios fallidos desde misma IP

### Batching + Email
- [ ] ventana configurable por regla
- [ ] dedup + rate limit
- [ ] plantilla bilingüe (ES/EN)
- [ ] registro `email_digests` para auditoría

---

## Ejemplo de email consolidado (mini)

Asunto (ES): `[ALTA] Intentos de acceso VPN fallidos (42) — 10:00-11:00`  
Subject (EN): `[HIGH] Failed VPN logins (42) — 10:00-11:00`

Cuerpo (ES/EN) incluirá:
- Resumen (qué pasó)
- Impacto probable
- Evidencia (IPs, usuarios, conteo)
- Recomendaciones (acciones en FortiGate)

---

## Seguridad (MVP)

- HTTPS obligatorio entre `collector` y `backend`
- Autenticación del collector (token compartido + rotación)
- Aislamiento multi-tenant en DB (`tenant_id` en todas las tablas)
- Retención automática (job diario para borrar datos > 7 días)
- No almacenar credenciales FortiGate en MVP
- Logs de auditoría mínimos (ingest, reglas, envíos de email)

---

## Próximo paso inmediato

1) Definir stack final (Go vs Node para `collector`; Fastify/Nest; Redis sí/no).  
2) Crear el esqueleto con `docker compose`, `backend` y `collector` compilables.  
3) Primer “happy path”: enviar syslog → detectar “VPN login fail” → email consolidado.

---
