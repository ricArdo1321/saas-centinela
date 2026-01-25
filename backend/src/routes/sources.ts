import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/index.js';
import { randomBytes, createHash } from 'node:crypto';

// Schema for creating a new source
const CreateSourceSchema = z.object({
    name: z.string().min(3).max(100),
    site_id: z.string().uuid().optional(),
    type: z.enum(['fortigate_syslog']).default('fortigate_syslog'),
});

/**
 * Sources Management Routes
 * Allows tenants to manage their log sources and generate collector keys.
 */
export const sourcesRoutes: FastifyPluginAsync = async (fastify) => {

    // List sources
    fastify.get('/v1/sources', {
        preHandler: fastify.verifyAuth,
    }, async (req, reply) => {
        const tenantId = req.user?.tenantId;

        if (!tenantId) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }

        const sources = await sql`
      SELECT 
        s.id, s.name, s.type, s.status, s.created_at,
        sites.name as site_name
      FROM sources s
      LEFT JOIN sites ON s.site_id = sites.id
      WHERE s.tenant_id = ${tenantId}
      ORDER BY s.created_at DESC
    `;

        return { data: sources };
    });

    // Create new source & generate API Key
    fastify.post('/v1/sources', {
        preHandler: fastify.verifyAuth,
    }, async (req, reply) => {
        const tenantId = req.user?.tenantId;
        if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

        // Validate body
        const result = CreateSourceSchema.safeParse(req.body);
        if (!result.success) {
            return reply.code(400).send({ error: 'Invalid input', details: result.error });
        }

        const { name, site_id, type } = result.data;

        // 1. Create Source in DB
        const sourceResult = await sql`
      INSERT INTO sources (tenant_id, site_id, name, type)
      VALUES (${tenantId}, ${site_id || null}, ${name}, ${type})
      RETURNING id, name, created_at
    `;
        const source = sourceResult[0];

        // 2. Generate API Key for this source
        // Format: sk_live_<24_chars_hex>
        const randomPart = randomBytes(24).toString('hex');
        const apiKey = `sk_live_${randomPart}`;
        const keyHash = createHash('sha256').update(apiKey).digest('hex');
        const prefix = apiKey.substring(0, 15); // sk_live_1234567...

        // 3. Store API Key hash
        await sql`
      INSERT INTO api_keys (tenant_id, key_hash, prefix, name, is_active)
      VALUES (${tenantId}, ${keyHash}, ${prefix}, ${`Source: ${name}`}, true)
    `;

        // Return the source info AND the full API Key (only time it's shown)
        return {
            data: {
                ...source,
                api_key: apiKey, // Frontend must display this to the user immediately
                instructions: {
                    docker_command: `docker run -d --name centinela-collector \\
  -e CENTINELA_API_KEY=${apiKey} \\
  -e CENTINELA_API_URL=${process.env.APP_BASE_URL || 'https://api.centinela.cloud'}/v1/ingest/syslog \\
  -e LOG_LEVEL=info \\
  -p 5140:5140/udp -p 5140:5140/tcp \\
  ghcr.io/ricardo1321/centinela-collector:latest`
                }
            }
        };
    });

    // Delete source
    fastify.delete('/v1/sources/:id', {
        preHandler: fastify.verifyAuth,
    }, async (req, reply) => {
        const tenantId = req.user?.tenantId;
        const { id } = req.params as { id: string };

        if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

        // TODO: Also invalidate the associated API Key if we linked them strictly?
        // For now, we just delete the source metadata.

        await sql`
      DELETE FROM sources 
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;

        return { ok: true };
    });
};
