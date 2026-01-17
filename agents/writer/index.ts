import Fastify from 'fastify';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino({
  name: 'writer-agent',
  level: process.env.LOG_LEVEL || 'info',
});

const fastify = Fastify({
  logger,
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  logger.warn('⚠️ GEMINI_API_KEY is missing. Writer will perform poorly or fail.');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');
const MODEL_NAME = process.env.WRITER_MODEL || 'gemini-1.5-flash';

// AI Response Schema for Email
const writerSchema = {
  type: SchemaType.OBJECT,
  properties: {
    subject: { type: SchemaType.STRING },
    body: { type: SchemaType.STRING, description: "Full email body in plain text/markdown" }
  },
  required: ["subject", "body"]
} as any;

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

Return strict JSON properly structured.
`;

fastify.post('/v1/ata/write', async (request, reply) => {
  const startTime = Date.now();
  const { request_id, tenant_id, analysis, recommendations } = request.body as any;

  logger.info({ request_id, tenant_id }, '✍️ Writing report');

  if (!GEMINI_API_KEY) {
    return reply.code(503).send({ request_id, error: 'AI Provider not configured' });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: writerSchema,
        temperature: 0.5, // Balance creativity and structure
      },
      systemInstruction: SYSTEM_PROMPT
    });

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

    const result = await model.generateContent(userPrompt);
    const report = JSON.parse(result.response.text());

    const latency_ms = Date.now() - startTime;
    const tokens_used = result.response.usageMetadata?.totalTokenCount || 0;

    logger.info({ request_id, subject: report.subject }, '✅ Report generated');

    return {
      request_id,
      ...report,
      model_used: MODEL_NAME,
      tokens_used,
      latency_ms
    };

  } catch (error) {
    logger.error({ request_id, err: error }, '❌ Writer failed');
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
    logger.info(`Writer Agent listening at http://0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
