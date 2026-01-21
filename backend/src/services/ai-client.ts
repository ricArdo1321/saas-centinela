/**
 * AI Client Service
 *
 * Communicates with the ATA Orchestrator Agent to analyze threats.
 * Persists results (analysis, recommendations, and reports) in the database.
 */

import { sql } from '../db/index.js';
import { type Detection } from './rules-engine.js';
import {
  generatePatternSignature,
  lookupCachedAnalysis,
  saveToKnowledgeCache,
  type CachedAnalysis
} from './ai-learning.js';

const ORCHESTRATOR_URL = process.env['ATA_ORCHESTRATOR_URL'] || 'http://localhost:8080';

export interface AIReport {
  subject: string;
  body: string;
  model_used?: string | undefined;
  tokens_used?: number | undefined;
  latency_ms?: number | undefined;
}

export interface AIAnalysisResult {
  request_id?: string | undefined;
  analysis_id?: string | undefined;
  recommendation_id?: string | undefined;
  report_id?: string | undefined;
  report?: AIReport | undefined;
  judge?: {
    result: 'pass' | 'fail';
    reason: string;
  } | undefined;
  latency_ms?: number | undefined;
  error?: string | undefined;
  from_cache?: boolean | undefined;
}

/**
 * Trigger AI analysis for a detection via the ATA Orchestrator.
 * This calls the full pipeline: Analyst → Advisor → Judge → Writer
 */
export async function analyzeDetectionWithAI(
  detection: Detection,
  rawEventsSample: any[],
  normalizedEventsSample: any[]
): Promise<AIAnalysisResult> {
  console.log(`🤖 Requesting AI analysis for detection ${detection.group_key}...`);

  try {
    // 0. Check knowledge cache first
    const patternSignature = generatePatternSignature(detection);
    const cached = await lookupCachedAnalysis(detection.tenant_id, patternSignature);

    if (cached) {
      console.log(`🧠 Using cached analysis for pattern ${patternSignature.slice(0, 8)}... (hit #${cached.hit_count})`);
      return buildResultFromCache(cached, detection);
    }

    // 1. Call Orchestrator (cache miss)
    console.log(`📡 Cache miss, calling AI Orchestrator...`);
    const payload = {
      tenant_id: detection.tenant_id,
      site_id: detection.site_id,
      source_id: detection.source_id,
      detection: {
        detection_type: detection.detection_type,
        severity: detection.severity,
        detected_at: detection.last_event_at,
        group_key: detection.group_key,
        evidence: detection.evidence
      },
      raw_events: rawEventsSample,
      normalized_events: normalizedEventsSample
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch(`${ORCHESTRATOR_URL}/v1/ata/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Orchestrator responded with ${response.status}: ${response.statusText}`);
    }

    const aiResult = await response.json() as any;

    // Handle case where no threat was detected
    if (aiResult.status === 'no_threat_detected') {
      console.log(`ℹ️ AI determined no threat for ${detection.group_key}`);
      return {
        request_id: aiResult.request_id,
        latency_ms: aiResult.latency_ms
      };
    }

    if (!aiResult.analysis) {
      console.warn('⚠️ AI returned no analysis');
      return { request_id: aiResult.request_id };
    }

    // 2. Persist Analysis
    const analysis = aiResult.analysis;
    const analysisModelUsed = analysis.model_used || 'unknown';
    const totalLatency = aiResult.latency_ms || 0;

    const analysisInsert = await sql`
      INSERT INTO ai_analyses (
        tenant_id,
        threat_detected,
        threat_type,
        confidence_score,
        severity,
        context_summary,
        iocs,
        model_used,
        tokens_used,
        latency_ms,
        raw_response
      ) VALUES (
        ${detection.tenant_id},
        ${analysis.threat_detected ?? false},
        ${analysis.threat_type ?? null},
        ${analysis.confidence_score ?? null},
        ${analysis.severity ?? detection.severity},
        ${analysis.context_summary ?? null},
        ${JSON.stringify(analysis.iocs || [])},
        ${analysisModelUsed},
        ${analysis.tokens_used || 0},
        ${analysis.latency_ms || 0},
        ${JSON.stringify(aiResult)}
      )
      RETURNING id
    `;
    const analysisId = analysisInsert[0]?.id as string;

    // 3. Persist Recommendations (if any)
    let recommendationId: string | undefined;
    const recs = aiResult.recommendations;

    if (recs && recs.actions && recs.actions.length > 0) {
      const detectionId = (detection as any).id || null;

      const recInsert = await sql`
        INSERT INTO ai_recommendations (
          tenant_id,
          detection_id,
          ai_analysis_id,
          urgency,
          actions,
          model_used,
          tokens_used,
          latency_ms,
          raw_response
        ) VALUES (
          ${detection.tenant_id},
          ${detectionId},
          ${analysisId},
          ${recs.urgency || 'normal'},
          ${JSON.stringify(recs.actions)},
          ${recs.model_used || analysisModelUsed},
          ${recs.tokens_used || 0},
          ${recs.latency_ms || 0},
          ${JSON.stringify(recs)}
        )
        RETURNING id
      `;
      recommendationId = recInsert[0]?.id as string;
    }

    // 4. Persist Report from Writer (if any)
    let reportId: string | undefined;
    const report = aiResult.report;

    if (report && report.subject && report.body) {
      const detectionId = (detection as any).id || null;

      const reportInsert = await sql`
        INSERT INTO ai_reports (
          tenant_id,
          detection_id,
          ai_analysis_id,
          ai_recommendation_id,
          subject,
          body,
          locale,
          severity,
          threat_type,
          model_used,
          tokens_used,
          latency_ms,
          status,
          raw_response
        ) VALUES (
          ${detection.tenant_id},
          ${detectionId},
          ${analysisId},
          ${recommendationId || null},
          ${report.subject},
          ${report.body},
          'es',
          ${analysis.severity || detection.severity},
          ${analysis.threat_type || detection.detection_type},
          ${report.model_used || 'gpt-4o-mini'},
          ${report.tokens_used || 0},
          ${report.latency_ms || 0},
          'generated',
          ${JSON.stringify(report)}
        )
        RETURNING id
      `;
      reportId = reportInsert[0]?.id as string;
      console.log(`📝 AI Report saved: ${reportId}`);
    }

    console.log(`✅ AI Analysis complete: analysis=${analysisId}, recommendations=${recommendationId || 'none'}, report=${reportId || 'none'}`);

    // Save to knowledge cache for future reuse
    await saveToKnowledgeCache(detection.tenant_id, detection, aiResult);

    return {
      request_id: aiResult.request_id as string | undefined,
      analysis_id: analysisId,
      recommendation_id: recommendationId || undefined,
      report_id: reportId || undefined,
      report: report ? {
        subject: report.subject,
        body: report.body,
        model_used: report.model_used || undefined,
        tokens_used: report.tokens_used || undefined,
        latency_ms: report.latency_ms || undefined
      } : undefined,
      judge: aiResult.judge,
      latency_ms: totalLatency || undefined
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ AI Client Error:', errorMessage);
    return { error: errorMessage };
  }
}

/**
 * Build AIAnalysisResult from cached analysis.
 */
function buildResultFromCache(
  cached: CachedAnalysis,
  _detection: Detection
): AIAnalysisResult {
  const result: AIAnalysisResult = {
    from_cache: true
  };
  if (cached.report_subject && cached.report_body) {
    result.report = {
      subject: cached.report_subject,
      body: cached.report_body
    };
  }
  return result;
}


/**
 * Get AI report for a detection (if exists).
 */
export async function getReportForDetection(detectionId: string): Promise<AIReport | null> {
  const reports = await sql`
    SELECT subject, body, model_used, tokens_used, latency_ms
    FROM ai_reports
    WHERE detection_id = ${detectionId}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (reports.length === 0) return null;

  const r = reports[0]!;
  return {
    subject: r.subject as string,
    body: r.body as string,
    model_used: r.model_used as string,
    tokens_used: r.tokens_used as number,
    latency_ms: r.latency_ms as number
  };
}

/**
 * Get AI report by ID.
 */
export async function getReportById(reportId: string): Promise<AIReport | null> {
  const reports = await sql`
    SELECT subject, body, model_used, tokens_used, latency_ms
    FROM ai_reports
    WHERE id = ${reportId}
  `;

  if (reports.length === 0) return null;

  const r = reports[0]!;
  return {
    subject: r.subject as string,
    body: r.body as string,
    model_used: (r.model_used as string) || undefined,
    tokens_used: (r.tokens_used as number) || undefined,
    latency_ms: (r.latency_ms as number) || undefined
  };
}

/**
 * Get pending AI reports that haven't been sent yet.
 */
export async function getPendingAIReports(tenantId: string): Promise<Array<{
  id: string;
  detection_id: string | null;
  subject: string;
  body: string;
  severity: string | null;
  created_at: Date;
}>> {
  const reports = await sql`
    SELECT id, detection_id, subject, body, severity, created_at
    FROM ai_reports
    WHERE tenant_id = ${tenantId}
      AND status = 'generated'
    ORDER BY created_at ASC
  `;

  return reports.map(r => ({
    id: r.id as string,
    detection_id: r.detection_id as string | null,
    subject: r.subject as string,
    body: r.body as string,
    severity: r.severity as string | null,
    created_at: r.created_at as Date
  }));
}

/**
 * Mark AI report as sent.
 */
export async function markReportAsSent(reportId: string): Promise<void> {
  await sql`
    UPDATE ai_reports
    SET status = 'sent', sent_at = NOW()
    WHERE id = ${reportId}
  `;
}

/**
 * Mark AI report as failed.
 */
export async function markReportAsFailed(reportId: string, errorMessage: string): Promise<void> {
  await sql`
    UPDATE ai_reports
    SET status = 'failed', error_message = ${errorMessage}
    WHERE id = ${reportId}
  `;
}

/**
 * Check if orchestrator is available.
 */
export async function checkOrchestratorHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}
