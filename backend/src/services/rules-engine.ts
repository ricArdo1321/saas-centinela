/**
 * Detection Rules Engine
 *
 * Evaluates normalized events against security rules and creates detections.
 */

import { sql } from '../db/index.js';

export interface NormalizedEvent {
    id: string;
    tenant_id: string;
    site_id: string | null;
    source_id: string | null;
    ts: Date;
    event_type: string;
    subtype: string | null;
    action: string | null;
    severity: string;
    src_ip: string | null;
    src_user: string | null;
    message: string | null;
    raw_kv: Record<string, string>;
}

export interface Detection {
    tenant_id: string;
    site_id: string | null;
    source_id: string | null;
    detection_type: string;
    severity: string;
    group_key: string;
    event_count: number;
    first_event_at: Date;
    last_event_at: Date;
    evidence: object;
    related_event_ids: string[];
}

export interface RuleConfig {
    name: string;
    description: string;
    eventTypes: string[];
    threshold: number;
    windowMinutes: number;
    severity: string;
    groupBy: 'src_ip' | 'src_user' | 'src_ip_user';
}

// Detection rules configuration
export const RULES: RuleConfig[] = [
    {
        name: 'vpn_bruteforce',
        description: 'Multiple VPN login failures from same IP',
        eventTypes: ['vpn_login_fail'],
        threshold: 3,
        windowMinutes: 15,
        severity: 'high',
        groupBy: 'src_ip',
    },
    {
        name: 'admin_bruteforce',
        description: 'Multiple admin login failures',
        eventTypes: ['admin_login_fail'],
        threshold: 3,
        windowMinutes: 15,
        severity: 'critical',
        groupBy: 'src_ip',
    },
    {
        name: 'config_change_burst',
        description: 'Multiple configuration changes in short period',
        eventTypes: ['config_change'],
        threshold: 10,
        windowMinutes: 5,
        severity: 'medium',
        groupBy: 'src_user',
    },
];

/**
 * Run detection rules against recent normalized events.
 *
 * @param lookbackMinutes - How far back to look for events (default: 15)
 * @returns Number of new detections created
 */
export async function runDetectionRules(lookbackMinutes: number = 15): Promise<number> {
    let detectionsCreated = 0;

    for (const rule of RULES) {
        const detections = await evaluateRule(rule, lookbackMinutes);

        for (const detection of detections) {
            try {
                await createDetection(detection);
                detectionsCreated++;
                console.log(`🚨 Detection: ${detection.detection_type} - ${detection.group_key} (${detection.event_count} events)`);
            } catch (_error) {
                // Likely duplicate detection, skip
                console.log(`⏭️  Skipping duplicate detection: ${detection.detection_type} - ${detection.group_key}`);
            }
        }
    }

    return detectionsCreated;
}

/**
 * Evaluate a single rule against normalized events.
 */
async function evaluateRule(rule: RuleConfig, lookbackMinutes: number): Promise<Detection[]> {
    const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);

    // Query to group events by the groupBy field
    let groupByColumn: string;
    switch (rule.groupBy) {
        case 'src_ip':
            groupByColumn = 'src_ip';
            break;
        case 'src_user':
            groupByColumn = 'src_user';
            break;
        case 'src_ip_user':
            groupByColumn = "COALESCE(src_ip::text, '') || ':' || COALESCE(src_user, '')";
            break;
        default:
            groupByColumn = 'src_ip';
    }

    // Query for aggregated events
    const results = await sql`
    SELECT
      tenant_id,
      site_id,
      source_id,
      ${sql.unsafe(groupByColumn)} as group_key,
      COUNT(*) as event_count,
      MIN(ts) as first_event_at,
      MAX(ts) as last_event_at,
      array_agg(id) as event_ids,
      array_agg(DISTINCT src_ip) FILTER (WHERE src_ip IS NOT NULL) as ips,
      array_agg(DISTINCT src_user) FILTER (WHERE src_user IS NOT NULL) as users
    FROM normalized_events
    WHERE ts >= ${since}
      AND event_type = ANY(${rule.eventTypes})
    GROUP BY tenant_id, site_id, source_id, ${sql.unsafe(groupByColumn)}
    HAVING COUNT(*) >= ${rule.threshold}
      AND ${sql.unsafe(groupByColumn)} IS NOT NULL
      AND ${sql.unsafe(groupByColumn)}::text != ''
      AND ${sql.unsafe(groupByColumn)}::text != ':'
  `;

    const detections: Detection[] = [];

    for (const row of results) {
        detections.push({
            tenant_id: row.tenant_id as string,
            site_id: row.site_id as string | null,
            source_id: row.source_id as string | null,
            detection_type: rule.name,
            severity: rule.severity,
            group_key: row.group_key as string,
            event_count: Number(row.event_count),
            first_event_at: row.first_event_at as Date,
            last_event_at: row.last_event_at as Date,
            evidence: {
                ips: row.ips ?? [],
                users: row.users ?? [],
                rule_description: rule.description,
                threshold: rule.threshold,
                window_minutes: rule.windowMinutes,
            },
            related_event_ids: (row.event_ids as string[]) ?? [],
        });
    }

    return detections;
}

/**
 * Create a detection record in the database.
 */
async function createDetection(detection: Detection): Promise<string> {
    // Check if we already have a similar detection in the same window
    const existing = await sql`
    SELECT id FROM detections
    WHERE tenant_id = ${detection.tenant_id}
      AND detection_type = ${detection.detection_type}
      AND group_key = ${detection.group_key}
      AND last_event_at >= ${detection.first_event_at}
      AND reported_digest_id IS NULL
    LIMIT 1
  `;

    if (existing.length > 0) {
        // Update existing detection
        await sql`
      UPDATE detections
      SET event_count = ${detection.event_count},
          last_event_at = ${detection.last_event_at},
          evidence = ${JSON.stringify(detection.evidence)},
          related_event_ids = ${detection.related_event_ids}
      WHERE id = ${existing[0]?.id}
    `;
        return existing[0]?.id as string;
    }

    // Create new detection
    const result = await sql`
    INSERT INTO detections (
      tenant_id, site_id, source_id, detection_type, severity,
      group_key, window_minutes, event_count, first_event_at, last_event_at,
      evidence, related_event_ids
    ) VALUES (
      ${detection.tenant_id},
      ${detection.site_id},
      ${detection.source_id},
      ${detection.detection_type},
      ${detection.severity},
      ${detection.group_key},
      15,
      ${detection.event_count},
      ${detection.first_event_at},
      ${detection.last_event_at},
      ${JSON.stringify(detection.evidence)},
      ${detection.related_event_ids}
    )
    RETURNING id
  `;

    return result[0]?.id as string;
}

/**
 * Get unreported detections for a tenant.
 */
export async function getUnreportedDetections(tenantId: string): Promise<Detection[]> {
    const results = await sql`
    SELECT
      tenant_id, site_id, source_id, detection_type, severity,
      group_key, event_count, first_event_at, last_event_at,
      evidence, related_event_ids
    FROM detections
    WHERE tenant_id = ${tenantId}
      AND reported_digest_id IS NULL
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      last_event_at DESC
  `;

    return results.map((row) => ({
        tenant_id: row.tenant_id as string,
        site_id: row.site_id as string | null,
        source_id: row.source_id as string | null,
        detection_type: row.detection_type as string,
        severity: row.severity as string,
        group_key: row.group_key as string,
        event_count: Number(row.event_count),
        first_event_at: row.first_event_at as Date,
        last_event_at: row.last_event_at as Date,
        evidence: row.evidence as object,
        related_event_ids: (row.related_event_ids as string[]) ?? [],
    }));
}
