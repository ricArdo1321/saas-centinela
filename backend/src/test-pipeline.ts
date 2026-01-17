/**
 * Script to test the complete pipeline:
 * 1. Run detection rules
 * 2. Create digests from detections
 */

import 'dotenv/config';
import { closeDatabase } from './db/index.js';
import { runDetectionRules, createDigests } from './services/index.js';

async function main() {
    console.log('🧪 Testing Complete Pipeline\n');

    // 1. Run detection rules
    console.log('1️⃣ Running detection rules...');
    const detections = await runDetectionRules(60);
    console.log(`   ✅ Created/updated ${detections} detection(s)\n`);

    // 2. Create digests
    console.log('2️⃣ Creating digests...');
    const digests = await createDigests();
    console.log(`   ✅ Created ${digests.length} digest(s)\n`);

    for (const d of digests) {
        console.log(`   📧 Digest ${d.digestId}:`);
        console.log(`      Tenant: ${d.tenantId}`);
        console.log(`      Severity: ${d.severity}`);
        console.log(`      Detections: ${d.detectionCount}`);
        console.log(`      Events: ${d.eventCount}`);
    }

    await closeDatabase();
    console.log('\n✅ Pipeline test complete!');
}

main().catch((err) => {
    console.error('💥 Error:', err);
    process.exit(1);
});
