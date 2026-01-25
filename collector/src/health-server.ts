import http from 'node:http';
import { config } from './config.js';
import { metrics, type MetricsSnapshot } from './metrics.js';

interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    service: string;
    version: string;
    uptime: string;
    checks: {
        buffer: 'ok' | 'warning' | 'critical';
        retries: 'ok' | 'warning' | 'critical';
    };
}

/**
 * HTTP Health Check Server
 * 
 * Exposes endpoints for monitoring:
 * - GET /healthz - Simple health check (for load balancers)
 * - GET /readyz - Readiness check
 * - GET /metrics - Detailed metrics in JSON format
 */
export class HealthServer {
    private server: http.Server;
    private isRunning = false;
    private getBufferStats: () => { size: number; dropped: number };
    private getRetryStats: () => { pending: number; dlq: number };
    private getTcpConnections: () => number;

    constructor(options: {
        getBufferStats: () => { size: number; dropped: number };
        getRetryStats: () => { pending: number; dlq: number };
        getTcpConnections: () => number;
    }) {
        this.getBufferStats = options.getBufferStats;
        this.getRetryStats = options.getRetryStats;
        this.getTcpConnections = options.getTcpConnections;

        this.server = http.createServer(this.handleRequest.bind(this));

        this.server.on('error', (err) => {
            console.error(`❌ Health Server Error: ${err.message}`);
        });
    }

    /**
     * Handle incoming HTTP requests
     */
    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = req.url || '/';

        // Set CORS headers for monitoring tools
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        switch (url) {
            case '/healthz':
            case '/health':
                this.handleHealthz(res);
                break;

            case '/readyz':
            case '/ready':
                this.handleReadyz(res);
                break;

            case '/metrics':
                this.handleMetrics(res);
                break;

            case '/status':
                this.handleStatus(res);
                break;

            default:
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not Found', endpoints: ['/healthz', '/readyz', '/metrics', '/status'] }));
        }
    }

    /**
     * Simple health check - returns 200 if running
     */
    private handleHealthz(res: http.ServerResponse): void {
        res.writeHead(200);
        res.end(JSON.stringify({
            ok: true,
            service: 'centinela-collector',
            ts: new Date().toISOString()
        }));
    }

    /**
     * Readiness check - checks if collector is ready to receive logs
     */
    private handleReadyz(res: http.ServerResponse): void {
        const bufferStats = this.getBufferStats();
        const retryStats = this.getRetryStats();

        // Determine health status
        const bufferUsage = bufferStats.size / config.MAX_BUFFER_SIZE;
        const hasExcessiveDLQ = retryStats.dlq > 100;

        let status: 'ok' | 'warning' | 'critical' = 'ok';

        if (bufferUsage > 0.9 || hasExcessiveDLQ) {
            status = 'critical';
        } else if (bufferUsage > 0.7 || retryStats.dlq > 50) {
            status = 'warning';
        }

        const isReady = status !== 'critical';
        const httpCode = isReady ? 200 : 503;

        res.writeHead(httpCode);
        res.end(JSON.stringify({
            ready: isReady,
            status,
            service: 'centinela-collector',
            checks: {
                buffer: {
                    status: bufferUsage > 0.9 ? 'critical' : bufferUsage > 0.7 ? 'warning' : 'ok',
                    size: bufferStats.size,
                    max: config.MAX_BUFFER_SIZE,
                    usage_percent: Math.round(bufferUsage * 100),
                },
                retries: {
                    status: hasExcessiveDLQ ? 'critical' : retryStats.dlq > 50 ? 'warning' : 'ok',
                    pending: retryStats.pending,
                    dlq: retryStats.dlq,
                },
            },
            ts: new Date().toISOString(),
        }));
    }

    /**
     * Detailed metrics endpoint
     */
    private handleMetrics(res: http.ServerResponse): void {
        const snapshot = metrics.getSnapshot();
        const bufferStats = this.getBufferStats();
        const retryStats = this.getRetryStats();

        const fullMetrics = {
            ...snapshot,
            buffer: {
                size: bufferStats.size,
                max: config.MAX_BUFFER_SIZE,
                dropped: bufferStats.dropped,
            },
            retry_queue: retryStats,
            connections: {
                tcp: this.getTcpConnections(),
            },
            config: {
                batch_size: config.BATCH_SIZE,
                flush_interval_ms: config.FLUSH_INTERVAL_MS,
                max_retries: config.MAX_RETRIES,
            },
        };

        res.writeHead(200);
        res.end(JSON.stringify(fullMetrics, null, 2));
    }

    /**
     * Quick status overview
     */
    private handleStatus(res: http.ServerResponse): void {
        const snapshot = metrics.getSnapshot();
        const retryStats = this.getRetryStats();

        const health: HealthStatus = {
            status: retryStats.dlq > 100 ? 'unhealthy' : retryStats.dlq > 50 ? 'degraded' : 'healthy',
            service: 'centinela-collector',
            version: '0.2.0',
            uptime: snapshot.uptime_human,
            checks: {
                buffer: snapshot.events.pending > config.MAX_BUFFER_SIZE * 0.9 ? 'critical' : 'ok',
                retries: retryStats.dlq > 100 ? 'critical' : retryStats.dlq > 50 ? 'warning' : 'ok',
            },
        };

        const httpCode = health.status === 'unhealthy' ? 503 : 200;
        res.writeHead(httpCode);
        res.end(JSON.stringify(health));
    }

    /**
     * Start the health check server
     */
    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(config.HEALTH_PORT, '0.0.0.0', () => {
                this.isRunning = true;
                console.log(`📊 Health/Metrics server on http://0.0.0.0:${config.HEALTH_PORT}`);
                console.log(`   Endpoints: /healthz, /readyz, /metrics, /status`);
                resolve();
            });

            this.server.once('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Stop the health check server
     */
    public stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.isRunning) {
                resolve();
                return;
            }

            this.server.close(() => {
                this.isRunning = false;
                console.log('   Health server stopped.');
                resolve();
            });
        });
    }
}
