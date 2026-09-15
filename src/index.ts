import { buildApp, setReady, SERVICE_NAME } from './app.js';
import { connectProducer, disconnectProducer, startOutboxPublisher, stopOutboxPublisher } from './events/producer.js';
import { pingDb } from './db/client.js';

const PORT = Number(process.env['PORT'] ?? 3002);
const app = buildApp();

async function main(): Promise<void> {
  await app.listen({ port: PORT, host: '0.0.0.0' });

  if (!(await pingDb())) {
    // Do NOT exit. Staying up but un-ready lets Kubernetes keep the pod while
    // the database recovers, instead of crash-looping and adding restart noise
    // to the exact moment you are trying to diagnose a DB outage.
    app.log.error('database unreachable at startup; staying un-ready');
  }

  try {
    await connectProducer();
    startOutboxPublisher();
    app.log.info('kafka producer connected');
  } catch (err) {
    // A broker outage must not stop the service accepting writes - the outbox
    // holds events until the publisher can drain them.
    app.log.error({ err }, 'kafka unavailable; events will queue in the outbox');
  }

  setReady(true);
  app.log.info({ service: SERVICE_NAME, port: PORT }, 'service started');
}

let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    // Fail readiness FIRST so the endpoint controller removes this pod before
    // we stop accepting connections; otherwise in-flight requests get severed.
    setReady(false);
    stopOutboxPublisher();
    void (async () => {
      await app.close();
      await disconnectProducer();
      process.exit(0);
    })();
  });
}

main().catch((err: unknown) => {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
});
