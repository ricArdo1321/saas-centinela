```Proyecto SaaS Centinela Cloud/ARCHITECTURE.md#L1-260
# Centinela Cloud — Arquitectura MVP (FortiGate Syslog → Detección → Batching → Email)

Este documento define una arquitectura **implementable** para el MVP de Centinela Cloud desplegado en **VPS + Docker**, con foco en **anti-spam by design**, **email-first**, **multi-tenant**, y **retención 7 días**.

---

## 1) Objetivo del sistema (MVP)

**Convertir syslog de FortiGate en correos consolidados accionables**, evitando el “alert fatigue”.

### Resultado esperado (happy path)
1. FortiGate envía syslog a un **collector** (en la red del cliente).
2. El collector reenvía eventos al backend por HTTPS.
3. El backend:
   - parsea/normaliza
   - detecta señales
   - agrupa en ventanas
   - envía **un digest** (no un correo por evento)
4. Se guarda evidencia mínima por **7 días**.

---

## 2) Decisiones clave

### 2.1 Tenancy
- **Multi-tenant** a nivel aplicación: un backend para múltiples clientes.
- Toda entidad persistida lleva `tenant_id`.
- En el MVP (cliente final), un tenant puede tener múltiples `sites` y múltiples `sources` (FortiGates).

### 2.2 “Cloud vs On-prem” (ambas posibilidades)
No está cerrado para todos los clientes, así que se diseña con un “camino común”:

- **Modo A (SaaS Cloud)**: Collector en cliente → Backend en tu VPS.
- **Modo B (Private/On-prem)**: Collector + Backend en cliente (empaquetado con Docker Compose).

El MVP se implementa como Modo A, evitando dependencias “ultra-cloud” para que Modo B sea viable sin reescritura.

### 2.3 Retención
- **7 días** de datos mínimos necesarios para:
  - reconstruir el digest enviado
  - auditoría de notificaciones
  - troubleshooting básico
- Job diario de limpieza (DB).

### 2.4 Canal de notificación
- **Email** como canal primario en MVP.
- Plantillas bilingües **ES/EN** (por destinatario o por tenant).

---

## 3) Arquitectura de alto nivel

### Componentes
1. **Collector**
   - Escucha syslog **UDP/TCP** (puerto configurable).
   - Enriquecimiento mínimo (source IP, received_at, tenant/site/source).
   - Reenvía al backend vía HTTPS con autenticación (token o HMAC).

2. **Backend API**
   - Endpoint de ingesta `/v1/ingest/syslog`.
   - Persistencia de `raw_events` (opcional mínimo) y `normalized_events`.
   - Encola/planifica procesamiento (worker).

3. **Rules Engine**
   - Conjunto de reglas FortiGate (MVP: 8+ detecciones).
   - Genera `detections` con severidad base y claves de agrupación.

4. **Batching Engine**
   - Consolida detecciones en ventanas (ej. 15m/60m por tipo).
   - Deduplicación y rate-limit.
   - Produce `digests` listos para email.

5. **Email Service**
   - Envío SMTP (Mailgun/SendGrid/SMTP del VPS).
   - Registro de envíos (`email_deliveries`) para trazabilidad y anti-duplicados.

6. **Config UI (mínima)**
   - Administración de tenant, sites, sources
   - Reglas on/off, ventanas, destinatarios, idioma

### Diagrama lógico (texto)
- FortiGate → (syslog UDP/TCP) → Collector → (HTTPS) → Backend Ingest → Parser/Normalizer → Rules → Detections → Batching → Email Digest → SMTP → Cliente

---

## 4) Flujo de datos (detalle)

### 4.1 Ingesta
- El collector envía un `SyslogIngestRequest`:
  - `tenant_id` (o `tenant_key`)
  - `site_id`
  - `source_id` (FortiGate)
  - `received_at`
  - `source_ip`
  - `raw_message`

El backend:
- valida autenticación del collector
- guarda evento crudo (si se habilita)
- parsea y normaliza

### 4.2 Parsing / Normalización FortiGate (MVP)
- FortiGate suele emitir mensajes con `key=value` (a veces con comillas).
- Se normaliza a un esquema común:

Campos recomendados en `NormalizedEvent`:
- `tenant_id`, `site_id`, `source_id`
- `ts` (timestamp del evento; si no existe, `received_at`)
- `vendor="fortinet"`, `product="fortigate"`
- `event_type` (ej. `vpn_login`, `admin_login`, `config_change`, `utm_alert`)
- `action` (`success|fail|deny|allow`)
- `user` (si aplica)
- `src_ip`, `src_port`
- `dst_ip`, `dst_port`
- `interface`, `vdom` (si aplica)
- `message` (texto corto)
- `raw_kv` (JSON con campos parseados; limitado)

### 4.3 Detección (rules engine)
Cada evento normalizado se evalúa contra reglas:
- produce 0..N detecciones
- cada detección define:
  - `detection_type`
  - `severity_base`
  - `group_key` (para batching)
  - `evidence` (IPs, usuarios, conteos)
  - `window_minutes` (por regla)

### 4.4 Batching (anti-spam)
Un job periódico:
- agrupa detecciones no reportadas dentro de una ventana:
  - por `tenant_id + site_id + detection_type + group_key + window_bucket`
- aplica:
  - dedup (mismas claves)
  - rate-limit (máximo X digests por hora/tenant)
  - escalamiento (si sube el conteo, sube severidad)

Genera:
- `digest` con resumen y cuerpo estructurado (idioma ES/EN)

### 4.5 Envío de email
- renderiza plantilla (ES/EN)
- envía por SMTP
- registra resultado y marca detecciones como “reportadas en digest_id”

---

## 5) Modelo de datos (MVP, Postgres)

> Nota: este es un modelo mínimo. Se recomienda migraciones (ej. Prisma/Knex/Flyway según stack).

### Entidades
- `tenants`
  - `id`, `name`, `status`, `created_at`
- `tenant_users` (si hay UI)
  - `id`, `tenant_id`, `email`, `role`, `password_hash`, `created_at`
- `sites`
  - `id`, `tenant_id`, `name`, `timezone`, `created_at`
- `sources`
  - `id`, `tenant_id`, `site_id`, `name`, `type` (`fortigate_syslog`), `ingest_token_hash`, `created_at`

- `raw_events` (opcional; útil para debugging)
  - `id`, `tenant_id`, `site_id`, `source_id`, `received_at`, `source_ip`, `raw_message`
  - Retención 7 días

- `normalized_events`
  - `id`, `tenant_id`, `site_id`, `source_id`, `ts`, `event_type`, `action`, `user`, `src_ip`, `dst_ip`, `message`, `raw_kv_json`
  - Índices: `(tenant_id, ts)`, `(tenant_id, event_type, ts)`, `(tenant_id, src_ip, ts)`

- `detections`
  - `id`, `tenant_id`, `site_id`, `source_id`, `detected_at`, `detection_type`, `severity`, `group_key`, `window_minutes`, `evidence_json`
  - `reported_digest_id` nullable
  - Índices: `(tenant_id, detected_at)`, `(tenant_id, detection_type, detected_at)`, `(tenant_id, reported_digest_id)`

- `digests`
  - `id`, `tenant_id`, `site_id`, `window_start`, `window_end`, `severity`, `subject`, `body_text`, `body_html` (opcional)
  - `locale` (`es|en`), `created_at`

- `email_deliveries`
  - `id`, `tenant_id`, `digest_id`, `to_email`, `provider`, `message_id`, `status`, `error`, `sent_at`

---

## 6) Reglas iniciales FortiGate (MVP, 8 detecciones)

1. **VPN login failed spike (por user)**
   - Condición: `event_type=vpn_login` + `action=fail`
   - Agrupa: `user`
   - Ventana: 15m
   - Severidad: sube por conteo (ej. 10+ = alta)

2. **VPN login failed spike (por src_ip)**
   - Agrupa: `src_ip`
   - Ventana: 15m

3. **Multiple users failed from same IP**
   - Condición: `vpn_login fail` con múltiples `user` para un `src_ip`
   - Ventana: 30m

4. **Admin login failure**
   - Condición: `admin_login` + `fail`
   - Ventana: 30m

5. **Admin login success from new IP**
   - Condición: `admin_login success` y `src_ip` no vista en 30 días (en MVP: “no vista en 7 días” o tabla simple)
   - Ventana: 60m (digest)
   - Severidad: alta

6. **Config change detected**
   - Condición: evento de `config_change`
   - Ventana: 5m (consolidar si son varios cambios)
   - Severidad: media/alta

7. **UTM critical (IPS/AV)**
   - Condición: `utm_alert` con severity crítica
   - Ventana: 15m

8. **Deny spike (heurística)**
   - Condición: pico de `action=deny` o `policy deny` sobre baseline simple
   - Ventana: 15m

---

## 7) Severidad (fórmula MVP)

Una fórmula simple y explícita:

- `severity_base` por regla: `LOW|MEDIUM|HIGH|CRITICAL`
- `multiplier` por volumen:
  - `count 1-4`: +0
  - `count 5-19`: +1 nivel (LOW→MEDIUM, MEDIUM→HIGH)
  - `count >=20`: +2 niveles (cap en CRITICAL)
- `bonus` por señales:
  - `admin_*`: +1 nivel
  - múltiples usuarios impactados: +1 nivel
  - múltiples países (si hay GeoIP): +1 nivel (opcional)

---

## 8) Anti-spam: mecanismos concretos

- **Digest windows**: configurable por `detection_type`.
- **Deduplicación**:
  - clave: `(tenant_id, site_id, detection_type, group_key, window_bucket)`
- **Rate limit**:
  - por tenant: ej. máximo 4 correos/hora
  - por destinatario: ej. máximo 2 correos/hora
- **Escalación**:
  - si en la siguiente ventana el conteo crece 3x, permitir un digest adicional (pero consolidado)

---

## 9) Seguridad (MVP)

### Transporte
- HTTPS obligatorio collector → backend.
- Token/HMAC para autenticar al collector.
- Rotación de token (manual en MVP; automática en V1).

### Datos
- Separación por `tenant_id` en todas las queries.
- Cifrado en reposo: a nivel disco (VPS) + opcional DB encryption (dependiendo del proveedor).
- Minimización: no guardar “todo el syslog” indefinidamente (retención 7 días).

### Auditoría mínima
- Registrar:
  - requests de ingest (conteo)
  - detecciones generadas
  - emails enviados y resultado

---

## 10) Observabilidad (MVP)

- Logs estructurados (JSON) en backend y collector.
- Métricas mínimas:
  - eventos ingeridos/min
  - detecciones/min
  - digests enviados/h
  - fallos SMTP
- Healthchecks:
  - `/healthz` backend
  - `/readyz` (DB conectada)

---

## 11) Despliegue (VPS + Docker)

### Servicios (Compose sugerido)
- `postgres`
- `redis` (opcional; recomendado si usas colas)
- `backend`
- `collector` (para ambiente de pruebas; en producción suele ir en cliente)

### Configuración
- `.env` por ambiente (dev/prod)
- Secrets:
  - SMTP creds
  - ingest secret
  - DB password

---

## 12) Backlog técnico (primeros 14 días)

### Semana 1 — Esqueleto y primer ingest
- [ ] Inicializar repo (git) + estructura `backend/collector/ops`
- [ ] `docker-compose.yml` con Postgres
- [ ] Backend: endpoint `/v1/ingest/syslog` + auth simple (token)
- [ ] Tabla `raw_events` + inserción
- [ ] Script local para enviar syslog de prueba

### Semana 2 — Parsing + 2 reglas + digest por email
- [ ] Parser FortiGate `key=value`
- [ ] `normalized_events` + persistencia
- [ ] Reglas: `VPN login fail` + `admin login fail`
- [ ] Batching job (ventana fija 15m)
- [ ] Envío email SMTP (plantilla simple ES/EN)
- [ ] Registro `email_deliveries`

---

## 13) Backlog (MVP completo 30 días)

- [ ] Multi-site + múltiples sources por tenant
- [ ] 8 reglas MVP completas
- [ ] Severidad por volumen + escalación
- [ ] UI mínima para:
  - tenants / sites / sources
  - destinatarios e idioma
  - ventana de batching por regla
- [ ] Retención 7 días (job diario)
- [ ] Rate-limit robusto (por tenant/destinatario)
- [ ] Export básico (CSV de digests) opcional

---

## 14) Nota sobre GitHub “subir a tu cuenta”
Para publicar esto en tu GitHub necesitas ejecutar el push desde tu máquina (credenciales/token SSH). Yo puedo dejar el repo listo (git init, commits, remote), pero el `push` requiere tus credenciales locales.

Siguiente paso recomendado: implementar el esqueleto real en `backend/`, `collector/` y `ops/`, y luego haces:
- `git init`
- `git add .`
- `git commit -m "Initial MVP skeleton"`
- `git remote add origin git@github.com:TU_USUARIO/centinela-cloud.git`
- `git push -u origin main`
