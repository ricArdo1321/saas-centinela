import 'dotenv/config';

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';

type Env = {
  NODE_ENV: string;
  PORT: number;
  INGEST_SHARED_SECRET: string;
  APP_BASE_URL: string;
};

function getEnv(): Env {
  const schema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    INGEST_SHARED_SECRET: z.string().min(16, 'INGEST_SHARED_SECRET must be at least 16 chars'),
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  });

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // zod error is plenty informative
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

function safeEqual(a: string, b: string): boolean {
  // Avoid leaking length info; normalize to buffers
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function verifyIngestAuth(opts: { secret: string; headers: Record<string, any>; rawBody: string }):
  | { ok: true; mode: 'token' | 'hmac' }
  | { ok: false; mode: 'token' | 'hmac' | 'none'; reason: string } {
  const token = (opts.headers['x-ingest-token'] ?? opts.headers['X-Ingest-Token']) as string | undefined;
  if (typeof token === 'string' && token.length > 0) {
    const ok = safeEqual(token, opts.secret);
    if (ok) return { ok: true, mode: 'token' };
    return { ok: false, mode: 'token', reason: 'invalid token' };
  }

  // Optional HMAC mode:
  // - X-Ingest-Timestamp: unix epoch seconds (string)
  // - X-Ingest-Signature: hex(hmac_sha256(secret, `${ts}.${rawBody}`))
  const ts = (opts.headers['x-ingest-timestamp'] ?? opts.headers['X-Ingest-Timestamp']) as string | undefined;
  const sig = (opts.headers['x-ingest-signature'] ?? opts.headers['X-Ingest-Signature']) as string | undefined;

  if (typeof ts === 'string' && typeof sig === 'string' && ts.length > 0 && sig.length > 0) {
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return { ok: false, mode: 'hmac', reason: 'invalid timestamp' };

    // Replay window (5 minutes)
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsNum) > 300) return { ok: false, mode: 'hmac', reason: 'timestamp out of window' };

    const expected = createHmac('sha256', opts.secret).update(`${ts}.${opts.rawBody}`).digest('hex');
    const ok = safeEqual(expected, sig);
    if (ok) return { ok: true, mode: 'hmac' };
    return { ok: false, mode: 'hmac', reason: 'invalid signature' };
  }

  return { ok: false, mode: 'none', reason: 'missing auth headers' };
}

const SyslogIngestBodySchema = z.object({
  tenant_id: z.string().min(1),
  site_id: z.string().min(1).optional(),
  source_id: z.string().min(1).optional(),
  received_at: z.string().datetime().optional(),
  source_ip: z.string().min(1).optional(),
  raw_message: z.string().min(1),
  // Optional collector metadata
  collector_name: z.string().min(1).optional(),
});

type SyslogIngestBody = z.infer<typeof SyslogIngestBodySchema>;

async function main() {
  const env = getEnv();

  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? {
            level: 'info',
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard' },
            },
          }
        : { level: 'info' },
    genReqId: () => randomUUID(),
    // Important: keep raw body for HMAC verification
    bodyLimit: 1024 * 256, // 256KB; syslog lines are tiny but we want some headroom
  });

  // Keep raw body (Fastify v5 supports this)
  app.addContentTypeParser('*', { parseAs: 'string' }, function (_req, body, done) {
    done(null, body);
  });

  await app.register(helmet);

  await app.register(sensible);

  await app.register(rateLimit, {
    max: 600, // per minute
    timeWindow: '1 minute',
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Centinela Cloud API (MVP)',
        version: '0.1.0',
        description: 'Syslog ingest + detection/batching (WIP).',
      },
      servers: [{ url: env.APP_BASE_URL }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  app.get('/healthz', async () => {
    return { ok: true, service: 'centinela-backend', ts: new Date().toISOString() };
  });

  app.post('/v1/ingest/syslog', async (req, reply) => {
    // Because we replaced parser to parse as string, req.body is a string here.
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const auth = verifyIngestAuth({
      secret: env.INGEST_SHARED_SECRET,
      headers: req.headers as any,
      rawBody,
    });

    if (!auth.ok) {
      req.log.warn({ authMode: auth.mode, reason: auth.reason }, 'ingest auth failed');
      return reply.unauthorized('Unauthorized');
    }

    // Parse JSON body
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return reply.badRequest('Body must be valid JSON');
    }

    const parsed = SyslogIngestBodySchema.safeParse(json);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parsed.error.flatten(),
      });
    }

    const body: SyslogIngestBody = parsed.data;

    // MVP behavior:
    // - For now, we only acknowledge ingest and log it.
    // - Next step: insert into Postgres (raw_events), parse FortiGate kv, normalize, and enqueue rules.
    req.log.info(
      {
        tenant_id: body.tenant_id,
        site_id: body.site_id,
        source_id: body.source_id,
        source_ip: body.source_ip,
        received_at: body.received_at,
        collector_name: body.collector_name,
        raw_len: body.raw_message.length,
      },
      'syslog received'
    );

    return reply.code(202).send({
      ok: true,
      accepted: true,
      request_id: req.id,
    });
  });

  // Simple 404 payload
  app.setNotFoundHandler(async (_req, reply) => {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  });

  // Error handler: avoid leaking details in prod
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

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info({ port: env.PORT }, 'centinela-backend listening');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
