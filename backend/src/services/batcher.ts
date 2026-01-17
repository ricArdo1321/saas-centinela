/**
 * Batcher Service
 * 
 * Groups unreported detections into digests for email notification.
 */

import { sql } from '../db/index.js';

export interface DigestResult {
    digestId: string;
    tenantId: string;
    detectionCount: number;
    eventCount: number;
    severity: string;
}

/**
 * Create digests from unreported detections.
 * Groups detections by tenant and creates a digest for each.
 * 
 * @returns Array of created digests
 */
export async function createDigests(): Promise<DigestResult[]> {
    const results: DigestResult[] = [];

    // Get all tenants with unreported detections
    const tenants = await sql`
    SELECT DISTINCT tenant_id
    FROM detections
    WHERE reported_digest_id IS NULL
  `;

    for (const row of tenants) {
        const tenantId = row.tenant_id as string;

        try {
            const digest = await createDigestForTenant(tenantId);
            if (digest) {
                results.push(digest);
                console.log(`📧 Created digest for tenant ${tenantId}: ${digest.detectionCount} detections`);
            }
        } catch (error) {
            console.error(`Failed to create digest for tenant ${tenantId}:`, error);
        }
    }

    return results;
}

/**
 * Create a digest for a specific tenant.
 */
async function createDigestForTenant(tenantId: string): Promise<DigestResult | null> {
    // Get unreported detections for this tenant
    const detections = await sql`
    SELECT id, site_id, detection_type, severity, group_key, event_count,
           first_event_at, last_event_at, evidence
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

    if (detections.length === 0) {
        return null;
    }

    // Calculate aggregate values
    const detectionIds = detections.map(d => d.id as string);
    const totalEvents = detections.reduce((sum, d) => sum + Number(d.event_count), 0);

    // Get the highest severity
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    let highestSeverity = 'info';
    for (const d of detections) {
        const sev = d.severity as string;
        if (severityOrder.indexOf(sev) < severityOrder.indexOf(highestSeverity)) {
            highestSeverity = sev;
        }
    }

    // Calculate window times
    const firstDetection = detections[0];
    if (!firstDetection) return null;

    let firstEventAt = new Date(firstDetection.first_event_at as string);
    let lastEventAt = new Date(firstDetection.last_event_at as string);

    for (const d of detections) {
        const first = new Date(d.first_event_at as string);
        const last = new Date(d.last_event_at as string);
        if (first < firstEventAt) firstEventAt = first;
        if (last > lastEventAt) lastEventAt = last;
    }

    // Build subject and body
    const subject = buildSubject(tenantId, detections.length, highestSeverity);
    const bodyText = buildBodyText(detections);

    // Create digest
    const result = await sql`
    INSERT INTO digests (
      tenant_id, window_start, window_end, severity,
      detection_count, event_count, subject, body_text, locale
    ) VALUES (
      ${tenantId},
      ${firstEventAt.toISOString()},
      ${lastEventAt.toISOString()},
      ${highestSeverity},
      ${detections.length},
      ${totalEvents},
      ${subject},
      ${bodyText},
      'es'
    )
    RETURNING id
  `;

    const digestId = result[0]?.id as string;

    // Link detections to this digest
    await sql`
    UPDATE detections
    SET reported_digest_id = ${digestId}
    WHERE id = ANY(${detectionIds})
  `;

    return {
        digestId,
        tenantId,
        detectionCount: detections.length,
        eventCount: totalEvents,
        severity: highestSeverity,
    };
}

function buildSubject(tenantId: string, count: number, severity: string): string {
    const severityEmoji: Record<string, string> = {
        critical: '🚨',
        high: '⚠️',
        medium: '📢',
        low: 'ℹ️',
        info: '📋',
    };
    const emoji = severityEmoji[severity] || '📋';
    return `${emoji} Centinela Alert: ${count} detección(es) - ${severity.toUpperCase()} - ${tenantId}`;
}

function buildBodyText(detections: Record<string, unknown>[]): string {
    const lines: string[] = [
        'RESUMEN DE ALERTAS DE SEGURIDAD',
        '================================',
        '',
    ];

    for (const d of detections) {
        lines.push(`• ${d.detection_type} (${d.severity})`);
        lines.push(`  Origen: ${d.group_key}`);
        lines.push(`  Eventos: ${d.event_count}`);
        lines.push(`  Período: ${formatDate(d.first_event_at as Date)} - ${formatDate(d.last_event_at as Date)}`);
        lines.push('');
    }

    lines.push('---');
    lines.push('Este es un mensaje automático de Centinela Cloud.');

    return lines.join('\n');
}

function formatDate(date: Date): string {
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Get pending digests that haven't been emailed yet.
 */
export async function getPendingDigests(): Promise<DigestResult[]> {
    const results = await sql`
    SELECT d.id, d.tenant_id, d.detection_count, d.event_count, d.severity
    FROM digests d
    WHERE NOT EXISTS (
      SELECT 1 FROM email_deliveries e
      WHERE e.digest_id = d.id AND e.status = 'sent'
    )
    ORDER BY d.created_at ASC
  `;

    return results.map(row => ({
        digestId: row.id as string,
        tenantId: row.tenant_id as string,
        detectionCount: Number(row.detection_count),
        eventCount: Number(row.event_count),
        severity: row.severity as string,
    }));
}
