import net from 'node:net';
import { config } from './config.js';
import type { SyslogEvent } from './buffer.js';
import type { MessageBuffer } from './buffer.js';
import { metrics } from './metrics.js';

/**
 * TCP Syslog Server
 * 
 * Handles syslog messages over TCP with:
 * - Multiple concurrent connections
 * - Line-based message parsing (syslog messages are newline-delimited)
 * - Graceful connection handling
 */
export class TcpServer {
    private server: net.Server;
    private buffer: MessageBuffer;
    private connections = new Set<net.Socket>();
    private isRunning = false;

    constructor(buffer: MessageBuffer) {
        this.buffer = buffer;
        this.server = net.createServer(this.handleConnection.bind(this));

        this.server.on('error', (err) => {
            console.error(`❌ TCP Server Error: ${err.message}`);
        });
    }

    /**
     * Handle a new TCP connection
     */
    private handleConnection(socket: net.Socket): void {
        const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
        this.connections.add(socket);

        if (config.LOG_LEVEL === 'debug') {
            console.log(`🔌 TCP connection from ${clientAddr}`);
        }

        // Buffer for incomplete messages (syslog over TCP is line-delimited)
        let messageBuffer = '';

        socket.on('data', (data) => {
            messageBuffer += data.toString('utf8');

            // Process complete lines (syslog messages are newline-terminated)
            let newlineIndex: number;
            while ((newlineIndex = messageBuffer.indexOf('\n')) !== -1) {
                const line = messageBuffer.slice(0, newlineIndex).trim();
                messageBuffer = messageBuffer.slice(newlineIndex + 1);

                if (line.length > 0) {
                    this.processMessage(line, socket.remoteAddress || 'unknown');
                }
            }

            // Handle very long lines (protection against memory exhaustion)
            if (messageBuffer.length > 65536) { // 64KB limit
                console.warn(`⚠️ TCP message too long from ${clientAddr}, truncating`);
                this.processMessage(messageBuffer.slice(0, 65536), socket.remoteAddress || 'unknown');
                messageBuffer = '';
            }
        });

        socket.on('close', () => {
            this.connections.delete(socket);
            if (config.LOG_LEVEL === 'debug') {
                console.log(`🔌 TCP connection closed from ${clientAddr}`);
            }
        });

        socket.on('error', (err) => {
            // ECONNRESET is common and not really an error
            if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
                console.error(`❌ TCP socket error from ${clientAddr}: ${err.message}`);
            }
            socket.destroy();
            this.connections.delete(socket);
        });

        // Set socket timeout (5 minutes of inactivity)
        socket.setTimeout(300000);
        socket.on('timeout', () => {
            if (config.LOG_LEVEL === 'debug') {
                console.log(`⏱️ TCP connection timeout from ${clientAddr}`);
            }
            socket.end();
        });
    }

    /**
     * Process a single syslog message
     */
    private processMessage(rawMessage: string, sourceIp: string): void {
        const event: SyslogEvent = {
            raw_message: rawMessage,
            received_at: new Date().toISOString(),
            source_ip: sourceIp,
        };

        metrics.incrementReceived();

        const added = this.buffer.push(event);
        if (!added) {
            metrics.incrementDropped();
            if (this.buffer.dropped % 100 === 0) {
                console.warn(`⚠️ Buffer full! Dropped ${this.buffer.dropped} events so far.`);
            }
        }
    }

    /**
     * Start the TCP server
     */
    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(config.TCP_PORT, config.TCP_BIND_ADDRESS, () => {
                this.isRunning = true;
                console.log(`👂 TCP Syslog listening on tcp://${config.TCP_BIND_ADDRESS}:${config.TCP_PORT}`);
                resolve();
            });

            this.server.once('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Stop the TCP server gracefully
     */
    public stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.isRunning) {
                resolve();
                return;
            }

            // Close all active connections
            for (const socket of this.connections) {
                socket.destroy();
            }
            this.connections.clear();

            this.server.close(() => {
                this.isRunning = false;
                console.log('   TCP server stopped.');
                resolve();
            });
        });
    }

    /**
     * Get the number of active connections
     */
    public get connectionCount(): number {
        return this.connections.size;
    }
}
