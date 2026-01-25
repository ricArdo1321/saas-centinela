import { config } from './config.js';
import type { SyslogEvent } from './buffer.js';
import { metrics } from './metrics.js';

interface RetryableEvent {
    event: SyslogEvent;
    attempts: number;
    nextRetryAt: number;
}

/**
 * Retry Queue with Exponential Backoff
 * 
 * Handles failed events with configurable retry logic:
 * - Exponential backoff (1s, 2s, 4s, 8s, 16s...)
 * - Max retries before moving to DLQ
 * - Jitter to prevent thundering herd
 */
export class RetryQueue {
    private queue: RetryableEvent[] = [];
    private dlq: SyslogEvent[] = []; // Dead Letter Queue

    private readonly maxRetries = config.MAX_RETRIES;
    private readonly baseDelayMs = config.RETRY_BASE_DELAY_MS;
    private readonly maxDelayMs = config.RETRY_MAX_DELAY_MS;

    /**
     * Add a failed event to the retry queue
     */
    public enqueue(event: SyslogEvent, currentAttempts: number = 0): void {
        const attempts = currentAttempts + 1;

        if (attempts > this.maxRetries) {
            // Max retries exceeded - move to Dead Letter Queue
            this.dlq.push(event);
            metrics.incrementDLQ();

            if (config.LOG_LEVEL === 'debug') {
                console.warn(`💀 Event moved to DLQ after ${this.maxRetries} failed attempts`);
            }
            return;
        }

        const delay = this.calculateBackoff(attempts);
        const nextRetryAt = Date.now() + delay;

        this.queue.push({ event, attempts, nextRetryAt });
        metrics.incrementRetryQueued();

        if (config.LOG_LEVEL === 'debug') {
            console.log(`🔄 Event queued for retry #${attempts} in ${delay}ms`);
        }
    }

    /**
     * Get events that are ready to be retried
     */
    public getReadyEvents(): Array<{ event: SyslogEvent; attempts: number }> {
        const now = Date.now();
        const ready: Array<{ event: SyslogEvent; attempts: number }> = [];
        const pending: RetryableEvent[] = [];

        for (const item of this.queue) {
            if (item.nextRetryAt <= now) {
                ready.push({ event: item.event, attempts: item.attempts });
            } else {
                pending.push(item);
            }
        }

        this.queue = pending;
        return ready;
    }

    /**
     * Calculate exponential backoff with jitter
     */
    private calculateBackoff(attempt: number): number {
        // Exponential: baseDelay * 2^(attempt-1)
        const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt - 1);

        // Cap at max delay
        const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);

        // Add jitter (±20%) to prevent thundering herd
        const jitter = cappedDelay * 0.2 * (Math.random() - 0.5);

        return Math.floor(cappedDelay + jitter);
    }

    /**
     * Get current retry queue size
     */
    public get size(): number {
        return this.queue.length;
    }

    /**
     * Get Dead Letter Queue size
     */
    public get dlqSize(): number {
        return this.dlq.length;
    }

    /**
     * Export DLQ events (for manual processing or logging)
     */
    public exportDLQ(): SyslogEvent[] {
        const events = [...this.dlq];
        this.dlq = [];
        return events;
    }

    /**
     * Check if there are events waiting to retry
     */
    public hasEvents(): boolean {
        return this.queue.length > 0;
    }
}
