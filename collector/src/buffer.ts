import { config } from './config.js';

export interface SyslogEvent {
  raw_message: string;
  received_at: string;
  source_ip: string;
}

/**
 * Simple in-memory FIFO buffer for log events.
 * Uses a standard array, which is sufficient for typical sidecar loads (up to ~1k ops/sec).
 * For extremely high throughput, a RingBuffer or LinkedList implementation would be preferred.
 */
export class MessageBuffer {
  private queue: SyslogEvent[] = [];
  private droppedCount = 0;

  /**
   * Add an event to the buffer.
   * Drops the event if the buffer is full (Tail Drop).
   */
  public push(event: SyslogEvent): boolean {
    if (this.queue.length >= config.MAX_BUFFER_SIZE) {
      this.droppedCount++;
      return false;
    }
    this.queue.push(event);
    return true;
  }

  /**
   * Remove and return a batch of events from the start of the queue.
   */
  public popBatch(size: number): SyslogEvent[] {
    if (this.queue.length === 0) return [];

    // splice removes elements from index 0
    const batchSize = Math.min(size, this.queue.length);
    return this.queue.splice(0, batchSize);
  }

  public get size(): number {
    return this.queue.length;
  }

  public get dropped(): number {
    return this.droppedCount;
  }

  public isEmpty(): boolean {
    return this.queue.length === 0;
  }
}
