# Centinela Cloud — ATA (Agente a Agente) Contracts

Este documento define los contratos ATA (HTTP + JSON estricto), los endpoints y los payloads entre los microservicios de IA: Orquestador, Analista, Consejero, Juez y Redactor.

---

## 0) Convenciones generales

### 0.1 Transporte
- Protocolo: HTTP/JSON
- Content-Type: application/json
- Todas las respuestas incluyen request_id
- Timeouts recomendados:
  - Orquestador: 30s (puede reintentar internamente)
  - Analista / Consejero / Redactor: 10–20s
  - Juez: 5–10s

### 0.2 Encabezados
- X-Request-Id: opcional, si el cliente lo genera
- X-Tenant-Id: obligatorio
- X-Agent-Id: opcional (ej. orchestrator)
- X-Trace-Id: opcional para trazabilidad distribuida

### 0.3 Errores (formato estándar)
Ejemplo inline: {"request_id":"req_123","error":{"code":"INVALID_PAYLOAD","message":"Missing field: tenant_id","details":{"field":"tenant_id"}}}

### 0.4 Tipos comunes
- Identificadores: id, tenant_id, site_id, source_id (string o UUID)
- Fechas: RFC3339
- Severidad: LOW | MEDIUM | HIGH | CRITICAL
- IP: IPv4 o IPv6

### 0.5 Idempotencia
- request_id debe ser único por petición.
- Los agentes deben ser idempotentes si se recibe el mismo request_id.

---

## 1) Agente Orquestador

Rol: recibe la detección y coordina Analista → Consejero → Juez → Redactor. Retorna el resultado final.

Endpoint:
- POST /v1/ata/orchestrate

Request (campos):
- request_id (string)
- tenant_id, site_id, source_id
- detection: detection_id, detection_type, severity, detected_at, group_key, evidence
- raw_events: lista con id, received_at, raw_message
- normalized_events: lista con id, ts, event_type, action, user, src_ip, message
- ai_config: analyzer_model, advisor_model, writer_model, max_tokens, temperature

Request (ejemplo inline):
{"request_id":"req_abc","tenant_id":"tnt_001","site_id":"site_001","source_id":"src_001","detection":{"detection_id":"det_001","detection_type":"vpn_bruteforce","severity":"HIGH","detected_at":"2025-02-01T12:00:00Z","group_key":"src_ip:203.0.113.10","evidence":{"count":12,"window_minutes":15,"src_ip":"203.0.113.10","users":["alice","bob"],"raw_event_ids":["evt_001","evt_002"]}},"raw_events":[{"id":"evt_001","received_at":"2025-02-01T11:58:00Z","raw_message":"..."}],"normalized_events":[{"id":"evt_001","ts":"2025-02-01T11:58:00Z","event_type":"vpn_login","action":"fail","user":"alice","src_ip":"203.0.113.10","message":"SSL VPN login failed"}],"ai_config":{"analyzer_model":"gemini-2.0-flash","advisor_model":"gpt-4o-mini","writer_model":"gpt-4o-mini","max_tokens":1200,"temperature":0.2}}

Response (campos):
- request_id
- analysis: threat_detected, threat_type, confidence_score, severity, context_summary, iocs, model_used, tokens_used, latency_ms
- recommendations: urgency, actions[], model_used, tokens_used, latency_ms
- judge: result, reason
- report: subject, body, model_used, tokens_used, latency_ms

Response (ejemplo inline):
{"request_id":"req_abc","analysis":{"threat_detected":true,"threat_type":"credential_stuffing","confidence_score":0.92,"severity":"HIGH","context_summary":"Patrón consistente con fuerza bruta distribuida.","iocs":["203.0.113.10"],"model_used":"gemini-2.0-flash","tokens_used":420,"latency_ms":820},"recommendations":{"urgency":"immediate","actions":[{"priority":1,"action":"Bloquear IP","cli_commands":["config firewall address","  edit \"block_ip_203_0_113_10\"","  set subnet 203.0.113.10 255.255.255.255","next","end"],"risk_level":"low","reversible":true}],"model_used":"gpt-4o-mini","tokens_used":380,"latency_ms":640},"judge":{"result":"pass","reason":"CLI válida y no bloquea IPs privadas críticas."},"report":{"subject":"⚠️ Centinela Alert: Ataque de fuerza bruta VPN","body":"Resumen ejecutivo...\n\nAcciones recomendadas...\n","model_used":"gpt-4o-mini","tokens_used":260,"latency_ms":410}}

---

## 2) Agente Analista (AI Log Analyzer)

Rol: analiza raw_events y normalized_events para determinar si es falso positivo o ataque real.

Endpoint:
- POST /v1/ata/analyze

Request (campos):
- request_id, tenant_id
- detection: detection_id, detection_type, severity
- raw_events[], normalized_events[]

Response (campos):
- request_id
- threat_detected, threat_type, confidence_score, severity, context_summary, iocs
- model_used, tokens_used, latency_ms

Ejemplo inline:
Request: {"request_id":"req_ana_001","tenant_id":"tnt_001","detection":{"detection_id":"det_001","detection_type":"vpn_bruteforce","severity":"HIGH"},"raw_events":["..."],"normalized_events":["..."]}
Response: {"request_id":"req_ana_001","threat_detected":true,"threat_type":"credential_stuffing","confidence_score":0.92,"severity":"HIGH","context_summary":"Múltiples intentos fallidos desde IPs asociadas a botnet.","iocs":["203.0.113.10","198.51.100.5"],"model_used":"gemini-2.0-flash","tokens_used":420,"latency_ms":820}

---

## 3) Agente Consejero (AI Action Advisor)

Rol: genera comandos CLI FortiGate basados en el análisis.

Endpoint:
- POST /v1/ata/advise

Request (campos):
- request_id, tenant_id
- analysis: threat_type, severity, iocs

Response (campos):
- request_id
- urgency
- actions[]: priority, action, cli_commands[], risk_level, reversible
- model_used, tokens_used, latency_ms

Ejemplo inline:
Request: {"request_id":"req_adv_001","tenant_id":"tnt_001","analysis":{"threat_type":"credential_stuffing","severity":"HIGH","iocs":["203.0.113.10"]}}
Response: {"request_id":"req_adv_001","urgency":"immediate","actions":[{"priority":1,"action":"Bloquear IP","cli_commands":["config firewall address","  edit \"block_ip_203_0_113_10\"","  set subnet 203.0.113.10 255.255.255.255","next","end"],"risk_level":"low","reversible":true}],"model_used":"gpt-4o-mini","tokens_used":380,"latency_ms":640}

---

## 4) Agente Juez (Safety Judge)

Rol: valida la sintaxis FortiOS y evita bloquear IPs críticas.

Endpoint:
- POST /v1/ata/judge

Request (campos):
- request_id, tenant_id
- commands[]
- allowlist[] (CIDR o IPs críticas)

Response (campos):
- request_id
- result: pass | fail
- reason

Ejemplo inline:
Request: {"request_id":"req_jdg_001","tenant_id":"tnt_001","commands":["config firewall address","  edit \"block_ip_203_0_113_10\"","  set subnet 203.0.113.10 255.255.255.255","next","end"],"allowlist":["10.0.0.0/8","192.168.0.0/16","172.16.0.0/12"]}
Response: {"request_id":"req_jdg_001","result":"pass","reason":"Sintaxis válida y no bloquea IPs privadas críticas."}

---

## 5) Agente Redactor (Email Builder)

Rol: genera el texto del reporte para email.

Endpoint:
- POST /v1/ata/write

Request (campos):
- request_id, tenant_id
- analysis (mínimo: context_summary)
- recommendations (mínimo: actions[])

Response (campos):
- request_id
- subject, body
- model_used, tokens_used, latency_ms

Ejemplo inline:
Request: {"request_id":"req_wrt_001","tenant_id":"tnt_001","analysis":{"context_summary":"..."},"recommendations":{"actions":["..."]}}
Response: {"request_id":"req_wrt_001","subject":"⚠️ Centinela Alert: Ataque de fuerza bruta VPN","body":"Resumen ejecutivo...\n\nAcciones recomendadas...\n","model_used":"gpt-4o-mini","tokens_used":260,"latency_ms":410}

---

## 6) Endpoints de salud

Todos los agentes exponen:
- GET /healthz

Respuesta inline: {"status":"ok"}

---

## 7) Versionado

Todas las rutas son versionadas bajo /v1/ata/*. Cambios incompatibles deben incrementar el prefijo de versión.

---

## 8) Consideraciones de seguridad

- Validación estricta de JSON en todos los endpoints.
- Listas blancas de IPs críticas en el Juez.
- No ejecutar comandos en producción automáticamente.
- Registro de request_id + tenant_id para auditoría.