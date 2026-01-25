import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { testConnection, closeDatabase } from './db/index.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { sourcesRoutes } from './routes/sources.js';
import authPlugin from './plugins/auth.js';
import tenantRateLimitPlugin from './plugins/rate-limit-tenant.js';
import { ingestQueue } from './lib/queue.js';
import { redis } from './lib/redis.js';

type Env = {
  NODE_ENV: string;
  PORT: number;
  APP_BASE_URL: string;
};

function getEnv(): Env {
  const schema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  });

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

const SyslogIngestBodySchema = z.object({
  // Tenant ID is inferred from API Key
  site_id: z.string().min(1).optional(),
  source_id: z.string().min(1).optional(),
  received_at: z.string().datetime().optional(),
  source_ip: z.string().min(1).optional(),
  raw_message: z.string().min(1),
  collector_name: z.string().min(1).optional(),
});

// Bulk ingest: array of events (max 100 per request)
const BulkSyslogIngestBodySchema = z.object({
  events: z.array(SyslogIngestBodySchema).min(1).max(100),
});

type _SyslogIngestBody = z.infer<typeof SyslogIngestBodySchema>;
type _BulkSyslogIngestBody = z.infer<typeof BulkSyslogIngestBodySchema>;

async function main() {
  const env = getEnv();

  const app = Fastify({
    logger: env.NODE_ENV === 'development'
      ? {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
      : { level: 'info' },
    genReqId: () => randomUUID(),
  });

  await app.register(helmet);

  await app.register(cors, {
    origin: process.env['CORS_ORIGINS']?.split(',') || ['http://localhost:3001', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(sensible);

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Centinela Cloud API',
        version: '0.2.0',
        description: 'Multi-tenant Syslog Ingestion & AI Analysis',
      },
      servers: [{ url: env.APP_BASE_URL }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API Key',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Register Custom Plugins
  await app.register(authPlugin);

  // Register Tenant Rate Limiter (uses Redis)
  await app.register(tenantRateLimitPlugin, {
    redis,
    config: {
      // Override default tiers if needed from environment
      tiers: {
        free: { maxRequests: parseInt(process.env['RATE_LIMIT_FREE'] || '100', 10), windowSeconds: 60 },
        basic: { maxRequests: parseInt(process.env['RATE_LIMIT_BASIC'] || '1000', 10), windowSeconds: 60 },
        pro: { maxRequests: parseInt(process.env['RATE_LIMIT_PRO'] || '5000', 10), windowSeconds: 60 },
        enterprise: { maxRequests: parseInt(process.env['RATE_LIMIT_ENTERPRISE'] || '20000', 10), windowSeconds: 60 },
      },
      defaultTier: process.env['RATE_LIMIT_DEFAULT_TIER'] || 'basic',
    },
    skipRoutes: ['/healthz', '/readyz', '/docs'],
  });

  // Register Routes
  await app.register(dashboardRoutes);
  await app.register(sourcesRoutes);

  app.get('/healthz', async () => {
    return { ok: true, service: 'centinela-backend', ts: new Date().toISOString() };
  });

  app.get('/readyz', async (req, reply) => {
    const dbOk = await testConnection();
    if (!dbOk) {
      return reply.code(503).send({ ok: false, service: 'centinela-backend', db: false });
    }
    return { ok: true, service: 'centinela-backend', db: true, ts: new Date().toISOString() };
  });

  /**
   * Ingest Endpoint (Authenticated via API Key + Tenant Rate Limited)
   */
  app.post('/v1/ingest/syslog', {
    preHandler: [app.verifyApiKey, app.tenantRateLimit], // Auth first, then rate limit
    schema: {
      security: [{ bearerAuth: [] }],
      response: {
        202: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            accepted: { type: 'boolean' },
            job_id: { type: 'string' },
          }
        },
      },
    },
  }, async (req, reply) => {
    const tenantId = req.tenantId; // Injected by auth plugin

    if (!tenantId) {
      return reply.unauthorized('Tenant context missing');
    }

    // Manual validation
    const result = SyslogIngestBodySchema.safeParse(req.body);
    if (!result.success) {
      return reply.badRequest(JSON.stringify(result.error.format()));
    }

    const body = result.data;

    // Push to Redis Queue (Async Processing)
    const job = await ingestQueue.add('syslog-event', {
      tenant_id: tenantId,
      ...body,
      received_at: body.received_at || new Date().toISOString(),
    });

    req.log.debug({ job_id: job.id, tenant_id: tenantId }, 'Syslog event enqueued');

    return reply.code(202).send({
      ok: true,
      accepted: true,
      job_id: job.id,
    });
  });

  /**
   * Bulk Ingest Endpoint (for Smart Collector optimization)
   * Accepts up to 100 events per request
   */
  app.post('/v1/ingest/syslog/bulk', {
    preHandler: [app.verifyApiKey, app.tenantRateLimit],
    schema: {
      security: [{ bearerAuth: [] }],
      description: 'Bulk syslog ingestion - accepts up to 100 events per request',
      response: {
        202: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            accepted: { type: 'number' },
            job_ids: { type: 'array', items: { type: 'string' } },
          }
        },
      },
    },
  }, async (req, reply) => {
    const tenantId = req.tenantId;

    if (!tenantId) {
      return reply.unauthorized('Tenant context missing');
    }

    // Validate bulk payload
    const result = BulkSyslogIngestBodySchema.safeParse(req.body);
    if (!result.success) {
      return reply.badRequest(JSON.stringify(result.error.format()));
    }

    const { events } = result.data;
    const now = new Date().toISOString();

    // Enqueue all events in parallel
    const jobs = await Promise.all(
      events.map(event =>
        ingestQueue.add('syslog-event', {
          tenant_id: tenantId,
          ...event,
          received_at: event.received_at || now,
        })
      )
    );

    const jobIds = jobs.map(j => j.id).filter((id): id is string => id !== undefined);

    req.log.info(
      { count: events.length, tenant_id: tenantId },
      'Bulk syslog events enqueued'
    );

    return reply.code(202).send({
      ok: true,
      accepted: events.length,
      job_ids: jobIds,
    });
  });

  // Global Error Handler
  app.setErrorHandler(async (err, req, reply) => {
    req.log.error({ err }, 'request error');
    const message = err instanceof Error ? err.message : 'unknown error';

    if (env.NODE_ENV === 'development') {
      return reply.code(500).send({
        ok: false,
        error: 'internal_error',
        message,
      });
    }
    return reply.code(500).send({ ok: false, error: 'internal_error' });
  });

  // Database Connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    app.log.warn('⚠️ Database connection failed at startup');
  } else {
    app.log.info('✅ Database connected');
  }

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutdown signal received');
    await app.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ host: '0.0.0.0', port: env.PORT });
    app.log.info({ port: env.PORT }, '🚀 Centinela Backend listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
