import Fastify from 'fastify';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino({
  name: 'analyst-agent',
  level: process.env.LOG_LEVEL || 'info',
});

const fastify = Fastify({
  logger,
});

// Configure Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  logger.warn('⚠️ GEMINI_API_KEY is missing. AI analysis will fail.');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');
const MODEL_NAME = process.env.ANALYZER_MODEL || 'gemini-1.5-flash';

// AI Response Schema
const analysisSchema = {
  type: SchemaType.OBJECT,
  properties: {
    threat_detected: { type: SchemaType.BOOLEAN },
    threat_type: { type: SchemaType.STRING, description: "Type of threat detected (e.g., 'credential_stuffing', 'brute_force', 'insider_threat', 'false_positive')" },
    confidence_score: { type: SchemaType.NUMBER, description: "Confidence score between 0.0 and 1.0" },
    severity: { type: SchemaType.STRING, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    context_summary: { type: SchemaType.STRING, description: "Brief explanation of what happened (1-2 sentences)" },
    technical_analysis: { type: SchemaType.STRING, description: "Detailed technical analysis of the logs" },
    iocs: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "List of Indicators of Compromise (IPs, domains, hashes, users)"
    },
    mitre_tactics: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "MITRE ATT&CK tactics identified"
    }
  },
  required: ["threat_detected", "threat_type", "confidence_score", "severity", "context_summary", "iocs"]
} as any;

// Prompt Template
const SYSTEM_PROMPT = `
You are an Expert Cybersecurity Analyst specialized in Fortinet FortiGate logs. 
Your goal is to analyze security events to distinguish between False Positives and Real Threats.

Analyze the provided Event Data (Detection + Raw Logs + Normalized Logs).
Focus on:
1. Identifying the root cause.
2. Checking for patterns of Brute Force, Credential Stuffing, Lateral Movement, or Tunneling.
3. Extracting valid IOCs (IPs, users).

Return the result in strict JSON format matching the schema.
`;

fastify.post('/v1/ata/analyze', async (request, reply) => {
  const startTime = Date.now();
  const { request_id, tenant_id, detection, raw_events, normalized_events } = request.body as any;

  logger.info({ request_id, tenant_id }, '🔍 Analyzing detection');

  if (!GEMINI_API_KEY) {
    return reply.code(503).send({
      request_id,
      error: 'AI Provider not configured (GEMINI_API_KEY missing)'
    });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
        temperature: 0.2,
      },
      systemInstruction: SYSTEM_PROMPT
    });

    const userPrompt = JSON.stringify({
      detection,
      raw_events_sample: raw_events?.slice(0, 10), // Limit payload
      normalized_events_sample: normalized_events?.slice(0, 10)
    }, null, 2);

    const result = await model.generateContent(userPrompt);
    const responseText = result.response.text();
    const analysis = JSON.parse(responseText);

    const latency_ms = Date.now() - startTime;
    const tokens_used = result.response.usageMetadata?.totalTokenCount || 0;

    logger.info({ request_id, latency_ms, tokens_used }, '✅ Analysis complete');

    return {
      request_id,
      ...analysis,
      model_used: MODEL_NAME,
      tokens_used,
      latency_ms
    };

  } catch (error) {
    logger.error({ request_id, err: error }, '❌ Analysis failed');
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
    logger.info(`Analyst Agent listening at http://0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
