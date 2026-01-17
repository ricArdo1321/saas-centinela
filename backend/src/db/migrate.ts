import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

interface Migration {
    name: string;
    content: string;
}

async function getMigrationFiles(): Promise<Migration[]> {
    const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    return files.map((name) => ({
        name,
        content: readFileSync(join(MIGRATIONS_DIR, name), 'utf-8'),
    }));
}

async function getAppliedMigrations(): Promise<Set<string>> {
    try {
        const rows = await sql`SELECT name FROM _migrations ORDER BY id`;
        return new Set(rows.map((r) => r.name));
    } catch {
        // Table doesn't exist yet, return empty set
        return new Set();
    }
}

async function runMigrations(): Promise<void> {
    console.log('🚀 Starting database migrations...\n');

    const migrations = await getMigrationFiles();
    const applied = await getAppliedMigrations();

    let appliedCount = 0;

    for (const migration of migrations) {
        if (applied.has(migration.name)) {
            console.log(`⏭️  Skipping ${migration.name} (already applied)`);
            continue;
        }

        console.log(`📄 Applying ${migration.name}...`);

        try {
            // Run migration in a transaction
            await sql.begin(async (tx) => {
                await tx.unsafe(migration.content);
                await tx.unsafe(`INSERT INTO _migrations (name) VALUES ('${migration.name.replace(/'/g, "''")}')`);
            });

            console.log(`✅ Applied ${migration.name}`);
            appliedCount++;
        } catch (error) {
            console.error(`❌ Failed to apply ${migration.name}:`, error);
            throw error;
        }
    }

    if (appliedCount === 0) {
        console.log('\n✨ All migrations already applied!');
    } else {
        console.log(`\n✨ Applied ${appliedCount} migration(s) successfully!`);
    }
}

// Run if executed directly
runMigrations()
    .then(() => {
        console.log('🎉 Migration complete!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Migration failed:', error);
        process.exit(1);
    });
