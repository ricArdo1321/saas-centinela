/**
 * Worker Process Entry Point
 *
 * Orchestrates the background workers using BullMQ:
 * 1. Pipeline Worker: Periodic processing (Normalize -> Detect -> Schedule AI -> Batch -> Email)
 * 2. AI Worker: Async processing of heavy AI tasks
 * 3. Ingest Worker: Async persistence of raw logs from API
 */

import 'dotenv/config';
import { closeDatabase, testConnection } from './db/index.js';
import {
    processRawEvents,
    runDetectionRules,
    createDigests,
    sendPendingDigests,
    getUnreportedDetections
} from './services/index.js';
import { createWorker, QUEUE_NAMES, pipelineQueue, aiAnalysisQueue, closeRedis } from './lib/queue.js';
import { aiWorker } from './workers/ai-worker.js'; // Imports and starts the AI worker
import { ingestWorker } from './workers/ingest-worker.js';

// ----------------------------------------------------------------------
// Pipeline Worker (Recurring Job)
// ----------------------------------------------------------------------

const pipelineWorker = createWorker(QUEUE_NAMES.PIPELINE, async (job) => {
    const startTime = Date.now();
    console.log(`\n🔄 [${new Date().toISOString()}] Executing Pipeline Job ${job.id}...`);

    try {
        // 1. Normalize any new raw events
        const normalized = await processRawEvents(500);
        if (normalized > 0) {
            console.log(`   📝 Normalized ${normalized} events`);
        }

        // 2. Run detection rules
        const detectionsCount = await runDetectionRules(15); // Last 15 minutes
        if (detectionsCount > 0) {
            console.log(`   🚨 Created ${detectionsCount} detection(s)`);

            // AI Integration: Analyze High/Critical detections
            // Fetch detections for 'dev-tenant' (MVP)
            const highSevDetections = await getUnreportedDetections('dev-tenant');

            let queuedAi = 0;
            for (const det of highSevDetections) {
                if (det.severity === 'high' || det.severity === 'critical') {
                    // Offload to AI Queue (Async)
                    await aiAnalysisQueue.add('analyze-threat', {
                        detection: det,
                        rawEventsSample: [], // In future: fetch real related events
                        normalizedEventsSample: []
                    });
                    queuedAi++;
                }
            }
            if (queuedAi > 0) console.log(`   ➡️  Enqueued ${queuedAi} detection(s) for AI analysis`);
        }

        // 3. Create digests from unreported detections
        // Note: In this async model, batching might happen before AI finishes.
        // Ideally, we wait or have a separate batching schedule.
        // For MVP, we proceed. If AI report is ready (fast), it gets included. If not, next time?
        // Actually, once 'reported_digest_id' is set, it won't be processed again.
        // A future improvement is to delay batching for high-sev items until AI is 'done' or timed out.
        const digests = await createDigests();
        if (digests.length > 0) {
            console.log(`   📧 Created ${digests.length} digest(s)`);
        }

        // 4. Send pending digest emails
        const sent = await sendPendingDigests();
        if (sent > 0) {
            console.log(`   ✉️  Sent ${sent} email(s)`);
        }

        const elapsed = Date.now() - startTime;
        console.log(`   ✅ Pipeline finished in ${elapsed}ms`);

    } catch (error) {
        console.error('   ❌ Pipeline failed:', error);
        throw error; // Triggers BullMQ retry
    }
});

// ----------------------------------------------------------------------
// Main Entry Point
// ----------------------------------------------------------------------

async function main() {
    console.log('🚀 Centinela Queue Workers starting...');
    console.log(`   AI Worker: ${aiWorker.isRunning() ? 'Online' : 'Offline'}`);
    console.log(`   Ingest Worker: ${ingestWorker.isRunning() ? 'Online' : 'Offline'}`);

    // Test database connection
    const dbOk = await testConnection();
    if (!dbOk) {
        console.error('❌ Database connection failed. Exiting.');
        process.exit(1);
    }
    console.log('✅ Database connected');

    // Clean up old schedules to avoid duplicates
    const repeatableJobs = await pipelineQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await pipelineQueue.removeRepeatableByKey(job.key);
    }

    // Schedule the Pipeline Job
    const interval = parseInt(process.env.WORKER_INTERVAL_MS || '60000', 10);

    await pipelineQueue.add('run-pipeline', {}, {
        repeat: {
            every: interval
        }
    });

    console.log(`   📅 Pipeline scheduled to run every ${interval}ms`);

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n🛑 Shutting down workers...');

        await pipelineWorker.close();
        await aiWorker.close();
        await ingestWorker.close();

        await closeRedis();
        await closeDatabase();

        console.log('👋 Workers stopped');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
