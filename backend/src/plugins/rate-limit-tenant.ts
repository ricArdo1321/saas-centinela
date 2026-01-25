import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

/**
 * Rate Limit Configuration per Plan Tier
 * Define requests per window (in seconds)
 */
export interface RateLimitTierConfig {
    maxRequests: number;    // Max requests allowed
    windowSeconds: number;  // Time window in seconds
}

export interface TenantRateLimitConfig {
    tiers: Record<string, RateLimitTierConfig>;
    defaultTier: string;
}

// Default configuration - can be overridden via plugin options
const DEFAULT_CONFIG: TenantRateLimitConfig = {
    tiers: {
        free: { maxRequests: 100, windowSeconds: 60 },      // 100 req/min
        basic: { maxRequests: 1000, windowSeconds: 60 },    // 1000 req/min
        pro: { maxRequests: 5000, windowSeconds: 60 },      // 5000 req/min
        enterprise: { maxRequests: 20000, windowSeconds: 60 }, // 20000 req/min
    },
    defaultTier: 'basic',
};

export interface TenantRateLimitOptions {
    redis: Redis;
    config?: Partial<TenantRateLimitConfig>;
    keyPrefix?: string;
    skipRoutes?: string[];
    getTenantTier?: (tenantId: string) => Promise<string>;
}

// Extend FastifyInstance with our decorator
declare module 'fastify' {
    interface FastifyInstance {
        tenantRateLimit: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

const tenantRateLimitPlugin: FastifyPluginAsync<TenantRateLimitOptions> = async (fastify, opts) => {
    const redis = opts.redis;
    const keyPrefix = opts.keyPrefix || 'ratelimit:tenant:';
    const config: TenantRateLimitConfig = {
        tiers: { ...DEFAULT_CONFIG.tiers, ...opts.config?.tiers },
        defaultTier: opts.config?.defaultTier || DEFAULT_CONFIG.defaultTier,
    };
    const skipRoutes = new Set(opts.skipRoutes || []);

    /**
     * Get tenant tier from database or cache
     * Default implementation returns defaultTier
     * Override via opts.getTenantTier for custom logic
     */
    const getTenantTier = opts.getTenantTier || (async (_tenantId: string): Promise<string> => {
        // TODO: Query tenant plan from database
        // For now, return default tier
        return config.defaultTier;
    });

    /**
     * Sliding Window Rate Limiter using Redis
     * Uses sorted sets for an accurate sliding window approach
     */
    async function checkRateLimit(tenantId: string, tierConfig: RateLimitTierConfig): Promise<{
        allowed: boolean;
        remaining: number;
        resetAt: number;
        limit: number;
    }> {
        const key = `${keyPrefix}${tenantId}`;
        const now = Date.now();
        const windowStart = now - (tierConfig.windowSeconds * 1000);

        // Use Redis transaction for atomic operations
        const pipeline = redis.pipeline();

        // Remove old entries outside the window
        pipeline.zremrangebyscore(key, 0, windowStart);

        // Count current entries in window
        pipeline.zcard(key);

        // Add current request timestamp
        pipeline.zadd(key, now, `${now}:${Math.random()}`);

        // Set expiry on the key (cleanup old keys)
        pipeline.expire(key, tierConfig.windowSeconds + 1);

        const results = await pipeline.exec();

        if (!results) {
            // Redis error - fail open (allow request)
            fastify.log.warn({ tenantId }, 'Rate limit Redis error - failing open');
            return {
                allowed: true,
                remaining: tierConfig.maxRequests,
                resetAt: now + (tierConfig.windowSeconds * 1000),
                limit: tierConfig.maxRequests,
            };
        }

        // results[1] is the ZCARD result (count before adding current request)
        const currentCount = (results[1]?.[1] as number) || 0;
        const remaining = Math.max(0, tierConfig.maxRequests - currentCount - 1);
        const allowed = currentCount < tierConfig.maxRequests;
        const resetAt = now + (tierConfig.windowSeconds * 1000);

        // If not allowed, remove the request we just added
        if (!allowed) {
            await redis.zrem(key, `${now}:${Math.random()}`);
        }

        return { allowed, remaining, resetAt, limit: tierConfig.maxRequests };
    }

    /**
     * Rate Limit Decorator
     * Use as preHandler: fastify.tenantRateLimit
     */
    fastify.decorate('tenantRateLimit', async (request: FastifyRequest, reply: FastifyReply) => {
        // Skip if route is in skip list
        if (skipRoutes.has(request.routeOptions.url || '')) {
            return;
        }

        const tenantId = request.tenantId;

        if (!tenantId) {
            // No tenant context - should be caught by auth plugin first
            // But just in case, allow the request to proceed to auth check
            return;
        }

        try {
            const tier = await getTenantTier(tenantId);
            const tierConfig = config.tiers[tier] || config.tiers[config.defaultTier]!;

            const result = await checkRateLimit(tenantId, tierConfig);

            // Add rate limit headers to response
            reply.header('X-RateLimit-Limit', result.limit.toString());
            reply.header('X-RateLimit-Remaining', result.remaining.toString());
            reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());
            reply.header('X-RateLimit-Tier', tier);

            if (!result.allowed) {
                const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
                reply.header('Retry-After', retryAfter.toString());

                request.log.warn(
                    { tenantId, tier, limit: result.limit },
                    'Rate limit exceeded'
                );

                reply.code(429).send({
                    error: 'Too Many Requests',
                    message: `Rate limit exceeded. You have reached ${result.limit} requests per ${tierConfig.windowSeconds} seconds.`,
                    retry_after: retryAfter,
                    limit: result.limit,
                    tier,
                });
                return;
            }

            request.log.debug(
                { tenantId, remaining: result.remaining, tier },
                'Rate limit check passed'
            );

        } catch (err) {
            // Log error but fail open to not block legitimate traffic
            request.log.error({ err, tenantId }, 'Rate limit check failed');
            // Continue processing - fail open approach
        }
    });
};

export default fp(tenantRateLimitPlugin, {
    name: 'tenant-rate-limit',
    dependencies: [], // Can add 'auth' dependency if needed
});
