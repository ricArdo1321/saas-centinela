import { Queue, Worker, type Processor, type WorkerOptions, type QueueOptions } from 'bullmq';
import { redis as connection, closeRedisConnection } from './redis.js';

export const QUEUE_NAMES = {
  INGEST: 'ingest-queue',
  AI_ANALYSIS: 'ai-analysis-queue',
  NOTIFICATIONS: 'notifications-queue',
  PIPELINE: 'pipeline-queue',
};

/**
 * Creates a configured BullMQ Queue instance
 */
export function createQueue(name: string, opts?: QueueOptions) {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 1000,    // Keep last 1000 failed jobs
    },
    ...opts,
  });
}

/**
 * Creates a configured BullMQ Worker instance
 */
export function createWorker(name: string, processor: Processor, opts?: Omit<WorkerOptions, 'connection'>) {
  return new Worker(name, processor, {
    connection,
    concurrency: 5, // Default concurrency
    ...opts,
  });
}

// Pre-configured queues
export const ingestQueue = createQueue(QUEUE_NAMES.INGEST);
export const aiAnalysisQueue = createQueue(QUEUE_NAMES.AI_ANALYSIS);
export const pipelineQueue = createQueue(QUEUE_NAMES.PIPELINE);

/**
 * Gracefully close Redis connection
 */
export async function closeRedis() {
  await ingestQueue.close();
  await aiAnalysisQueue.close();
  await pipelineQueue.close();
  await closeRedisConnection();
}
