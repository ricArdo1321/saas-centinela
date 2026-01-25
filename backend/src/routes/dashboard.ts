/**
 * Dashboard Routes
 *
 * API endpoints for the Centinela dashboard frontend.
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { sql } from '../db/index.js';

export async function dashboardRoutes(
    app: FastifyInstance,
    _opts: FastifyPluginOptions
): Promise<void> {

    // ============================================
    // Dashboard Stats
    // ============================================

    app.get('/v1/dashboard/stats', async (req, reply) => {
        try {
            // Get stats for last 24 hours
            const now = new Date();
            const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            // Detections by severity (last 24h)
            const detectionStats = await sql`
        SELECT
          severity,
          COUNT(*) as count
        FROM detections
        WHERE detected_at >= ${last24h.toISOString()}
        GROUP BY severity
      `;

            // Events processed (last 24h)
            const eventStats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= ${last24h.toISOString()}) as last_24h,
          COUNT(*) FILTER (WHERE created_at >= ${last7d.toISOString()}) as last_7d
        FROM normalized_events
      `;

            // AI Cache stats
            const cacheStats = await sql`
        SELECT
          COUNT(*) as total_patterns,
          COUNT(*) FILTER (WHERE is_valid = TRUE AND expires_at > NOW()) as valid_patterns,
          COALESCE(SUM(hit_count), 0) as total_hits
        FROM ai_knowledge_cache
      `;

            // Digests sent (last 24h)
            const digestStats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE sent_at >= ${last24h.toISOString()}) as last_24h,
          COUNT(*) FILTER (WHERE sent_at >= ${last7d.toISOString()}) as last_7d
        FROM email_deliveries
        WHERE status = 'sent'
      `;

            // AI Agents health (check via orchestrator)
            let agentsHealthy = false;
            try {
                const orchestratorUrl = process.env['ATA_ORCHESTRATOR_URL'] || 'http://localhost:8080';
                const response = await fetch(`${orchestratorUrl}/healthz`, {
                    signal: AbortSignal.timeout(3000)
                });
                agentsHealthy = response.ok;
            } catch {
                agentsHealthy = false;
            }

            // Build response
            const severityCounts: Record<string, number> = {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0
            };
            for (const row of detectionStats) {
                const sev = row.severity as string;
                severityCounts[sev] = Number(row.count);
            }

            const totalHits = Number(cacheStats[0]?.total_hits) || 0;
            const totalPatterns = Number(cacheStats[0]?.total_patterns) || 0;
            const cacheHitRate = totalPatterns > 0 ? totalHits / (totalHits + totalPatterns) : 0;

            return {
                ok: true,
                stats: {
                    detections: {
                        critical: severityCounts.critical,
                        high: severityCounts.high,
                        medium: severityCounts.medium,
                        low: severityCounts.low,
                        total_24h: Object.values(severityCounts).reduce((a, b) => a + b, 0)
                    },
                    events: {
                        processed_24h: Number(eventStats[0]?.last_24h) || 0,
                        processed_7d: Number(eventStats[0]?.last_7d) || 0
                    },
                    cache: {
                        total_patterns: totalPatterns,
                        valid_patterns: Number(cacheStats[0]?.valid_patterns) || 0,
                        total_hits: totalHits,
                        hit_rate: Math.round(cacheHitRate * 100) / 100
                    },
                    digests: {
                        sent_24h: Number(digestStats[0]?.last_24h) || 0,
                        sent_7d: Number(digestStats[0]?.last_7d) || 0
                    },
                    agents: {
                        healthy: agentsHealthy
                    }
                },
                generated_at: now.toISOString()
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get dashboard stats');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });

    // ============================================
    // Detections
    // ============================================

    app.get('/v1/detections', async (req, reply) => {
        try {
            const query = req.query as {
                limit?: string;
                offset?: string;
                severity?: string;
                detection_type?: string;
                from?: string;
                to?: string;
            };

            const limit = Math.min(parseInt(query.limit || '50', 10), 100);
            const offset = parseInt(query.offset || '0', 10);

            // Build dynamic query
            let detections;
            if (query.severity) {
                detections = await sql`
          SELECT
            id, tenant_id, site_id, detection_type, severity,
            group_key, event_count, first_event_at, last_event_at,
            evidence, reported_digest_id, created_at
          FROM detections
          WHERE severity = ${query.severity}
          ORDER BY detected_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
            } else {
                detections = await sql`
          SELECT
            id, tenant_id, site_id, detection_type, severity,
            group_key, event_count, first_event_at, last_event_at,
            evidence, reported_digest_id, created_at
          FROM detections
          ORDER BY detected_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
            }

            // Get total count
            const countResult = await sql`
        SELECT COUNT(*) as total FROM detections
      `;

            return {
                ok: true,
                data: detections,
                pagination: {
                    limit,
                    offset,
                    total: Number(countResult[0]?.total) || 0
                }
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get detections');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });

    app.get('/v1/detections/:id', async (req, reply) => {
        try {
            const { id } = req.params as { id: string };

            const detections = await sql`
        SELECT * FROM detections WHERE id = ${id}
      `;

            if (detections.length === 0) {
                return reply.code(404).send({ ok: false, error: 'not_found' });
            }

            // Get related AI analysis
            const analyses = await sql`
        SELECT * FROM ai_analyses
        WHERE id IN (
          SELECT ai_analysis_id FROM ai_recommendations WHERE detection_id = ${id}
        )
        LIMIT 1
      `;

            // Get related AI recommendations
            const recommendations = await sql`
        SELECT * FROM ai_recommendations WHERE detection_id = ${id}
        ORDER BY created_at DESC LIMIT 1
      `;

            // Get related AI report
            const reports = await sql`
        SELECT * FROM ai_reports WHERE detection_id = ${id}
        ORDER BY created_at DESC LIMIT 1
      `;

            return {
                ok: true,
                detection: detections[0],
                ai: {
                    analysis: analyses[0] || null,
                    recommendation: recommendations[0] || null,
                    report: reports[0] || null
                }
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get detection');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });

    // ============================================
    // AI Analyses
    // ============================================

    app.get('/v1/ai/analyses', async (req, reply) => {
        try {
            const query = req.query as { limit?: string; offset?: string };
            const limit = Math.min(parseInt(query.limit || '50', 10), 100);
            const offset = parseInt(query.offset || '0', 10);

            const analyses = await sql`
        SELECT
          id, tenant_id, analyzed_at, threat_detected, threat_type,
          confidence_score, severity, context_summary, model_used,
          tokens_used, latency_ms, created_at
        FROM ai_analyses
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

            const countResult = await sql`
        SELECT COUNT(*) as total FROM ai_analyses
      `;

            return {
                ok: true,
                data: analyses,
                pagination: {
                    limit,
                    offset,
                    total: Number(countResult[0]?.total) || 0
                }
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get AI analyses');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });

    // ============================================
    // AI Reports
    // ============================================

    app.get('/v1/ai/reports', async (req, reply) => {
        try {
            const query = req.query as { limit?: string; offset?: string; status?: string };
            const limit = Math.min(parseInt(query.limit || '50', 10), 100);
            const offset = parseInt(query.offset || '0', 10);

            const reports = await sql`
        SELECT
          id, tenant_id, detection_id, subject, body, severity,
          threat_type, model_used, tokens_used, latency_ms,
          status, sent_at, created_at
        FROM ai_reports
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

            const countResult = await sql`
        SELECT COUNT(*) as total FROM ai_reports
      `;

            return {
                ok: true,
                data: reports,
                pagination: {
                    limit,
                    offset,
                    total: Number(countResult[0]?.total) || 0
                }
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get AI reports');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });

    // ============================================
    // AI Knowledge Cache
    // ============================================

    app.get('/v1/ai/cache/stats', async (req, reply) => {
        try {
            const stats = await sql`
        SELECT
          COUNT(*) as total_patterns,
          COUNT(*) FILTER (WHERE is_valid = TRUE AND expires_at > NOW()) as valid_patterns,
          COUNT(*) FILTER (WHERE is_valid = FALSE OR expires_at <= NOW()) as expired_patterns,
          COALESCE(SUM(hit_count), 0) as total_hits,
          COALESCE(AVG(hit_count), 0) as avg_hits_per_pattern
        FROM ai_knowledge_cache
      `;

            const topPatterns = await sql`
        SELECT
          pattern_signature, detection_type, severity, hit_count, last_hit_at, expires_at
        FROM ai_knowledge_cache
        WHERE is_valid = TRUE AND expires_at > NOW()
        ORDER BY hit_count DESC
        LIMIT 10
      `;

            const row = stats[0]!;
            const totalHits = Number(row.total_hits) || 0;
            const totalPatterns = Number(row.total_patterns) || 0;

            return {
                ok: true,
                stats: {
                    total_patterns: totalPatterns,
                    valid_patterns: Number(row.valid_patterns) || 0,
                    expired_patterns: Number(row.expired_patterns) || 0,
                    total_hits: totalHits,
                    avg_hits_per_pattern: Number(row.avg_hits_per_pattern) || 0,
                    cache_hit_rate: totalPatterns > 0 ? Math.round((totalHits / (totalHits + totalPatterns)) * 100) / 100 : 0
                },
                top_patterns: topPatterns
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get cache stats');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });

    app.get('/v1/ai/cache/patterns', async (req, reply) => {
        try {
            const query = req.query as { limit?: string; offset?: string };
            const limit = Math.min(parseInt(query.limit || '50', 10), 100);
            const offset = parseInt(query.offset || '0', 10);

            const patterns = await sql`
        SELECT
          id, pattern_signature, detection_type, severity,
          threat_detected, threat_type, hit_count, last_hit_at,
          is_valid, expires_at, created_at
        FROM ai_knowledge_cache
        ORDER BY hit_count DESC, created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

            const countResult = await sql`
        SELECT COUNT(*) as total FROM ai_knowledge_cache
      `;

            return {
                ok: true,
                data: patterns,
                pagination: {
                    limit,
                    offset,
                    total: Number(countResult[0]?.total) || 0
                }
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get cache patterns');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });

    // ============================================
    // Digests
    // ============================================

    app.get('/v1/digests', async (req, reply) => {
        try {
            const query = req.query as { limit?: string; offset?: string };
            const limit = Math.min(parseInt(query.limit || '50', 10), 100);
            const offset = parseInt(query.offset || '0', 10);

            const digests = await sql`
        SELECT
          d.id, d.tenant_id, d.window_start, d.window_end, d.severity,
          d.detection_count, d.event_count, d.subject, d.locale,
          d.ai_report_id, d.created_at,
          (SELECT COUNT(*) FROM email_deliveries e WHERE e.digest_id = d.id AND e.status = 'sent') as emails_sent
        FROM digests d
        ORDER BY d.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

            const countResult = await sql`
        SELECT COUNT(*) as total FROM digests
      `;

            return {
                ok: true,
                data: digests,
                pagination: {
                    limit,
                    offset,
                    total: Number(countResult[0]?.total) || 0
                }
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get digests');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });

    // ============================================
    // Recent Activity (combined feed)
    // ============================================

    app.get('/v1/activity', async (req, reply) => {
        try {
            const query = req.query as { limit?: string };
            const limit = Math.min(parseInt(query.limit || '20', 10), 50);

            // Get recent detections
            const recentDetections = await sql`
        SELECT
          id, 'detection' as type, detection_type as title, severity,
          created_at as timestamp
        FROM detections
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

            // Get recent AI reports
            const recentReports = await sql`
        SELECT
          id, 'ai_report' as type, subject as title, severity,
          created_at as timestamp
        FROM ai_reports
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

            // Get recent digests sent
            const recentDigests = await sql`
        SELECT
          d.id, 'digest' as type, d.subject as title, d.severity,
          d.created_at as timestamp
        FROM digests d
        WHERE EXISTS (SELECT 1 FROM email_deliveries e WHERE e.digest_id = d.id)
        ORDER BY d.created_at DESC
        LIMIT ${limit}
      `;

            // Combine and sort by timestamp
            const activity = [
                ...recentDetections.map(r => ({ ...r, type: 'detection' })),
                ...recentReports.map(r => ({ ...r, type: 'ai_report' })),
                ...recentDigests.map(r => ({ ...r, type: 'digest' }))
            ].sort((a, b) => {
                const dateA = new Date((a as any).timestamp as string);
                const dateB = new Date((b as any).timestamp as string);
                return dateB.getTime() - dateA.getTime();
            }).slice(0, limit);

            return {
                ok: true,
                data: activity
            };
        } catch (error) {
            req.log.error({ err: error }, 'Failed to get activity');
            return reply.code(500).send({ ok: false, error: 'internal_error' });
        }
    });
}
