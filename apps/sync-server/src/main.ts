import { loadConfig } from './config';
import { createPool, migrate } from './db';
import { DiskBlobStore, s3BlobStore } from './blobs';
import { Notifier } from './notify';
import { createApp } from './app';

const config = loadConfig();
const db = createPool(config.databaseUrl);
await migrate(db);
const blobs = config.s3 ? await s3BlobStore(config.s3) : new DiskBlobStore(config.dataDir);
const notifier = new Notifier(db);
await notifier.start(config.databaseUrl);
const server = createApp({ config, db, blobs, notifier });
// Long-lived event streams; keep idle sockets open well past proxy timeouts.
server.keepAliveTimeout = 65_000;
server.requestTimeout = 0;
server.listen(config.port, config.host, () => {
  console.log(`Basalt Sync listening on ${config.host}:${config.port} (blobs: ${config.s3 ? `s3://${config.s3.bucket}` : config.dataDir})`);
});

const shutdown = async () => {
  server.close();
  await notifier.stop();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
