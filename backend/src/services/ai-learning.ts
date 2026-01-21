/**
 * AI Learning Service
 *
 * Provides pattern caching to avoid redundant AI API calls.
 * Learns from previous analyses and reuses responses for similar patterns.
 */

import { createHash } from 'crypto';
import { sql } from '../db/index.js';
import { type Detection } from './rules-engine.js';

const CACHE_TTL_DAYS = parseInt(process.env['AI_CACHE_TTL_DAYS'] || '30', 10);

export interface CachedAnalysis {
    id: string;
    pattern_signature: string;
    threat_detected: boolean;
    threat_type: string | null;
    confidence_score: number | null;
    context_summary: string | null;
    recommended_actions: any[] | null;
    report_subject: string | null;
    report_body: string | null;
    hit_count: number;
}

/**
 * Generate a pattern signature (SHA-256 hash) from detection characteristics.
 * The signature is based on:
 * - detection_type (e.g., vpn_bruteforce, admin_login_fail)
 * - severity (low, medium, high, critical)
 * - Normalized evidence keys (sorted for consistency)
 */
export function generatePatternSignature(detection: Detection): string {
    const evidence = (detection.evidence || {}) as Record<string, unknown>;

    // Extract key characteristics from evidence (normalize for consistency)
    const normalizedEvidence: Record<string, unknown> = {};

    // Include counts but not specific values (IPs, users, etc.)
    if (typeof evidence['unique_ips'] === 'number') {
        normalizedEvidence.ip_count_range = categorizeCount(evidence['unique_ips']);
    }
    if (typeof evidence['unique_users'] === 'number') {
        normalizedEvidence.user_count_range = categorizeCount(evidence['unique_users']);
    }
    if (typeof evidence['total_attempts'] === 'number') {
        normalizedEvidence.attempt_count_range = categorizeCount(evidence['total_attempts']);
    }

    // Build signature input
    const signatureInput = {
        detection_type: detection.detection_type,
        severity: detection.severity,
        evidence_pattern: normalizedEvidence
    };

    // Create SHA-256 hash
    const hash = createHash('sha256');
    hash.update(JSON.stringify(signatureInput));
    return hash.digest('hex');
}

/**
 * Categorize count into ranges for pattern matching.
 * This allows similar but not identical counts to match.
 */
function categorizeCount(count: number): string {
    if (count <= 1) return '1';
    if (count <= 5) return '2-5';
    if (count <= 10) return '6-10';
    if (count <= 25) return '11-25';
    if (count <= 50) return '26-50';
    if (count <= 100) return '51-100';
    return '100+';
}

/**
 * Look up a cached analysis by pattern signature.
 * Returns null if no valid cache entry exists.
 */
export async function lookupCachedAnalysis(
    tenantId: string,
    patternSignature: string
): Promise<CachedAnalysis | null> {
    const results = await sql`
    SELECT
      id,
      pattern_signature,
      threat_detected,
      threat_type,
      confidence_score,
      context_summary,
      recommended_actions,
      report_subject,
      report_body,
      hit_count
    FROM ai_knowledge_cache
    WHERE tenant_id = ${tenantId}
      AND pattern_signature = ${patternSignature}
      AND is_valid = TRUE
      AND expires_at > NOW()
    LIMIT 1
  `;

    if (results.length === 0) {
        return null;
    }

    const row = results[0]!;

    // Update hit count and last_hit_at
    await sql`
    UPDATE ai_knowledge_cache
    SET hit_count = hit_count + 1, last_hit_at = NOW()
    WHERE id = ${row.id}
  `;

    return {
        id: row.id as string,
        pattern_signature: row.pattern_signature as string,
        threat_detected: row.threat_detected as boolean,
        threat_type: row.threat_type as string | null,
        confidence_score: row.confidence_score ? Number(row.confidence_score) : null,
        context_summary: row.context_summary as string | null,
        recommended_actions: row.recommended_actions as any[] | null,
        report_subject: row.report_subject as string | null,
        report_body: row.report_body as string | null,
        hit_count: (row.hit_count as number) + 1
    };
}

/**
 * Save a new analysis to the knowledge cache.
 */
export async function saveToKnowledgeCache(
    tenantId: string,
    detection: Detection,
    aiResult: {
        analysis?: {
            threat_detected?: boolean;
            threat_type?: string;
            confidence_score?: number;
            context_summary?: string;
        };
        recommendations?: {
            actions?: any[];
        };
        report?: {
            subject?: string;
            body?: string;
        };
    }
): Promise<string | null> {
    const signature = generatePatternSignature(detection);
    const analysis = aiResult.analysis;
    const recs = aiResult.recommendations;
    const report = aiResult.report;

    // Don't cache if no analysis was performed
    if (!analysis) {
        return null;
    }

    try {
        const result = await sql`
      INSERT INTO ai_knowledge_cache (
        tenant_id,
        pattern_signature,
        detection_type,
        severity,
        threat_detected,
        threat_type,
        confidence_score,
        context_summary,
        recommended_actions,
        report_subject,
        report_body,
        expires_at
      ) VALUES (
        ${tenantId},
        ${signature},
        ${detection.detection_type},
        ${detection.severity},
        ${analysis.threat_detected ?? false},
        ${analysis.threat_type ?? null},
        ${analysis.confidence_score ?? null},
        ${analysis.context_summary ?? null},
        ${JSON.stringify(recs?.actions || [])},
        ${report?.subject ?? null},
        ${report?.body ?? null},
        NOW() + INTERVAL '${sql.unsafe(String(CACHE_TTL_DAYS))} days'
      )
      ON CONFLICT (tenant_id, pattern_signature)
      DO UPDATE SET
        threat_detected = EXCLUDED.threat_detected,
        threat_type = EXCLUDED.threat_type,
        confidence_score = EXCLUDED.confidence_score,
        context_summary = EXCLUDED.context_summary,
        recommended_actions = EXCLUDED.recommended_actions,
        report_subject = EXCLUDED.report_subject,
        report_body = EXCLUDED.report_body,
        expires_at = EXCLUDED.expires_at,
        is_valid = TRUE
      RETURNING id
    `;

        const id = result[0]?.id as string;
        console.log(`🧠 Cached pattern ${signature.slice(0, 8)}... for future reuse`);
        return id;
    } catch (error) {
        console.error('Failed to save to knowledge cache:', error);
        return null;
    }
}

/**
 * Invalidate a specific pattern (e.g., if rules change).
 */
export async function invalidatePattern(
    tenantId: string,
    patternSignature: string
): Promise<void> {
    await sql`
    UPDATE ai_knowledge_cache
    SET is_valid = FALSE
    WHERE tenant_id = ${tenantId}
      AND pattern_signature = ${patternSignature}
  `;
}

/**
 * Invalidate all patterns for a detection type (e.g., if detection logic changes).
 */
export async function invalidateByDetectionType(
    tenantId: string,
    detectionType: string
): Promise<number> {
    const result = await sql`
    UPDATE ai_knowledge_cache
    SET is_valid = FALSE
    WHERE tenant_id = ${tenantId}
      AND detection_type = ${detectionType}
    RETURNING id
  `;
    return result.length;
}

/**
 * Get cache statistics for a tenant.
 */
export async function getCacheStats(tenantId: string): Promise<{
    total_entries: number;
    valid_entries: number;
    total_hits: number;
    cache_hit_rate: number;
}> {
    const stats = await sql`
    SELECT
      COUNT(*) as total_entries,
      COUNT(*) FILTER (WHERE is_valid = TRUE AND expires_at > NOW()) as valid_entries,
      COALESCE(SUM(hit_count), 0) as total_hits
    FROM ai_knowledge_cache
    WHERE tenant_id = ${tenantId}
  `;

    const row = stats[0]!;
    const totalEntries = Number(row.total_entries) || 0;
    const validEntries = Number(row.valid_entries) || 0;
    const totalHits = Number(row.total_hits) || 0;

    // Cache hit rate = hits / (hits + entries), approximation
    const cacheHitRate = totalHits > 0 ? totalHits / (totalHits + totalEntries) : 0;

    return {
        total_entries: totalEntries,
        valid_entries: validEntries,
        total_hits: totalHits,
        cache_hit_rate: Math.round(cacheHitRate * 100) / 100
    };
}

/**
 * Clean up expired cache entries.
 * Call periodically (e.g., daily via cron or worker).
 */
export async function cleanupExpiredCache(): Promise<number> {
    const result = await sql`
    DELETE FROM ai_knowledge_cache
    WHERE expires_at < NOW() OR is_valid = FALSE
    RETURNING id
  `;
    return result.length;
}
