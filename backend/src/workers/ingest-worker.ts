import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES } from '../lib/queue.js';
import { sql } from '../db/index.js';

interface IngestJobData {
  tenant_id: string;
  site_id?: string;
  source_id?: string;
  received_at: string;
  source_ip?: string;
  raw_message: string;
  collector_name?: string;
}

/**
 * Ingest Worker
 *
 * Consumes raw syslog events from the 'ingest-queue'.
 * Inserts them into the Postgres database for further processing by the pipeline.
 * This decouples the API ingestion speed from the DB write speed.
 */
export const ingestWorker = createWorker(QUEUE_NAMES.INGEST, async (job: Job<IngestJobData>) => {
  const {
    tenant_id,
    site_id,
    source_id,
    received_at,
    source_ip,
    raw_message,
    collector_name
  } = job.data;

  // Bulk insert could be implemented here for higher throughput by buffering jobs,
  // but for now, we process one by one to ensure durability.

  try {
    const result = await sql`
      INSERT INTO raw_events (
        tenant_id,
        site_id,
        source_id,
        received_at,
        source_ip,
        raw_message,
        collector_name
      ) VALUES (
        ${tenant_id},
        ${site_id ?? null},
        ${source_id ?? null},
        ${received_at},
        ${source_ip ?? null},
        ${raw_message},
        ${collector_name ?? null}
      )
      RETURNING id
    `;

    // Logging every single insert might be too noisy for high throughput
    // console.log(`📥 [Job ${job.id}] Persisted event ${result[0].id}`);

    return { event_id: result[0]!.id };

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown DB error';
    console.error(`❌ [Job ${job.id}] Failed to persist event: ${msg}`);
    throw error; // Trigger retry
  }
}, {
  concurrency: 10 // Allow higher concurrency for IO-bound DB inserts
});

ingestWorker.on('failed', (job, err) => {
  console.error(`🔥 Ingest Job ${job?.id} failed permanently: ${err.message}`);
});
