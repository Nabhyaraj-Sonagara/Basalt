// Two-way sync of one hive folder with one remote hive.
//
// Each cycle pulls remote changes since the last sequence number, then pushes local changes
// with the revision it last saw (If-Match). If someone else wrote first the server answers 409
// and the cycle pulls again. When both sides changed a file, the remote version takes the path
// and the local one is kept next to it as "Name (conflict 2026-11-17 0930).md".
import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import { hiveKeys, openContent, openMeta, pathId, sealContent, sealMeta, sha256, type HiveKeys } from './crypto';
import { SyncHttpError, type SyncClient } from './client';
import type { LocalFile, SyncFs } from './fs';
import { MAX_FILE_BYTES_DEFAULT } from './protocol';

export interface FileState {
  pathId: string;
  /** Server revision this device last saw. */
  rev: number;
  /** sha256 of the content at that revision; null when the remote copy is a deletion we haven't replaced yet. */
  hash: string | null;
  /** Local size and mtime when `hash` was last confirmed, to skip rehashing unchanged files. */
  size?: number;
  mtime?: number;
}

export interface SyncState {
  hiveId: string;
  lastSeq: number;
  files: Record<string, FileState>;
}

export interface StateStore {
  load(): Promise<SyncState | null>;
  save(state: SyncState): Promise<void>;
}

export class JsonStateStore implements StateStore {
  constructor(readonly file: string) {}
  async load(): Promise<SyncState | null> {
    try {
      return JSON.parse(await fsp.readFile(this.file, 'utf8')) as SyncState;
    } catch {
      return null;
    }
  }
  async save(state: SyncState): Promise<void> {
    await fsp.mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state));
    await fsp.rename(tmp, this.file);
  }
}

export type SyncEvent =
  | { type: 'downloaded'; path: string }
  | { type: 'uploaded'; path: string }
  | { type: 'deleted'; path: string; where: 'local' | 'remote' }
  | { type: 'conflict'; path: string; copy: string }
  | { type: 'skipped'; path: string; reason: string };

export interface SyncResult {
  downloaded: number;
  uploaded: number;
  deleted: number;
  conflicts: string[];
  skipped: string[];
}

export interface EngineOptions {
  client: SyncClient;
  hiveId: string;
  hiveKey: Buffer;
  fs: SyncFs;
  store: StateStore;
  maxFileBytes?: number;
  onEvent?: (e: SyncEvent) => void;
  now?: () => Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

export class SyncEngine {
  private readonly keys: HiveKeys;
  private state: SyncState | null = null;
  private running: Promise<SyncResult> | null = null;
  private again = false;

  constructor(private readonly o: EngineOptions) {
    this.keys = hiveKeys(o.hiveKey);
  }

  /** Runs a sync cycle. Calls made while one runs are folded into one more cycle afterwards. */
  run(): Promise<SyncResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        let result: SyncResult;
        do {
          this.again = false;
          result = await this.cycle();
        } while (this.again);
        return result;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async loadState(): Promise<SyncState> {
    if (!this.state) {
      const s = await this.o.store.load();
      this.state = s && s.hiveId === this.o.hiveId ? s : { hiveId: this.o.hiveId, lastSeq: 0, files: {} };
    }
    return this.state;
  }

  private emit(e: SyncEvent, r: SyncResult) {
    if (e.type === 'downloaded') r.downloaded++;
    if (e.type === 'uploaded') r.uploaded++;
    if (e.type === 'deleted') r.deleted++;
    if (e.type === 'conflict') r.conflicts.push(e.copy);
    if (e.type === 'skipped') r.skipped.push(e.path);
    this.o.onEvent?.(e);
  }

  private async cycle(): Promise<SyncResult> {
    const r: SyncResult = { downloaded: 0, uploaded: 0, deleted: 0, conflicts: [], skipped: [] };
    const state = await this.loadState();
    for (let round = 0; round < 6; round++) {
      await this.pull(state, r);
      await this.o.store.save(state);
      const clean = await this.push(state, r);
      await this.o.store.save(state);
      if (clean) return r;
    }
    throw new Error('Sync kept colliding with changes from another device. It will try again shortly.');
  }

  /** The local file's hash, using the recorded size and mtime to avoid rereading unchanged files. */
  private async localHash(path: string, st?: FileState, local?: LocalFile | null): Promise<{ hash: string; file: LocalFile } | null> {
    const file = local === undefined ? await this.o.fs.stat(path) : local;
    if (!file) return null;
    if (st && st.hash && st.size === file.size && st.mtime === file.mtime) return { hash: st.hash, file };
    return { hash: sha256(await this.o.fs.read(path)), file };
  }

  private conflictPath(path: string, taken: Set<string>): string {
    const d = (this.o.now ?? (() => new Date()))();
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
    const slash = path.lastIndexOf('/');
    const dot = path.lastIndexOf('.');
    const hasExt = dot > slash + 1;
    const stem = hasExt ? path.slice(0, dot) : path;
    const ext = hasExt ? path.slice(dot) : '';
    for (let i = 1; ; i++) {
      const cand = `${stem} (conflict ${stamp}${i > 1 ? ` ${i}` : ''})${ext}`;
      if (!taken.has(cand)) return cand;
    }
  }

  private async pull(state: SyncState, r: SyncResult): Promise<void> {
    const { client, hiveId, fs } = this.o;
    for (;;) {
      const page = await client.changes(hiveId, state.lastSeq);
      for (const rec of page.records) {
        if (!rec.meta) continue;
        let meta;
        try {
          meta = openMeta(this.keys, rec.pathId, rec.meta);
        } catch {
          this.emit({ type: 'skipped', path: rec.pathId, reason: "couldn't decrypt (written with a different key)" }, r);
          continue;
        }
        const path = meta.path;
        if (pathId(this.keys, path) !== rec.pathId) {
          this.emit({ type: 'skipped', path, reason: 'path does not match its id' }, r);
          continue;
        }
        const base = state.files[path];
        if (base && base.rev >= rec.rev) continue; // already have it (often our own upload)

        const local = await this.localHash(path, base);
        if (rec.deleted) {
          if (!local) delete state.files[path];
          else if (base && local.hash === base.hash) {
            await fs.remove(path);
            delete state.files[path];
            this.emit({ type: 'deleted', path, where: 'local' }, r);
          } else {
            // Edited here, deleted there: keep the edit and upload it over the deletion.
            state.files[path] = { pathId: rec.pathId, rev: rec.rev, hash: null };
          }
          continue;
        }

        if (local && local.hash === meta.hash) {
          state.files[path] = { pathId: rec.pathId, rev: rec.rev, hash: meta.hash, size: local.file.size, mtime: local.file.mtime };
          continue;
        }
        const data = openContent(this.keys, rec.pathId, await client.getFile(hiveId, rec.pathId));
        if (sha256(data) !== meta.hash) throw new Error(`Downloaded ${path} didn't match its checksum; sync will retry.`);
        if (local && (!base || local.hash !== base.hash)) {
          // Changed on both sides: keep ours as a conflict copy, take theirs at the path.
          const taken = new Set([...Object.keys(state.files), ...(await fs.list()).map((f) => f.path)]);
          const copy = this.conflictPath(path, taken);
          await fs.write(copy, await fs.read(path));
          this.emit({ type: 'conflict', path, copy }, r);
        }
        const written = await fs.write(path, data, meta.mtime);
        state.files[path] = { pathId: rec.pathId, rev: rec.rev, hash: meta.hash, size: written.size, mtime: written.mtime };
        this.emit({ type: 'downloaded', path }, r);
      }
      state.lastSeq = Math.max(state.lastSeq, page.seq);
      if (!page.more) return;
    }
  }

  /** Returns false when the server reported a newer revision (pull and try again). */
  private async push(state: SyncState, r: SyncResult): Promise<boolean> {
    const { client, hiveId, fs } = this.o;
    const max = this.o.maxFileBytes ?? MAX_FILE_BYTES_DEFAULT;
    const local = await fs.list();
    const present = new Set(local.map((f) => f.path));
    try {
      for (const f of local) {
        const st = state.files[f.path];
        if (f.size > max) {
          if (!st) this.emit({ type: 'skipped', path: f.path, reason: `larger than ${Math.round(max / 1e6)} MB` }, r);
          continue;
        }
        const lh = await this.localHash(f.path, st, f);
        if (!lh) continue;
        if (st && st.hash === lh.hash) {
          st.size = f.size;
          st.mtime = f.mtime;
          continue;
        }
        const data = await fs.read(f.path);
        const hash = sha256(data);
        const id = pathId(this.keys, f.path);
        const meta = sealMeta(this.keys, id, { path: f.path, hash, size: data.length, mtime: f.mtime });
        const res = await client.putFile(hiveId, id, sealContent(this.keys, id, data), meta, st?.rev ?? 0);
        state.files[f.path] = { pathId: id, rev: res.rev, hash, size: f.size, mtime: f.mtime };
        this.emit({ type: 'uploaded', path: f.path }, r);
      }
      for (const [path, st] of Object.entries(state.files)) {
        if (present.has(path)) continue;
        if (st.hash !== null) {
          const meta = sealMeta(this.keys, st.pathId, { path, hash: '', size: 0, mtime: Date.now() });
          await client.deleteFile(hiveId, st.pathId, meta, st.rev);
          this.emit({ type: 'deleted', path, where: 'remote' }, r);
        }
        delete state.files[path];
      }
      return true;
    } catch (err) {
      if (err instanceof SyncHttpError && err.status === 409) return false;
      throw err;
    }
  }
}
