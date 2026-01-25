```saas centinela/saas-centinela/agents/advisor/index.ts
import Fastify from 'fastify';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  }
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  fastify.log.warn('⚠️ OPENAI_API_KEY is missing. Advisor actions will fail.');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const MODEL_NAME = process.env.ADVISOR_MODEL || 'gpt-4o-mini';

// Prompt Template
const SYSTEM_PROMPT = `
You are an Expert Fortinet FortiOS Administrator.
Your goal is to provide precise CLI commands to mitigate security threats identified by an analyst.

RULES:
1. Use standard FortiOS CLI syntax (config firewall address, config firewall policy, etc.).
2. Do NOT suggest destructive commands like "execute factoryreset" or "execute reboot".
3. Use specific object names based on the IOCs (e.g., "block_ip_1_2_3_4").
4. Always include "next" and "end" to close transactions properly.
5. If the threat is "brute force", suggest blocking the Source IP.
6. If the threat is "credential stuffing", suggest resetting the user password or blocking the IP.

Return strict JSON with this structure:
{
  "urgency": "immediate" | "high" | "medium" | "low",
  "actions": [
    {
      "priority": number,
      "action_name": string,
      "description": string,
      "cli_commands": string[],
      "risk_level": "low" | "medium" | "high" | "critical",
      "reversible": boolean
    }
  ]
}
`;

fastify.post('/v1/ata/advise', async (request, reply) => {
  const startTime = Date.now();
  const { request_id, tenant_id, analysis } = request.body as any;

  fastify.log.info({ request_id, tenant_id, threat: analysis?.threat_type }, '🛡️ Generating advice');

  if (!OPENAI_API_KEY) {
    return reply.code(503).send({ request_id, error: 'AI Provider not configured' });
  }

  try {
    const userPrompt = JSON.stringify({
      threat_detected: analysis.threat_type,
      severity: analysis.severity,
      iocs: analysis.iocs,
      context: analysis.context_summary
    }, null, 2);

    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const advice = JSON.parse(responseText);

    const latency_ms = Date.now() - startTime;
    const tokens_used = completion.usage?.total_tokens || 0;

    fastify.log.info({ request_id, actions: advice.actions?.length }, '✅ Advice generated');

    return {
      request_id,
      ...advice,
      model_used: MODEL_NAME,
      tokens_used,
      latency_ms
    };

  } catch (error) {
    fastify.log.error({ request_id, err: error }, '❌ Advisor failed');
    return reply.code(500).send({
      request_id,
      error: {
        code: 'AI_ADVISOR_FAILED',
        message: error instanceof Error ? error.message : 'Unknown AI error'
      }
    });
  }
});

fastify.get('/healthz', async () => {
  return { status: 'ok', agent: 'advisor' };
});

const PORT = 8082;
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Advisor Agent listening at http://0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
