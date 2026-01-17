/**
 * Worker Process
 * 
 * Runs the complete detection pipeline on a schedule:
 * 1. Normalize raw events
 * 2. Run detection rules
 * 3. Create digests
 * 4. Send emails
 */

import 'dotenv/config';
import { closeDatabase, testConnection } from './db/index.js';
import {
    processRawEvents,
    runDetectionRules,
    createDigests,
    sendPendingDigests,
} from './services/index.js';

const INTERVAL_MS = parseInt(process.env['WORKER_INTERVAL_MS'] || '60000', 10); // Default: 1 minute

async function runPipeline(): Promise<void> {
    const startTime = Date.now();
    console.log(`\n🔄 [${new Date().toISOString()}] Running pipeline...`);

    try {
        // 1. Normalize any new raw events
        const normalized = await processRawEvents(500);
        if (normalized > 0) {
            console.log(`   📝 Normalized ${normalized} events`);
        }

        // 2. Run detection rules
        const detections = await runDetectionRules(15); // Last 15 minutes
        if (detections > 0) {
            console.log(`   🚨 Created ${detections} detection(s)`);
        }

        // 3. Create digests from unreported detections
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
        console.log(`   ✅ Pipeline completed in ${elapsed}ms`);

    } catch (error) {
        console.error('   ❌ Pipeline error:', error);
    }
}

async function main(): Promise<void> {
    console.log('🚀 Centinela Worker starting...');
    console.log(`   Interval: ${INTERVAL_MS}ms`);

    // Test database connection
    const dbOk = await testConnection();
    if (!dbOk) {
        console.error('❌ Database connection failed. Exiting.');
        process.exit(1);
    }
    console.log('✅ Database connected');

    // Run immediately on start
    await runPipeline();

    // Then run on interval
    const intervalId = setInterval(runPipeline, INTERVAL_MS);

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n🛑 Shutting down worker...');
        clearInterval(intervalId);
        await closeDatabase();
        console.log('👋 Worker stopped');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
