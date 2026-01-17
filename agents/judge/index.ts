import Fastify from 'fastify';
import pino from 'pino';
// import { isIP } from 'node:net';

const logger = pino({
  name: 'judge-agent',
  level: process.env.LOG_LEVEL || 'info',
});

const fastify = Fastify({
  logger,
});

// Critical Subnets Allowlist (Defaults)
// In production, these should be loaded from DB/Config
const DEFAULT_ALLOWLIST = [
  '127.0.0.0/8',      // Loopback
  '10.0.0.1/32',      // Gateway/Router example
  '192.168.1.1/32',   // Admin IP example
  '8.8.8.8/32',       // Public DNS (example of external safe IP)
];

// Helper to check if IP is in CIDR (simplified for example)
// A robust implementation would use a library like 'ip-range-check' or 'cidr-matcher'
function isIpAllowed(ip: string, allowlist: string[]): boolean {
  // Simple equality check for now (MVP)
  // TODO: Add proper CIDR matching logic
  return allowlist.some(allowed => allowed.includes(ip));
}

function validateCommandSafety(command: string): { safe: boolean; reason?: string } {
  const dangerousKeywords = [
    'execute factoryreset',
    'execute reboot',
    'execute shutdown',
    'execute format',
    'config system admin', // Don't allow changing admin users via automation
    'purge',
    'delete all'
  ];

  const lowerCmd = command.toLowerCase();

  // Check for dangerous keywords
  for (const keyword of dangerousKeywords) {
    if (lowerCmd.includes(keyword)) {
      return { safe: false, reason: `Contains forbidden keyword: "${keyword}"` };
    }
  }

  // Syntactic checks for FortiOS
  if (lowerCmd.startsWith('config ') && !lowerCmd.includes(' ')) {
    return { safe: false, reason: 'Incomplete "config" command' };
  }

  return { safe: true };
}

fastify.post('/v1/ata/judge', async (request, reply) => {
  const { request_id, tenant_id, commands, allowlist } = request.body as any;
  const effectiveAllowlist = [...DEFAULT_ALLOWLIST, ...(allowlist || [])];

  logger.info({ request_id, tenant_id, commands_count: commands?.length }, '⚖️ Judging actions');

  if (!Array.isArray(commands)) {
    return reply.code(400).send({ error: 'Commands must be an array' });
  }

  for (const cmd of commands) {
    // 1. Safety Keyword Check
    const safetyCheck = validateCommandSafety(cmd);
    if (!safetyCheck.safe) {
      logger.warn({ request_id, cmd, reason: safetyCheck.reason }, '⛔ Command blocked by Safety Rules');
      return {
        request_id,
        result: 'fail',
        reason: `Command blocked: ${safetyCheck.reason}`
      };
    }

    // 2. IP Safety Check (Extract IPs from command)
    // Regex for IPv4
    const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    const ipsFound = cmd.match(ipRegex) || [];

    for (const ip of ipsFound) {
      if (isIpAllowed(ip, effectiveAllowlist)) {
        logger.warn({ request_id, cmd, ip }, '⛔ Command blocked: Target IP is allowed/critical');
        return {
          request_id,
          result: 'fail',
          reason: `Target IP ${ip} is in the allowlist (critical asset)`
        };
      }
    }
  }

  logger.info({ request_id }, '✅ All commands passed validation');

  return {
    request_id,
    result: 'pass',
    reason: 'All commands contain valid syntax and respect critical assets.'
  };
});

fastify.get('/healthz', async () => {
  return { status: 'ok', agent: 'judge' };
});

const PORT = 8083;
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Judge Agent listening at http://0.0.0.0:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
