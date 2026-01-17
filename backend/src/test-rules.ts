/**
 * Script to test the rules engine by:
 * 1. Inserting test VPN login fail events
 * 2. Processing them with normalizer
 * 3. Running detection rules
 */

import 'dotenv/config';
import { sql, closeDatabase } from './db/index.js';
import { processRawEvents, runDetectionRules } from './services/index.js';

async function main() {
    console.log('🧪 Testing Rules Engine\n');

    // 1. Insert test VPN login fail events (simulate bruteforce from same IP)
    console.log('1️⃣ Inserting test VPN login fail events...');

    const testEvents = [
        'date=2026-01-17 time=15:30:00 logid=0101039424 type=event subtype=vpn action=ssl-login-fail user=hacker1 srcip=192.168.100.50 reason="sslvpn login fail"',
        'date=2026-01-17 time=15:30:15 logid=0101039424 type=event subtype=vpn action=ssl-login-fail user=hacker2 srcip=192.168.100.50 reason="sslvpn login fail"',
        'date=2026-01-17 time=15:30:30 logid=0101039424 type=event subtype=vpn action=ssl-login-fail user=hacker3 srcip=192.168.100.50 reason="sslvpn login fail"',
        'date=2026-01-17 time=15:30:45 logid=0101039424 type=event subtype=vpn action=ssl-login-fail user=hacker4 srcip=192.168.100.50 reason="sslvpn login fail"',
        'date=2026-01-17 time=15:31:00 logid=0101039424 type=event subtype=vpn action=ssl-login-fail user=hacker5 srcip=192.168.100.50 reason="sslvpn login fail"',
        'date=2026-01-17 time=15:31:15 logid=0101039424 type=event subtype=vpn action=ssl-login-fail user=admin srcip=192.168.100.50 reason="sslvpn login fail"',
    ];

    for (const rawMessage of testEvents) {
        await sql`
      INSERT INTO raw_events (tenant_id, site_id, source_id, raw_message, source_ip)
      VALUES ('test-tenant', 'test-site', 'fortigate-test', ${rawMessage}, '192.168.100.50')
    `;
    }
    console.log(`   ✅ Inserted ${testEvents.length} test events\n`);

    // 2. Process raw events with normalizer
    console.log('2️⃣ Normalizing events...');
    const normalized = await processRawEvents(100);
    console.log(`   ✅ Normalized ${normalized} events\n`);

    // 3. Run detection rules
    console.log('3️⃣ Running detection rules...');
    const detections = await runDetectionRules(60); // Look back 60 minutes
    console.log(`   ✅ Created ${detections} detection(s)\n`);

    // 4. Show detections
    console.log('4️⃣ Current detections:');
    const allDetections = await sql`
    SELECT detection_type, severity, group_key, event_count, first_event_at, last_event_at
    FROM detections
    WHERE tenant_id = 'test-tenant'
    ORDER BY last_event_at DESC
  `;

    for (const d of allDetections) {
        console.log(`   🚨 ${d.detection_type} | ${d.severity} | ${d.group_key} | ${d.event_count} events`);
    }

    await closeDatabase();
    console.log('\n✅ Test complete!');
}

main().catch((err) => {
    console.error('💥 Error:', err);
    process.exit(1);
});
