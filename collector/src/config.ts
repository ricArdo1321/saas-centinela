import 'dotenv/config';
import { z } from 'zod';
import os from 'node:os';

const envSchema = z.object({
  // Security
  CENTINELA_API_KEY: z.string().min(1, "CENTINELA_API_KEY is required"),

  // Connectivity
  CENTINELA_API_URL: z.string().url().default("https://api.centinela.cloud/v1/ingest/syslog"),

  // Local Listening - UDP
  UDP_PORT: z.coerce.number().int().positive().default(5140),
  UDP_BIND_ADDRESS: z.string().default('0.0.0.0'),
  UDP_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),

  // Local Listening - TCP
  TCP_PORT: z.coerce.number().int().positive().default(5140),
  TCP_BIND_ADDRESS: z.string().default('0.0.0.0'),
  TCP_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),

  // Health Check HTTP Server
  HEALTH_PORT: z.coerce.number().int().positive().default(8080),
  HEALTH_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),

  // Batching / Performance
  BATCH_SIZE: z.coerce.number().int().positive().default(50),
  FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(2000), // 2 seconds
  MAX_BUFFER_SIZE: z.coerce.number().int().positive().default(10000), // Drop if buffer gets too full

  // Retry Configuration
  MAX_RETRIES: z.coerce.number().int().min(0).default(5),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000), // 1 second
  RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(30000), // 30 seconds
  RETRY_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(500), // Check retry queue every 500ms

  // Metadata
  COLLECTOR_NAME: z.string().default(os.hostname()),
  SITE_ID: z.string().optional(),

  // System
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid configuration:', JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }

  return parsed.data;
}

export const config = loadConfig();
