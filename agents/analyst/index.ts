import Fastify from 'fastify';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  }
});

// Configure OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  fastify.log.warn('⚠️ OPENAI_API_KEY is missing. AI analysis will fail.');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const MODEL_NAME = process.env.ANALYZER_MODEL || 'gpt-4o-mini';

// Prompt Template
const SYSTEM_PROMPT = `
You are an Expert Cybersecurity Analyst specialized in Fortinet FortiGate logs. 
Your goal is to analyze security events to distinguish between False Positives and Real Threats.

Analyze the provided Event Data (Detection + Raw Logs + Normalized Logs).
Focus on:
1. Identifying the root cause.
2. Checking for patterns of Brute Force, Credential Stuffing, Lateral Movement, or Tunneling.
3. Extracting valid IOCs (IPs, users).

Return the result in strict JSON format with the following structure:
{
  "threat_detected": boolean,
  "threat_type": string (e.g., "credential_stuffing", "brute_force", "insider_threat", "false_positive"),
  "confidence_score": number (0.0 to 1.0),
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "context_summary": string (1-2 sentences explaining what happened),
  "technical_analysis": string (detailed technical analysis),
  "iocs": string[] (list of IPs, domains, hashes, users),
  "mitre_tactics": string[] (MITRE ATT&CK tactics identified)
}
`;

fastify.post('/v1/ata/analyze', async (request, reply) => {
  const startTime = Date.now();
  const { request_id, tenant_id, detection, raw_events, normalized_events } = request.body as any;

  fastify.log.info({ request_id, tenant_id }, '🔍 Analyzing detection');

  if (!OPENAI_API_KEY) {
    return reply.code(503).send({
      request_id,
      error: 'AI Provider not configured (OPENAI_API_KEY missing)'
    });
  }

  try {
    const userPrompt = JSON.stringify({
      detection,
      raw_events_sample: raw_events?.slice(0, 10),
      normalized_events_sample: normalized_events?.slice(0, 10)
    }, null, 2);

    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const analysis = JSON.parse(responseText);

    const latency_ms = Date.now() - startTime;
    const tokens_used = completion.usage?.total_tokens || 0;

    fastify.log.info({ request_id, latency_ms, tokens_used }, '✅ Analysis complete');

    return {
      request_id,
      ...analysis,
      model_used: MODEL_NAME,
      tokens_used,
      latency_ms
    };

  } catch (error) {
    fastify.log.error({ request_id, err: error }, '❌ Analysis failed');
    return reply.code(500).send({
      request_id,
      error: {
        code: 'AI_GENERATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown AI error'
      }
    });
  }
});

fastify.get('/healthz', async () => {
  return { status: 'ok', agent: 'analyst' };
});

const PORT = 8081;
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Analyst Agent listening at http://0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
