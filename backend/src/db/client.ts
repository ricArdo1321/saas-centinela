import postgres from 'postgres';

// Environment-based configuration
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://centinela:centinela_dev_password@localhost:5432/centinela';

// Create a single connection pool that will be reused
export const sql = postgres(DATABASE_URL, {
    max: 10, // max connections in pool
    idle_timeout: 20, // seconds before idle connection is closed
    connect_timeout: 10, // seconds to wait for connection
    transform: {
        undefined: null, // transform undefined to null
    },
});

/**
 * Test database connectivity
 */
export async function testConnection(): Promise<boolean> {
    try {
        const result = await sql`SELECT 1 as ok`;
        return result.length === 1 && result[0]?.ok === 1;
    } catch (error) {
        console.error('Database connection test failed:', error);
        return false;
    }
}

/**
 * Graceful shutdown - close all connections
 */
export async function closeDatabase(): Promise<void> {
    await sql.end();
}

export default sql;
