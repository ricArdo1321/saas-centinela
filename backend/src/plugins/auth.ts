import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'node:crypto';
import { sql } from '../db/index.js';

// Extend FastifyRequest to include tenantId
declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
  }
  interface FastifyInstance {
    verifyApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AuthPluginOptions {
  // Add options if needed
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, _opts) => {

  /**
   * Decorator to verify API Key from Authorization header.
   * Usage: fastify.get('/route', { preHandler: fastify.verifyApiKey }, handler)
   */
  fastify.decorate('verifyApiKey', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      // For development simplicity, allow a specific header or query param if needed,
      // but for now stick to Bearer token
      reply.code(401).send({ error: 'Missing Authorization header' });
      return;
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      reply.code(401).send({ error: 'Invalid Authorization header format. Expected "Bearer <token>"' });
      return;
    }

    // 1. Hash the provided token (SHA-256)
    // We never store plain text keys
    const hash = crypto.createHash('sha256').update(token).digest('hex');

    try {
      // 2. Check against DB
      // TODO: Implement Redis caching layer here to avoid DB hit on every log
      // cacheKey = `apikey:${hash}`

      const result = await sql`
        SELECT tenant_id
        FROM api_keys
        WHERE key_hash = ${hash} AND is_active = true
      `;

      if (result.length === 0) {
        // Slow down brute force attempts slightly (optional, but good practice)
        await new Promise(resolve => setTimeout(resolve, 100));
        reply.code(401).send({ error: 'Invalid API Key' });
        return;
      }

      const tenantId = result[0]!.tenant_id as string;

      // 3. Attach tenant context to request
      request.tenantId = tenantId;

      // 4. Update usage stats (fire and forget, don't await to block response)
      sql`
        UPDATE api_keys
        SET last_used_at = NOW()
        WHERE key_hash = ${hash}
      `.catch(err => {
          request.log.error({ err }, 'Failed to update api_key stats');
      });

    } catch (err) {
      request.log.error({ err }, 'Auth database error');
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  });
};

export default fp(authPlugin);
