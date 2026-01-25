import type { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES } from '../lib/queue.js';
import { analyzeDetectionWithAI } from '../services/ai-client.js';
import type { Detection } from '../services/rules-engine.js';

interface AIJobData {
  detection: Detection;
  rawEventsSample?: any[];
  normalizedEventsSample?: any[];
}

/**
 * AI Worker
 *
 * Processes detections put into the 'ai-analysis-queue'.
 * Calls the Orchestrator Agent to perform:
 * 1. Analysis (Analyst Agent)
 * 2. Advice (Advisor Agent)
 * 3. Review (Judge Agent)
 * 4. Reporting (Writer Agent)
 */
export const aiWorker = createWorker(QUEUE_NAMES.AI_ANALYSIS, async (job: Job<AIJobData>) => {
  const { detection, rawEventsSample = [], normalizedEventsSample = [] } = job.data;

  console.log(`🤖 [Job ${job.id}] Starting AI analysis for detection ${detection.group_key} (Tenant: ${detection.tenant_id})`);

  try {
    const result = await analyzeDetectionWithAI(detection, rawEventsSample, normalizedEventsSample);

    if (result.error) {
      // If it's a transient error, throwing will cause BullMQ to retry based on backoff config
      throw new Error(`AI Client returned error: ${result.error}`);
    }

    console.log(`✅ [Job ${job.id}] AI Analysis complete. Report ID: ${result.report_id || 'None'}`);
    return result;

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [Job ${job.id}] AI Analysis failed: ${msg}`);
    throw error;
  }
});

aiWorker.on('completed', (job) => {
  console.log(`🎉 Job ${job.id} completed!`);
});

aiWorker.on('failed', (job, err) => {
  console.error(`🔥 Job ${job?.id} failed with ${err.message}`);
});
