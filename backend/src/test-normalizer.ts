/**
 * Script to test the normalizer by processing existing raw_events.
 */

import 'dotenv/config';
import { processRawEvents } from './services/index.js';
import { closeDatabase } from './db/index.js';

async function main() {
    console.log('🔄 Starting normalization of raw events...\n');

    const processed = await processRawEvents(100);

    console.log(`\n✅ Processed ${processed} event(s)`);

    await closeDatabase();
}

main().catch((err) => {
    console.error('💥 Error:', err);
    process.exit(1);
});
