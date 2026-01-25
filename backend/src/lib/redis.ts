import { Redis } from 'ioredis';

const REDIS_HOST = process.env['REDIS_HOST'] || 'localhost';
const REDIS_PORT = parseInt(process.env['REDIS_PORT'] || '6379', 10);
const REDIS_PASSWORD = process.env['REDIS_PASSWORD'] || undefined;

/**
 * Shared Redis connection for the application
 * Used by: BullMQ queues, rate limiting, caching
 * 
 * Note: BullMQ requires maxRetriesPerRequest to be null
 */
export const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    maxRetriesPerRequest: null,
    // Enable reconnect
    retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    // Connection event logging
    lazyConnect: false,
});

redis.on('connect', () => {
    console.log('🔗 Redis connected');
});

redis.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
});

redis.on('reconnecting', () => {
    console.log('🔄 Redis reconnecting...');
});

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
    try {
        const pong = await redis.ping();
        return pong === 'PONG';
    } catch {
        return false;
    }
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
    await redis.quit();
}

export default redis;
