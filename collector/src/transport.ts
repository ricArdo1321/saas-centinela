import { config } from './config.js';
import type { SyslogEvent } from './buffer.js';
import { metrics } from './metrics.js';
import { RetryQueue } from './retry-queue.js';

interface SendResult {
  success: boolean;
  event: SyslogEvent;
  attempts: number;
  error?: string;
}

/**
 * HTTP Transport with Retry Support
 * 
 * Handles sending events to the Centinela API with:
 * - Automatic retries with exponential backoff
 * - Dead Letter Queue for permanently failed events
 * - Concurrent batch sending
 */
export class HttpTransport {
  private headers: Record<string, string>;
  private retryQueue: RetryQueue;
  private isProcessingRetries = false;

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.CENTINELA_API_KEY}`,
      'User-Agent': `CentinelaCollector/0.2.0 (${config.COLLECTOR_NAME})`
    };
    this.retryQueue = new RetryQueue();
  }

  /**
   * Sends a batch of events to the API using bulk endpoint.
   * Falls back to individual sends if bulk fails.
   * Failed events are automatically queued for retry.
   */
  async sendBatch(events: SyslogEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Try bulk endpoint first
    try {
      await this.sendBulk(events);
      metrics.incrementSent(events.length);
      return;
    } catch (err) {
      // Bulk failed, fall back to individual sends
      if (config.LOG_LEVEL === 'debug') {
        console.warn(`⚠️ Bulk send failed, falling back to individual: ${err}`);
      }
    }

    // Fallback: send individually
    const results = await Promise.all(
      events.map(event => this.sendWithTracking(event, 0))
    );

    // Process results
    for (const result of results) {
      if (result.success) {
        metrics.incrementSent();
      } else {
        metrics.incrementFailed();
        // Queue for retry
        this.retryQueue.enqueue(result.event, result.attempts);
      }
    }
  }

  /**
   * Send events using the bulk API endpoint
   */
  private async sendBulk(events: SyslogEvent[]): Promise<void> {
    const bulkUrl = config.CENTINELA_API_URL.replace('/syslog', '/syslog/bulk');

    const payload = {
      events: events.map(event => ({
        raw_message: event.raw_message,
        received_at: event.received_at,
        source_ip: event.source_ip,
        collector_name: config.COLLECTOR_NAME,
        site_id: config.SITE_ID,
      })),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s for bulk

    try {
      const response = await fetch(bulkUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => 'No body');
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      const start = Date.now();
      metrics.recordLatency(Date.now() - start);

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Process pending retries
   * Should be called periodically from the main loop
   */
  async processRetries(): Promise<void> {
    if (this.isProcessingRetries) return;

    const readyEvents = this.retryQueue.getReadyEvents();
    if (readyEvents.length === 0) return;

    this.isProcessingRetries = true;

    try {
      const results = await Promise.all(
        readyEvents.map(({ event, attempts }) =>
          this.sendWithTracking(event, attempts)
        )
      );

      for (const result of results) {
        if (result.success) {
          metrics.incrementSent();
          metrics.incrementRetrySuccess();
          if (config.LOG_LEVEL === 'debug') {
            console.log(`✅ Retry successful after ${result.attempts} attempts`);
          }
        } else {
          // Re-queue for another retry (or DLQ if max retries exceeded)
          this.retryQueue.enqueue(result.event, result.attempts);
        }
      }
    } finally {
      this.isProcessingRetries = false;
    }
  }

  /**
   * Send a single event and track the result
   */
  private async sendWithTracking(event: SyslogEvent, currentAttempts: number): Promise<SendResult> {
    const start = Date.now();

    try {
      await this.sendOne(event);
      metrics.recordLatency(Date.now() - start);

      return {
        success: true,
        event,
        attempts: currentAttempts + 1,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        event,
        attempts: currentAttempts + 1,
        error: errorMsg,
      };
    }
  }

  /**
   * Send a single event to the API
   */
  private async sendOne(event: SyslogEvent): Promise<void> {
    const payload = {
      raw_message: event.raw_message,
      received_at: event.received_at,
      source_ip: event.source_ip,
      collector_name: config.COLLECTOR_NAME,
      site_id: config.SITE_ID,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(config.CENTINELA_API_URL, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => 'No body');
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Get retry queue statistics
   */
  public getRetryStats(): { pending: number; dlq: number } {
    return {
      pending: this.retryQueue.size,
      dlq: this.retryQueue.dlqSize,
    };
  }

  /**
   * Check if there are pending retries
   */
  public hasPendingRetries(): boolean {
    return this.retryQueue.hasEvents();
  }

  /**
   * Export failed events from DLQ for manual processing
   */
  public exportDLQ(): SyslogEvent[] {
    return this.retryQueue.exportDLQ();
  }
}
