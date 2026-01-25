import dgram from 'node:dgram';
import { config } from './config.js';
import { MessageBuffer, type SyslogEvent } from './buffer.js';
import { HttpTransport } from './transport.js';
import { TcpServer } from './tcp-server.js';
import { HealthServer } from './health-server.js';
import { metrics } from './metrics.js';

async function main() {
  console.log('🚀 Centinela Smart Collector v0.2.0 starting...');
  console.log(`   Mode: ${config.NODE_ENV}`);
  console.log(`   Target: ${config.CENTINELA_API_URL}`);
  console.log(`   Collector: ${config.COLLECTOR_NAME}`);

  // Core Components
  const buffer = new MessageBuffer();
  const transport = new HttpTransport();

  // Optional: TCP Server
  let tcpServer: TcpServer | null = null;
  if (config.TCP_ENABLED) {
    tcpServer = new TcpServer(buffer);
  }

  // Optional: UDP Server
  let udpSocket: dgram.Socket | null = null;
  if (config.UDP_ENABLED) {
    udpSocket = dgram.createSocket('udp4');
  }

  // Health Check Server
  let healthServer: HealthServer | null = null;
  if (config.HEALTH_ENABLED) {
    healthServer = new HealthServer({
      getBufferStats: () => ({ size: buffer.size, dropped: buffer.dropped }),
      getRetryStats: () => transport.getRetryStats(),
      getTcpConnections: () => tcpServer?.connectionCount ?? 0,
    });
  }

  // ============= UDP EVENT HANDLER =============
  if (udpSocket) {
    udpSocket.on('message', (msg, rinfo) => {
      const event: SyslogEvent = {
        raw_message: msg.toString('utf8'),
        received_at: new Date().toISOString(),
        source_ip: rinfo.address,
      };

      metrics.incrementReceived();

      const added = buffer.push(event);
      if (!added) {
        metrics.incrementDropped();
        if (buffer.dropped % 100 === 0) {
          console.warn(`⚠️ Buffer full! Dropped ${buffer.dropped} events so far.`);
        }
      }
    });

    udpSocket.on('error', (err) => {
      console.error(`❌ UDP Server Error:\n${err.stack}`);
      udpSocket?.close();
    });

    udpSocket.on('listening', () => {
      const address = udpSocket!.address();
      console.log(`👂 UDP Syslog listening on udp://${address.address}:${address.port}`);
    });

    // Start UDP Server
    udpSocket.bind(config.UDP_PORT, config.UDP_BIND_ADDRESS);
  }

  // ============= TCP SERVER =============
  if (tcpServer) {
    try {
      await tcpServer.start();
    } catch (err) {
      console.error('❌ Failed to start TCP server:', err);
    }
  }

  // ============= HEALTH SERVER =============
  if (healthServer) {
    try {
      await healthServer.start();
    } catch (err) {
      console.error('❌ Failed to start health server:', err);
    }
  }

  // ============= MAIN FLUSH LOOP =============
  const flushLoop = async () => {
    // Process main buffer
    if (!buffer.isEmpty()) {
      const batch = buffer.popBatch(config.BATCH_SIZE);
      const start = Date.now();

      try {
        await transport.sendBatch(batch);
        const duration = Date.now() - start;

        if (config.LOG_LEVEL === 'debug') {
          const retryStats = transport.getRetryStats();
          console.log(
            `📤 Sent ${batch.length} events in ${duration}ms. ` +
            `Buffer: ${buffer.size}, Retries: ${retryStats.pending}, DLQ: ${retryStats.dlq}`
          );
        }
      } catch (err) {
        console.error('❌ Flush error:', err);
      }
    }

    // Schedule next flush
    setTimeout(flushLoop, config.FLUSH_INTERVAL_MS);
  };

  // ============= RETRY PROCESSING LOOP =============
  const retryLoop = async () => {
    try {
      await transport.processRetries();
    } catch (err) {
      console.error('❌ Retry processing error:', err);
    }

    // Schedule next retry check
    setTimeout(retryLoop, config.RETRY_CHECK_INTERVAL_MS);
  };

  // ============= PERIODIC STATUS LOG =============
  const statusLoop = () => {
    if (config.LOG_LEVEL !== 'debug' && config.LOG_LEVEL !== 'info') {
      return;
    }

    const snapshot = metrics.getSnapshot();
    const retryStats = transport.getRetryStats();

    // Only log if there's activity
    if (snapshot.events.received > 0 || retryStats.pending > 0) {
      console.log(
        `📈 [${snapshot.uptime_human}] ` +
        `Recv: ${snapshot.events.received} | ` +
        `Sent: ${snapshot.events.sent} | ` +
        `Failed: ${snapshot.events.failed} | ` +
        `Retries: ${retryStats.pending} | ` +
        `DLQ: ${retryStats.dlq} | ` +
        `Rate: ${snapshot.rates.events_per_second}/s | ` +
        `Success: ${snapshot.rates.success_rate}%`
      );
    }

    setTimeout(statusLoop, 60000); // Log every minute
  };

  // Start all loops
  flushLoop();
  retryLoop();
  setTimeout(statusLoop, 60000); // First status log after 1 minute

  // ============= GRACEFUL SHUTDOWN =============
  const shutdown = async () => {
    console.log('\n🛑 Shutting down collector...');

    // Stop accepting new connections
    if (tcpServer) {
      await tcpServer.stop();
    }

    if (udpSocket) {
      await new Promise<void>((resolve) => {
        udpSocket!.close(() => {
          console.log('   UDP socket closed.');
          resolve();
        });
      });
    }

    // Flush remaining buffer
    if (!buffer.isEmpty()) {
      console.log(`   Flushing ${buffer.size} remaining events...`);
      const remaining = buffer.popBatch(buffer.size);
      try {
        await transport.sendBatch(remaining);
        console.log('   ✅ Buffer flushed.');
      } catch (err) {
        console.error('   ❌ Failed to flush buffer:', err);
      }
    }

    // Process pending retries one last time
    if (transport.hasPendingRetries()) {
      console.log('   Processing pending retries...');
      await transport.processRetries();
    }

    // Export any DLQ events
    const dlqEvents = transport.exportDLQ();
    if (dlqEvents.length > 0) {
      console.warn(`   ⚠️ ${dlqEvents.length} events in DLQ will be lost.`);
      // In production, you might want to write these to a file
    }

    // Stop health server
    if (healthServer) {
      await healthServer.stop();
    }

    // Final metrics
    const finalMetrics = metrics.getSnapshot();
    console.log(
      `📊 Final stats: Received ${finalMetrics.events.received}, ` +
      `Sent ${finalMetrics.events.sent}, ` +
      `Failed ${finalMetrics.events.failed}, ` +
      `Success rate: ${finalMetrics.rates.success_rate}%`
    );

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Log startup complete
  console.log('✅ Collector ready and listening for events.');
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
