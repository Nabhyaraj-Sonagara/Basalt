import type { Hive } from '@basalt/core';
import { chunkNote } from './chunk';
import type { Embedder } from './types';

interface StoredChunk {
  heading: string;
  line: number;
  snippet: string;
  vec: Float32Array;
}

interface StoredNote {
  hash: string;
  chunks: StoredChunk[];
}

export interface SemanticHit {
  path: string;
  title: string;
  heading: string;
  line: number;
  score: number;
  snippet: string;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function toB64(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
}

function fromB64(s: string): Float32Array {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/**
 * Embedding index over a hive, stored in `.basalt/index/`. Updates incrementally by content hash,
 * so only changed notes are re-embedded.
 */
export class SemanticIndex {
  private notes = new Map<string, StoredNote>();
  private loaded = false;
  private running: Promise<{ embedded: number; removed: number }> | null = null;

  constructor(
    private hive: Hive,
    private embedder: Embedder,
  ) {}

  get file(): string {
    return `index/semantic-${fnv(this.embedder.id)}.json`;
  }

  get size(): number {
    let n = 0;
    for (const v of this.notes.values()) n += v.chunks.length;
    return n;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const data = await this.hive.readConfig<{ embedder: string; notes: Record<string, { hash: string; chunks: (Omit<StoredChunk, 'vec'> & { vec: string })[] }> }>(this.file);
    if (!data || data.embedder !== this.embedder.id) return;
    for (const [path, n] of Object.entries(data.notes)) {
      this.notes.set(path, { hash: n.hash, chunks: n.chunks.map((c) => ({ ...c, vec: fromB64(c.vec) })) });
    }
  }

  async save(): Promise<void> {
    const notes: Record<string, unknown> = {};
    for (const [path, n] of this.notes) notes[path] = { hash: n.hash, chunks: n.chunks.map((c) => ({ ...c, vec: toB64(c.vec) })) };
    await this.hive.writeConfig(this.file, { embedder: this.embedder.id, notes });
  }

  /** Brings the index up to date with the hive. Concurrent calls share one run. */
  update(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ embedded: number; removed: number }> {
    if (!this.running) {
      this.running = this.doUpdate(onProgress, signal).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async doUpdate(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ embedded: number; removed: number }> {
    await this.load();
    let removed = 0;
    for (const p of [...this.notes.keys()]) if (!this.hive.notes.has(p)) { this.notes.delete(p); removed++; }
    const stale: { path: string; hash: string; text: string; title: string }[] = [];
    for (const rec of this.hive.notes.values()) {
      const text = this.hive.text(rec.path) ?? '';
      const hash = fnv(text);
      if (this.notes.get(rec.path)?.hash !== hash) stale.push({ path: rec.path, hash, text, title: rec.title });
    }
    let done = 0;
    for (const note of stale) {
      if (signal?.aborted) break;
      const chunks = chunkNote(note.path, note.title, note.text);
      const vecs: Float32Array[] = [];
      for (let i = 0; i < chunks.length; i += 32) {
        vecs.push(...(await this.embedder.embed(chunks.slice(i, i + 32).map((c) => c.text), signal)));
      }
      this.notes.set(note.path, {
        hash: note.hash,
        chunks: chunks.map((c, i) => ({ heading: c.heading, line: c.line, snippet: c.text.split('\n').slice(1).join(' ').slice(0, 280), vec: vecs[i] })),
      });
      done++;
      onProgress?.(done, stale.length);
    }
    if (stale.length || removed) await this.save();
    return { embedded: done, removed };
  }

  async search(query: string, k = 10): Promise<SemanticHit[]> {
    await this.load();
    const [q] = await this.embedder.embed([query]);
    const best = new Map<string, SemanticHit>();
    for (const [path, n] of this.notes) {
      for (const c of n.chunks) {
        const score = dot(q, c.vec);
        const cur = best.get(path);
        if (!cur || score > cur.score) {
          best.set(path, { path, title: this.hive.note(path)?.title ?? path, heading: c.heading, line: c.line, score, snippet: c.snippet });
        }
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Chunks most similar to the query, for retrieval-augmented answers. */
  async topChunks(query: string, k = 8): Promise<SemanticHit[]> {
    await this.load();
    const [q] = await this.embedder.embed([query]);
    const all: SemanticHit[] = [];
    for (const [path, n] of this.notes) {
      for (const c of n.chunks) all.push({ path, title: this.hive.note(path)?.title ?? path, heading: c.heading, line: c.line, score: dot(q, c.vec), snippet: c.snippet });
    }
    return all.sort((a, b) => b.score - a.score).slice(0, k);
  }

  private centroid(path: string): Float32Array | null {
    const n = this.notes.get(path);
    if (!n?.chunks.length) return null;
    const v = new Float32Array(n.chunks[0].vec.length);
    for (const c of n.chunks) for (let i = 0; i < v.length; i++) v[i] += c.vec[i];
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm);
  }

  /** Notes similar to `path`; `unlinkedOnly` drops notes already linked either way (link suggestions). */
  async related(path: string, k = 8, unlinkedOnly = false): Promise<SemanticHit[]> {
    await this.load();
    const c = this.centroid(path);
    if (!c) return [];
    const linked = new Set<string>();
    if (unlinkedOnly) {
      for (const o of this.hive.outgoing(path)) if (o.target) linked.add(o.target);
      for (const b of this.hive.backlinks(path)) linked.add(b.source);
    }
    const out: SemanticHit[] = [];
    for (const p of this.notes.keys()) {
      if (p === path || linked.has(p)) continue;
      const other = this.centroid(p);
      if (!other) continue;
      const n = this.notes.get(p)!;
      out.push({ path: p, title: this.hive.note(p)?.title ?? p, heading: '', line: 0, score: dot(c, other), snippet: n.chunks[0]?.snippet ?? '' });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
