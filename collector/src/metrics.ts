/**
 * Simple in-memory metrics for the collector
 * 
 * Tracks key operational metrics:
 * - Events received/sent/failed
 * - Retry statistics
 * - Latency measurements
 */
class Metrics {
    // Event counters
    private eventsReceived = 0;
    private eventsSent = 0;
    private eventsFailed = 0;
    private eventsDropped = 0;

    // Retry statistics
    private retryQueued = 0;
    private retrySuccess = 0;
    private dlqCount = 0;

    // Latency tracking (moving average)
    private latencySum = 0;
    private latencyCount = 0;
    private lastLatency = 0;

    // Timestamps
    private startTime = Date.now();
    private lastResetTime = Date.now();

    // --- Increment methods ---

    public incrementReceived(count: number = 1): void {
        this.eventsReceived += count;
    }

    public incrementSent(count: number = 1): void {
        this.eventsSent += count;
    }

    public incrementFailed(count: number = 1): void {
        this.eventsFailed += count;
    }

    public incrementDropped(count: number = 1): void {
        this.eventsDropped += count;
    }

    public incrementRetryQueued(count: number = 1): void {
        this.retryQueued += count;
    }

    public incrementRetrySuccess(count: number = 1): void {
        this.retrySuccess += count;
    }

    public incrementDLQ(count: number = 1): void {
        this.dlqCount += count;
    }

    public recordLatency(ms: number): void {
        this.latencySum += ms;
        this.latencyCount++;
        this.lastLatency = ms;
    }

    // --- Getters ---

    public getSnapshot(): MetricsSnapshot {
        const uptime = Date.now() - this.startTime;
        const periodSeconds = (Date.now() - this.lastResetTime) / 1000;

        return {
            uptime_ms: uptime,
            uptime_human: this.formatUptime(uptime),

            events: {
                received: this.eventsReceived,
                sent: this.eventsSent,
                failed: this.eventsFailed,
                dropped: this.eventsDropped,
                pending: this.eventsReceived - this.eventsSent - this.eventsFailed - this.eventsDropped,
            },

            retries: {
                queued: this.retryQueued,
                success: this.retrySuccess,
                dlq: this.dlqCount,
            },

            latency: {
                avg_ms: this.latencyCount > 0 ? Math.round(this.latencySum / this.latencyCount) : 0,
                last_ms: this.lastLatency,
            },

            rates: {
                events_per_second: periodSeconds > 0 ? Math.round(this.eventsReceived / periodSeconds * 100) / 100 : 0,
                success_rate: this.eventsSent > 0
                    ? Math.round((this.eventsSent / (this.eventsSent + this.eventsFailed)) * 10000) / 100
                    : 100,
            },
        };
    }

    public reset(): void {
        this.eventsReceived = 0;
        this.eventsSent = 0;
        this.eventsFailed = 0;
        this.eventsDropped = 0;
        this.retryQueued = 0;
        this.retrySuccess = 0;
        this.dlqCount = 0;
        this.latencySum = 0;
        this.latencyCount = 0;
        this.lastResetTime = Date.now();
    }

    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
}

export interface MetricsSnapshot {
    uptime_ms: number;
    uptime_human: string;
    events: {
        received: number;
        sent: number;
        failed: number;
        dropped: number;
        pending: number;
    };
    retries: {
        queued: number;
        success: number;
        dlq: number;
    };
    latency: {
        avg_ms: number;
        last_ms: number;
    };
    rates: {
        events_per_second: number;
        success_rate: number;
    };
}

// Singleton instance
export const metrics = new Metrics();
