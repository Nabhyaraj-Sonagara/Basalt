// Integration: a real server on Postgres with two "devices" syncing hive folders.
// Needs DATABASE_URL (a disposable database; the test resets its schema).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  NodeSyncFs,
  JsonStateStore,
  SyncClient,
  SyncEngine,
  SyncHttpError,
  createAccount,
  createRemoteHive,
  listHives,
  signIn,
  hiveKeys,
  pathId,
  sealMeta,
  type OpenedHive,
} from '@basalt/sync';
import { createApp } from '../src/app';
import { createPool, migrate, type Db } from '../src/db';
import { DiskBlobStore } from '../src/blobs';
import { Notifier } from '../src/notify';
import type { Config } from '../src/config';

const DB = process.env.DATABASE_URL;
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const SECRET = 'x'.repeat(40);

describe.skipIf(!DB)('sync server and engine', () => {
  let db: Db;
  let server: Server;
  let url: string;
  let blobDir: string;
  let notifier: Notifier;
  const servers: Server[] = [];

  const config = (o: Partial<Config> = {}): Config => ({
    port: 0, host: '127.0.0.1', databaseUrl: DB!, serverSecret: SECRET, dataDir: blobDir, s3: null,
    quotaBytes: 50_000_000, maxFileBytes: 5_000_000, allowSignup: true, trustProxy: false, sessionDays: 90, ...o,
  });
  const listen = (s: Server) => new Promise<string>((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

  beforeAll(async () => {
    db = createPool(DB!);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    await migrate(db); // idempotent
    blobDir = mkdtempSync(join(tmpdir(), 'basalt-blobs-'));
    notifier = new Notifier(db);
    await notifier.start(DB!);
    server = createApp({ config: config(), db, blobs: new DiskBlobStore(blobDir), notifier });
    servers.push(server);
    url = await listen(server);
  });
  afterAll(async () => {
    for (const s of servers) s.closeAllConnections?.(), s.close();
    await notifier.stop();
    await db.end();
  });

  function device(remote: OpenedHive, client: SyncClient) {
    const root = mkdtempSync(join(tmpdir(), 'basalt-dev-'));
    const stateFile = join(mkdtempSync(join(tmpdir(), 'basalt-state-')), 'state.json');
    const engine = new SyncEngine({ client, hiveId: remote.id, hiveKey: remote.hiveKey, fs: new NodeSyncFs(root), store: new JsonStateStore(stateFile), now: () => new Date(2026, 10, 17, 9, 30) });
    const write = (p: string, t: string) => {
      mkdirSync(join(root, p, '..'), { recursive: true });
      writeFileSync(join(root, p), t);
    };
    const read = (p: string) => readFileSync(join(root, p), 'utf8');
    const has = (p: string) => existsSync(join(root, p));
    return { root, engine, write, read, has };
  }

  let a: ReturnType<typeof device>;
  let b: ReturnType<typeof device>;
  let remote: OpenedHive;
  let clientA: SyncClient;

  it('creates an account and signs in from a second device with the same keys', async () => {
    clientA = new SyncClient(url);
    const s = await createAccount(clientA, 'Ada@Example.com', 'a long enough password', FAST);
    const clientB = new SyncClient(url);
    const s2 = await signIn(clientB, 'ada@example.com', 'a long enough password');
    expect(s2.accountKey.equals(s.accountKey)).toBe(true);
    await expect(signIn(new SyncClient(url), 'ada@example.com', 'wrong password!!')).rejects.toMatchObject({ status: 401 });
    await expect(createAccount(new SyncClient(url), 'ada@example.com', 'another password', FAST)).rejects.toMatchObject({ status: 409 });
    // Unknown emails get a stable made-up salt, so sign-in doesn't reveal who has an account.
    const p1 = await clientB.authParams('nobody@example.com');
    const p2 = await clientB.authParams('nobody@example.com');
    expect(p1.salt).toBe(p2.salt);

    remote = await createRemoteHive(clientA, s.accountKey, 'Work notes');
    const seen = await listHives(clientB, s2.accountKey);
    expect(seen.map((h) => h.name)).toEqual(['Work notes']);
    a = device(remote, clientA);
    b = device(seen[0], clientB);
  });

  it('uploads one device and downloads to the other', async () => {
    a.write('Welcome.md', '# Welcome\n\nSecret plans for the launch.');
    a.write('Projects/Plan.md', 'Ship it.');
    a.write('.basalt/settings.json', '{"x":1}');
    a.write('.basalt/workspace.json', '{"per":"device"}');
    a.write('.basalt/index/x.json', '[]');
    const ra = await a.engine.run();
    expect(ra.uploaded).toBe(3);
    const rb = await b.engine.run();
    expect(rb.downloaded).toBe(3);
    expect(b.read('Projects/Plan.md')).toBe('Ship it.');
    expect(b.read('.basalt/settings.json')).toBe('{"x":1}');
    expect(b.has('.basalt/workspace.json')).toBe(false);
    // A second run is a no-op.
    expect(await b.engine.run()).toMatchObject({ uploaded: 0, downloaded: 0 });
  });

  it('carries edits, renames and deletions both ways', async () => {
    b.write('Projects/Plan.md', 'Ship it on Friday.');
    await b.engine.run();
    await a.engine.run();
    expect(a.read('Projects/Plan.md')).toBe('Ship it on Friday.');

    renameSync(join(a.root, 'Projects/Plan.md'), join(a.root, 'Projects/Launch.md'));
    await a.engine.run();
    await b.engine.run();
    expect(b.has('Projects/Plan.md')).toBe(false);
    expect(b.read('Projects/Launch.md')).toBe('Ship it on Friday.');

    rmSync(join(b.root, 'Welcome.md'));
    await b.engine.run();
    await a.engine.run();
    expect(a.has('Welcome.md')).toBe(false);
  });

  it('keeps both versions when a file changed on both devices', async () => {
    a.write('Projects/Launch.md', 'Version from A');
    b.write('Projects/Launch.md', 'Version from B');
    await a.engine.run();
    const rb = await b.engine.run();
    expect(rb.conflicts).toEqual(['Projects/Launch (conflict 2026-11-17 0930).md']);
    expect(b.read('Projects/Launch.md')).toBe('Version from A');
    expect(b.read('Projects/Launch (conflict 2026-11-17 0930).md')).toBe('Version from B');
    await a.engine.run();
    expect(a.read('Projects/Launch (conflict 2026-11-17 0930).md')).toBe('Version from B');
  });

  it('keeps a local edit when the other device deleted the file', async () => {
    b.write('Keep.md', 'v1');
    await b.engine.run();
    await a.engine.run();
    rmSync(join(a.root, 'Keep.md'));
    await a.engine.run();
    b.write('Keep.md', 'v2 edited offline');
    await b.engine.run();
    await a.engine.run();
    expect(a.read('Keep.md')).toBe('v2 edited offline');
  });

  it('rejects a stale write with 409', async () => {
    const keys = hiveKeys(remote.hiveKey);
    const id = pathId(keys, 'Keep.md');
    const err = await clientA.putFile(remote.id, id, Buffer.from('x'), sealMeta(keys, id, { path: 'Keep.md', hash: 'x', size: 1, mtime: 1 }), 1).catch((e) => e);
    expect(err).toBeInstanceOf(SyncHttpError);
    expect(err.status).toBe(409);
    expect(err.body.rev).toBeGreaterThan(1);
  });

  it('streams change events', async () => {
    const ctrl = new AbortController();
    const got: number[] = [];
    const done = clientA.events(remote.id, (seq) => got.push(seq), ctrl.signal).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    b.write('Event.md', 'ping');
    await b.engine.run();
    for (let i = 0; i < 40 && !got.length; i++) await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    await done;
    expect(got.length).toBeGreaterThan(0);
  });

  it('stores no note text or file names on the server', async () => {
    const needles = ['Secret plans', 'Ship it', 'Version from', 'Launch.md', 'Projects', 'Work notes', 'Keep.md'];
    const blobs: Buffer[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else blobs.push(readFileSync(p));
      }
    };
    walk(blobDir);
    expect(blobs.length).toBeGreaterThan(0);
    const dump = (await db.query("SELECT string_agg(encode(coalesce(meta,''), 'escape'), '') AS m FROM files")).rows[0].m + (await db.query("SELECT string_agg(encode(enc_name, 'escape'), '') AS n FROM hives")).rows[0].n;
    for (const n of needles) {
      expect(dump.includes(n)).toBe(false);
      for (const blob of blobs) expect(blob.includes(n)).toBe(false);
    }
  });

  it('enforces the storage quota', async () => {
    const small = createApp({ config: config({ quotaBytes: 30_000 }), db, blobs: new DiskBlobStore(blobDir), notifier });
    servers.push(small);
    const surl = await listen(small);
    const c = new SyncClient(surl);
    const s = await createAccount(c, 'quota@example.com', 'a long enough password', FAST);
    const h = await createRemoteHive(c, s.accountKey, 'Q');
    const d = device(h, c);
    d.write('big.bin', 'x'.repeat(40_000));
    await expect(d.engine.run()).rejects.toMatchObject({ status: 507 });
  });
});
