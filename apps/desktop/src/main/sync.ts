// Basalt Sync in the main process: account, keys (OS keychain), and one engine for the open hive.
import { app, safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Hive } from '@basalt/core';
import {
  JsonStateStore,
  NodeSyncFs,
  SyncClient,
  SyncEngine,
  SyncHttpError,
  createAccount,
  createRemoteHive,
  isOffline,
  listHives,
  signIn,
  type SyncEvent,
} from '@basalt/sync';
import type { SyncStatus } from '../shared/api';

declare const __BASALT_SYNC_URL__: string;
const DEFAULT_SERVER = typeof __BASALT_SYNC_URL__ === 'string' ? __BASALT_SYNC_URL__ : '';

interface Stored {
  server: string;
  email: string | null;
  /** Session token and account key, encrypted with the OS keychain (safeStorage). */
  token: string | null;
  accountKey: string | null;
  /** Remote hive for each local hive folder. */
  links: Record<string, { hiveId: string; name: string; paused?: boolean }>;
}

const file = () => join(app.getPath('userData'), 'sync.json');
const keychain = () => safeStorage.isEncryptionAvailable();

export class SyncController {
  private stored: Stored = { server: DEFAULT_SERVER, email: null, token: null, accountKey: null, links: {} };
  /** Secrets held only in memory when there's no keychain (they're gone after a restart). */
  private memory: { token: string | null; accountKey: Buffer | null } = { token: null, accountKey: null };
  private hive: Hive | null = null;
  private engine: SyncEngine | null = null;
  private status: Omit<SyncStatus, 'server' | 'email' | 'signedIn' | 'keychain' | 'linked'> = { state: 'off', lastSync: null, error: null, conflicts: [] };
  private stopFns: (() => void)[] = [];
  private debounce: NodeJS.Timeout | null = null;
  private cycleSkipped: string[] = [];

  constructor(private readonly notify: (s: SyncStatus) => void) {}

  async load(): Promise<void> {
    try {
      this.stored = { ...this.stored, ...JSON.parse(await fs.readFile(file(), 'utf8')) };
      if (!this.stored.server) this.stored.server = DEFAULT_SERVER;
    } catch {
      /* first run */
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(file(), JSON.stringify(this.stored, null, 2), { mode: 0o600 });
  }

  private secret(kind: 'token' | 'accountKey'): string | null {
    if (this.memory[kind]) return kind === 'accountKey' ? (this.memory.accountKey as Buffer).toString('base64') : this.memory.token;
    const enc = this.stored[kind];
    if (!enc || !keychain()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  }

  private setSecrets(token: string | null, accountKey: Buffer | null) {
    if (keychain()) {
      this.stored.token = token ? safeStorage.encryptString(token).toString('base64') : null;
      this.stored.accountKey = accountKey ? safeStorage.encryptString(accountKey.toString('base64')).toString('base64') : null;
      this.memory = { token: null, accountKey: null };
    } else {
      this.stored.token = null;
      this.stored.accountKey = null;
      this.memory = { token, accountKey };
    }
  }

  private client(): SyncClient {
    if (!this.stored.server) throw new Error('Enter the address of your sync server first.');
    return new SyncClient(this.stored.server, this.secret('token'));
  }
  private accountKey(): Buffer {
    const k = this.secret('accountKey');
    if (!k) throw new Error('Sign in to sync.');
    return Buffer.from(k, 'base64');
  }
  private link() {
    return this.hive ? (this.stored.links[this.hive.root] ?? null) : null;
  }

  getStatus(): SyncStatus {
    const link = this.link();
    return {
      ...this.status,
      server: this.stored.server,
      email: this.stored.email,
      signedIn: !!this.secret('token') && !!this.secret('accountKey'),
      keychain: keychain(),
      linked: link ? { hiveId: link.hiveId, name: link.name, paused: !!link.paused } : null,
    };
  }

  private update(patch: Partial<SyncController['status']>) {
    this.status = { ...this.status, ...patch };
    this.notify(this.getStatus());
  }

  // ----- account -----

  async setServer(url: string): Promise<SyncStatus> {
    const next = url.trim().replace(/\/+$/, '');
    if (next) new SyncClient(next); // validates https
    if (next !== this.stored.server) {
      this.stop();
      this.stored = { ...this.stored, server: next, email: null, links: {} };
      this.setSecrets(null, null);
      await this.save();
    }
    this.update({ state: 'off', error: null });
    return this.getStatus();
  }

  async signUp(email: string, password: string): Promise<SyncStatus> {
    const c = new SyncClient(this.stored.server || (() => { throw new Error('Enter the address of your sync server first.'); })());
    const s = await createAccount(c, email, password);
    return this.signedIn(email, s.token, s.accountKey);
  }

  async signIn(email: string, password: string): Promise<SyncStatus> {
    if (!this.stored.server) throw new Error('Enter the address of your sync server first.');
    const s = await signIn(new SyncClient(this.stored.server), email, password);
    return this.signedIn(email, s.token, s.accountKey);
  }

  private async signedIn(email: string, token: string, accountKey: Buffer) {
    this.stored.email = email.trim().toLowerCase();
    this.setSecrets(token, accountKey);
    await this.save();
    this.update({ error: null });
    await this.restart();
    return this.getStatus();
  }

  async signOut(): Promise<SyncStatus> {
    this.stop();
    try {
      if (this.secret('token')) await this.client().logout();
    } catch {
      /* offline or already expired */
    }
    this.setSecrets(null, null);
    this.stored.email = null;
    await this.save();
    this.update({ state: 'off', error: null, conflicts: [] });
    return this.getStatus();
  }

  async usage(): Promise<{ usageBytes: number; quotaBytes: number; maxFileBytes?: number } | null> {
    try {
      const me = await this.client().me();
      return { usageBytes: me.usageBytes, quotaBytes: me.quotaBytes, maxFileBytes: me.maxFileBytes };
    } catch {
      return null;
    }
  }

  async remoteHives(): Promise<{ id: string; name: string }[]> {
    return (await listHives(this.client(), this.accountKey())).map((h) => ({ id: h.id, name: h.name }));
  }

  // ----- linking the open hive -----

  async connect(remoteId: string | null): Promise<SyncStatus> {
    if (!this.hive) throw new Error('Open a hive first.');
    const c = this.client();
    const key = this.accountKey();
    let target: { id: string; name: string };
    if (remoteId) {
      const found = (await listHives(c, key)).find((h) => h.id === remoteId);
      if (!found) throw new Error('That remote hive no longer exists.');
      target = found;
    } else target = await createRemoteHive(c, key, this.hive.name);
    this.stored.links[this.hive.root] = { hiveId: target.id, name: target.name };
    await this.save();
    await this.restart();
    return this.getStatus();
  }

  async disconnect(): Promise<SyncStatus> {
    if (!this.hive) return this.getStatus();
    this.stop();
    delete this.stored.links[this.hive.root];
    await this.save();
    this.update({ state: 'off', error: null, conflicts: [] });
    return this.getStatus();
  }

  async setPaused(paused: boolean): Promise<SyncStatus> {
    const link = this.link();
    if (!link) return this.getStatus();
    link.paused = paused;
    await this.save();
    await this.restart();
    return this.getStatus();
  }

  // ----- the engine -----

  /** Call when a hive opens or closes. */
  async attach(hive: Hive | null): Promise<void> {
    this.stop();
    this.hive = hive;
    this.status = { state: 'off', lastSync: null, error: null, conflicts: [] };
    await this.restart();
  }

  private stop() {
    for (const f of this.stopFns.splice(0)) f();
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.engine = null;
  }

  private async restart(): Promise<void> {
    this.stop();
    const link = this.link();
    const hive = this.hive;
    if (!hive || !link || !this.getStatus().signedIn) {
      this.update({ state: 'off' });
      return;
    }
    if (link.paused) {
      this.update({ state: 'paused' });
      return;
    }
    let hiveKey: Buffer;
    let maxFileBytes: number | undefined;
    try {
      const remote = (await listHives(this.client(), this.accountKey())).find((h) => h.id === link.hiveId);
      if (!remote) throw new Error('The remote hive was deleted. Connect this hive again in Settings → Sync.');
      hiveKey = remote.hiveKey;
      // The server's size limit, so oversized notes are skipped here instead of refused there.
      maxFileBytes = (await this.client().me()).maxFileBytes;
    } catch (err) {
      this.fail(err);
      // Try again in a minute (for example when the network comes back).
      const t = setTimeout(() => void this.restart(), 60_000);
      this.stopFns.push(() => clearTimeout(t));
      return;
    }
    const stateFile = join(app.getPath('userData'), 'sync', `${createHash('sha256').update(`${hive.root}\0${link.hiveId}`).digest('hex').slice(0, 24)}.json`);
    const engine = new SyncEngine({
      client: this.client(),
      hiveId: link.hiveId,
      hiveKey,
      fs: new NodeSyncFs(hive.root),
      store: new JsonStateStore(stateFile),
      maxFileBytes,
      onEvent: (e: SyncEvent) => {
        if (e.type === 'conflict') this.update({ conflicts: [...this.status.conflicts, e.copy] });
        if (e.type === 'skipped' && !this.cycleSkipped.includes(e.path)) this.cycleSkipped.push(e.path);
      },
    });
    this.engine = engine;

    const onChange = () => this.schedule(2000);
    hive.on('change', onChange);
    this.stopFns.push(() => hive.off('change', onChange));
    const poll = setInterval(() => this.schedule(0), 60_000);
    this.stopFns.push(() => clearInterval(poll));

    // Server events wake us when another device syncs; reconnect with backoff.
    const ctrl = new AbortController();
    this.stopFns.push(() => ctrl.abort());
    void (async () => {
      let wait = 2000;
      while (!ctrl.signal.aborted) {
        try {
          await this.client().events(link.hiveId, () => this.schedule(300), ctrl.signal);
          wait = 2000;
        } catch {
          /* dropped; retry */
        }
        if (ctrl.signal.aborted) return;
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 60_000);
      }
    })();

    await this.runNow();
  }

  private schedule(ms: number) {
    if (!this.engine) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.runNow(), ms);
  }

  async runNow(): Promise<SyncStatus> {
    const engine = this.engine;
    if (!engine) return this.getStatus();
    this.update({ state: 'syncing' });
    this.cycleSkipped = [];
    try {
      await engine.run();
      if (this.engine === engine) this.update({ state: 'idle', lastSync: Date.now(), error: null, skipped: [...this.cycleSkipped] });
    } catch (err) {
      if (this.engine === engine) this.fail(err);
    }
    return this.getStatus();
  }

  private fail(err: unknown) {
    if (err instanceof SyncHttpError && err.status === 401) {
      this.setSecrets(null, null);
      void this.save();
      this.stop();
      this.update({ state: 'error', error: 'Your sync session ended. Sign in again in Settings → Sync.' });
    } else if (isOffline(err)) this.update({ state: 'offline', error: null });
    else this.update({ state: 'error', error: (err as Error).message });
  }
}
