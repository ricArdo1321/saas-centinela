import Fastify from 'fastify';
import pino from 'pino';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';

dotenv.config();

const logger = pino({
  name: 'orchestrator-agent',
  level: process.env.LOG_LEVEL || 'info',
});

const fastify = Fastify({
  logger,
});

// Configuration for downstream agents
const AGENTS = {
  analyst: process.env.ANALYST_URL || 'http://localhost:8081',
  advisor: process.env.ADVISOR_URL || 'http://localhost:8082',
  judge: process.env.JUDGE_URL || 'http://localhost:8083',
  writer: process.env.WRITER_URL || 'http://localhost:8084',
};

// Orchestration Logic
fastify.post('/v1/ata/orchestrate', async (request, reply) => {
  const reqId = (request.body as any).request_id || randomUUID();
  const startTime = Date.now();
  const payload = request.body as any;
  const tenantId = payload.tenant_id;

  logger.info({ reqId, tenantId }, '🎹 Orchestrating ATA Flow');

  try {
    // 1. ANALYST
    logger.info({ reqId }, '➡️ Calling Analyst...');
    const analystRes = await fetch(`${AGENTS.analyst}/v1/ata/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, request_id: reqId })
    });
    if (!analystRes.ok) throw new Error(`Analyst failed: ${analystRes.statusText}`);
    const analysis = await analystRes.json() as any;
    logger.info({ reqId, threat: analysis.threat_detected }, '⬅️ Analyst returned');

    // If no threat detected, short-circuit? 
    // For now, continue to see what advisor says (maybe advisory for false positives?)
    // But usually we skip if false positive.
    if (analysis.threat_detected === false) {
      return { request_id: reqId, analysis, status: 'no_threat_detected' };
    }

    // 2. ADVISOR
    logger.info({ reqId }, '➡️ Calling Advisor...');
    const advisorRes = await fetch(`${AGENTS.advisor}/v1/ata/advise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: reqId,
        tenant_id: tenantId,
        analysis
      })
    });
    if (!advisorRes.ok) throw new Error(`Advisor failed: ${advisorRes.statusText}`);
    const recommendations = await advisorRes.json() as any;
    logger.info({ reqId, actions: recommendations.actions?.length }, '⬅️ Advisor returned');

    // 3. JUDGE (Validation)
    // Flatten commands for judging
    const allCommands: string[] = [];
    if (recommendations.actions) {
      for (const act of recommendations.actions) {
        if (act.cli_commands) allCommands.push(...act.cli_commands);
      }
    }

    let judgeResult = { result: 'pass', reason: 'No commands to judge' };
    if (allCommands.length > 0) {
      logger.info({ reqId }, '➡️ Calling Judge...');
      const judgeRes = await fetch(`${AGENTS.judge}/v1/ata/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: reqId,
          tenant_id: tenantId,
          commands: allCommands
        })
      });
      if (!judgeRes.ok) throw new Error(`Judge failed: ${judgeRes.statusText}`);
      judgeResult = await judgeRes.json() as any;
      logger.info({ reqId, verdict: judgeResult.result }, '⬅️ Judge returned');
    }

    // 4. WRITER
    logger.info({ reqId }, '➡️ Calling Writer...');
    const writerRes = await fetch(`${AGENTS.writer}/v1/ata/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: reqId,
        tenant_id: tenantId,
        analysis,
        recommendations
      })
    });
    if (!writerRes.ok) throw new Error(`Writer failed: ${writerRes.statusText}`);
    const report = await writerRes.json() as any;
    logger.info({ reqId }, '⬅️ Writer returned');

    // Final Response
    const latency_ms = Date.now() - startTime;
    return {
      request_id: reqId,
      analysis,
      recommendations,
      judge: judgeResult,
      report,
      latency_ms
    };

  } catch (error) {
    logger.error({ reqId, err: error }, '❌ Orchestration failed');
    return reply.code(500).send({
      request_id: reqId,
      error: {
        code: 'ORCHESTRATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

fastify.get('/healthz', async () => {
  return { status: 'ok', agent: 'orchestrator' };
});

const PORT = 8080;
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Orchestrator Agent listening at http://0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
