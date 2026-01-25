```saas centinela/saas-centinela/agents/writer/index.ts
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
  fastify.log.warn('⚠️ OPENAI_API_KEY is missing. Writer will fail.');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const MODEL_NAME = process.env.WRITER_MODEL || 'gpt-4o-mini';

// Prompt Template
const SYSTEM_PROMPT = `
You are a Technical Explainer and Copywriter for Centinela Cloud.
Your goal is to write a Security Alert Email for a non-technical stakeholder (CEO/Manager).

RULES:
1. Subject line must be concise and include severity emoji (🚨, ⚠️, ℹ️).
2. Start with an "Executive Summary": What happened? (In plain Spanish).
3. Follow with "Technical Details": What specific attack was detected? (Brief).
4. List "Recommended Actions": What should be done? (Summarize the CLI actions).
5. Tone: Professional, Urgent but Calm.
6. Language: Spanish (ES).

Return strict JSON with this structure:
{
  "subject": string,
  "body": string (full email body in plain text/markdown)
}
`;

fastify.post('/v1/ata/write', async (request, reply) => {
  const startTime = Date.now();
  const { request_id, tenant_id, analysis, recommendations } = request.body as any;

  fastify.log.info({ request_id, tenant_id }, '✍️ Writing report');

  if (!OPENAI_API_KEY) {
    return reply.code(503).send({ request_id, error: 'AI Provider not configured' });
  }

  try {
    const userPrompt = JSON.stringify({
      severity: analysis.severity,
      threat_type: analysis.threat_type,
      context_summary: analysis.context_summary,
      actions: recommendations?.actions?.map((a: any) => ({
        action: a.action_name,
        description: a.description,
        risk: a.risk_level
      }))
    }, null, 2);

    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const report = JSON.parse(responseText);

    const latency_ms = Date.now() - startTime;
    const tokens_used = completion.usage?.total_tokens || 0;

    fastify.log.info({ request_id, subject: report.subject }, '✅ Report generated');

    return {
      request_id,
      ...report,
      model_used: MODEL_NAME,
      tokens_used,
      latency_ms
    };

  } catch (error) {
    fastify.log.error({ request_id, err: error }, '❌ Writer failed');
    return reply.code(500).send({
      request_id,
      error: {
        code: 'AI_WRITER_FAILED',
        message: error instanceof Error ? error.message : 'Unknown AI error'
      }
    });
  }
});

fastify.get('/healthz', async () => {
  return { status: 'ok', agent: 'writer' };
});

const PORT = 8084;
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Writer Agent listening at http://0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
