/**
 * Normalizer Service
 * 
 * Processes raw_events, parses them, and stores normalized events.
 */

import { sql } from '../db/index.js';
import {
  parseFortiGateLog,
  getEventType,
  mapSeverity,
  parseTimestamp,
  extractIpFromUi,
} from '../parsers/index.js';

export interface RawEvent {
  id: string;
  tenant_id: string;
  site_id: string | null;
  source_id: string | null;
  received_at: Date;
  source_ip: string | null;
  raw_message: string;
  collector_name: string | null;
  parsed: boolean;
}

export interface NormalizedEvent {
  raw_event_id: string;
  tenant_id: string;
  site_id: string | null;
  source_id: string | null;
  ts: Date;
  vendor: string;
  product: string;
  event_type: string;
  subtype: string | null;
  action: string | null;
  severity: string;
  src_ip: string | null;
  src_port: number | null;
  dst_ip: string | null;
  dst_port: number | null;
  src_user: string | null;
  dst_user: string | null;
  interface_name: string | null;
  vdom: string | null;
  policy_id: number | null;
  session_id: string | null;
  message: string | null;
  raw_kv: Record<string, string>;
}

/**
 * Process a batch of unparsed raw events.
 * 
 * @param batchSize - Number of events to process in this batch
 * @returns Number of events processed
 */
export async function processRawEvents(batchSize: number = 100): Promise<number> {
  // Fetch unparsed events
  const rawEvents = await sql<RawEvent[]>`
    SELECT id, tenant_id, site_id, source_id, received_at, source_ip, raw_message, collector_name, parsed
    FROM raw_events
    WHERE parsed = FALSE
    ORDER BY received_at ASC
    LIMIT ${batchSize}
  `;

  if (rawEvents.length === 0) {
    return 0;
  }

  let processed = 0;

  for (const event of rawEvents) {
    try {
      await normalizeAndStore(event);
      processed++;
    } catch (error) {
      console.error(`Failed to normalize event ${event.id}:`, error);
      // Mark as parsed with error to avoid reprocessing
      await sql`
        UPDATE raw_events
        SET parsed = TRUE, parse_error = ${(error as Error).message}
        WHERE id = ${event.id}
      `;
    }
  }

  return processed;
}

/**
 * Normalize a single raw event and store in normalized_events.
 */
async function normalizeAndStore(event: RawEvent): Promise<void> {
  // Parse the FortiGate log
  const parsed = parseFortiGateLog(event.raw_message);

  // Determine event type and severity
  const eventType = getEventType(parsed);
  const severity = mapSeverity(parsed.level);

  // Parse timestamp from log or use received_at
  const ts = parseTimestamp(parsed.date, parsed.time, parsed.tz) ?? event.received_at;

  // Extract user from various fields
  const srcUser = parsed.user ?? parsed.srcuser ?? parsed.xauthuser ?? null;

  // Extract source IP from log or from UI field or use collector-provided
  const srcIp = parsed.srcip ?? extractIpFromUi(parsed.ui) ?? event.source_ip ?? null;

  // Build normalized event
  const normalized: NormalizedEvent = {
    raw_event_id: event.id,
    tenant_id: event.tenant_id,
    site_id: event.site_id,
    source_id: event.source_id,
    ts,
    vendor: 'fortinet',
    product: 'fortigate',
    event_type: eventType,
    subtype: parsed.subtype ?? null,
    action: parsed.action ?? null,
    severity,
    src_ip: srcIp,
    src_port: parsed.srcport ? parseInt(parsed.srcport, 10) : null,
    dst_ip: parsed.dstip ?? null,
    dst_port: parsed.dstport ? parseInt(parsed.dstport, 10) : null,
    src_user: srcUser,
    dst_user: parsed.dstuser ?? null,
    interface_name: parsed.srcintf ?? null,
    vdom: parsed.vd ?? null,
    policy_id: parsed.policyid ? parseInt(parsed.policyid, 10) : null,
    session_id: parsed.sessionid ?? null,
    message: parsed.msg ?? parsed.logdesc ?? null,
    raw_kv: parsed.rawKv,
  };

  // Insert normalized event and mark raw event as parsed in a transaction
  await sql`
    INSERT INTO normalized_events (
      raw_event_id, tenant_id, site_id, source_id, ts,
      vendor, product, event_type, subtype, action, severity,
      src_ip, src_port, dst_ip, dst_port, src_user, dst_user,
      interface, vdom, policy_id, session_id, message, raw_kv
    ) VALUES (
      ${normalized.raw_event_id},
      ${normalized.tenant_id},
      ${normalized.site_id},
      ${normalized.source_id},
      ${normalized.ts},
      ${normalized.vendor},
      ${normalized.product},
      ${normalized.event_type},
      ${normalized.subtype},
      ${normalized.action},
      ${normalized.severity},
      ${normalized.src_ip},
      ${normalized.src_port},
      ${normalized.dst_ip},
      ${normalized.dst_port},
      ${normalized.src_user},
      ${normalized.dst_user},
      ${normalized.interface_name},
      ${normalized.vdom},
      ${normalized.policy_id},
      ${normalized.session_id},
      ${normalized.message},
      ${JSON.stringify(normalized.raw_kv)}
    )
  `;

  await sql`
    UPDATE raw_events
    SET parsed = TRUE
    WHERE id = ${event.id}
  `;
}

/**
 * Normalize a single raw event by ID.
 * 
 * @param eventId - The raw_event ID to process
 */
export async function normalizeEventById(eventId: string): Promise<void> {
  const events = await sql<RawEvent[]>`
    SELECT id, tenant_id, site_id, source_id, received_at, source_ip, raw_message, collector_name, parsed
    FROM raw_events
    WHERE id = ${eventId}
  `;

  const event = events[0];
  if (!event) {
    throw new Error(`Event ${eventId} not found`);
  }

  await normalizeAndStore(event);
}
