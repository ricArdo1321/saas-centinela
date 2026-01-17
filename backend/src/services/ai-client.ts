/**
 * AI Client Service
 * 
 * Communicates with the ATA Orchestrator Agent to analyze threats.
 * Persists results in the database.
 */

import { sql } from '../db/index.js';
import { type Detection } from './rules-engine.js';

const ORCHESTRATOR_URL = process.env['ATA_ORCHESTRATOR_URL'] || 'http://localhost:8080';

export interface AIAnalysisResult {
  analysis_id?: string;
  recommendation_id?: string | undefined;
  report?: {
    subject: string;
    body: string;
  };
  error?: string;
}

/**
 * Trigger AI analysis for a detection.
 */
export async function analyzeDetectionWithAI(
  detection: Detection,
  rawEventsSample: any[],
  normalizedEventsSample: any[]
): Promise<AIAnalysisResult> {
  console.log(`🤖 Requesting AI analysis for detection ${detection.group_key}...`);

  try {
    // 1. Call Orchestrator
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

    const response = await fetch(`${ORCHESTRATOR_URL}/v1/ata/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Orchestrator responded with ${response.status}: ${response.statusText}`);
    }

    const aiResult = await response.json() as any;

    if (!aiResult.analysis) {
      console.warn('⚠️ AI returned no analysis');
      return {};
    }

    // 2. Persist Analysis
    const analysis = aiResult.analysis;
    const modelUsed = analysis.model_used || aiResult.model_used || 'unknown';
    const latency = aiResult.latency_ms || 0;

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
        ${analysis.threat_detected},
        ${analysis.threat_type},
        ${analysis.confidence_score},
        ${analysis.severity},
        ${analysis.context_summary},
        ${JSON.stringify(analysis.iocs || [])},
        ${modelUsed},
        ${aiResult.tokens_used || 0},
        ${latency},
        ${JSON.stringify(aiResult)}
      )
      RETURNING id
    `;
    const analysisId = analysisInsert[0]?.id as string;

    // 3. Persist Recommendations (if any)
    let recommendationId: string | undefined;
    const recs = aiResult.recommendations;

    if (recs && recs.actions && recs.actions.length > 0) {
      const recInsert = await sql`
        INSERT INTO ai_recommendations (
          tenant_id,
          detection_id,
          ai_analysis_id,
          urgency,
          actions,
          model_used
        ) VALUES (
          ${detection.tenant_id},
          ${(detection as any).id}, -- Assuming detection obj has ID if retrieved from DB, but interface detection doesn't have ID field explicitly in rules-engine.ts, check types
          ${analysisId},
          ${recs.urgency || 'normal'},
          ${JSON.stringify(recs.actions)},
          ${recs.model_used || modelUsed}
        )
        RETURNING id
      `;
      recommendationId = recInsert[0]?.id as string;
    }

    console.log(`✅ AI Analysis saved: ${analysisId}`);

    return {
      analysis_id: analysisId,
      recommendation_id: recommendationId,
      report: aiResult.report
    };

  } catch (error) {
    console.error('❌ AI Client Error:', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
