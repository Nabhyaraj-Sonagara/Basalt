import type { Embedder } from './types';
import { normalize } from './providers/openai';

const STOP = new Set(
  'a an and are as at be but by for from has have i in is it its of on or that the this to was were will with you your we they he she not no do does did can could would should'.split(' '),
);

/** FNV-1a 32-bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stem(w: string): string {
  return w.replace(/(ingly|edly|ing|ed|ies|es|s|ly)$/u, (m) => (m === 'ies' ? 'y' : '')).slice(0, 12) || w;
}

/**
 * Offline embedder that needs no model download: hashed bag of stemmed words, word bigrams
 * and character trigrams with log term frequency, signed feature hashing and L2 normalisation.
 * Lexical rather than truly semantic, but it finds related notes with zero setup; any
 * provider's embedding model can replace it in Settings.
 */
export class HashedEmbedder implements Embedder {
  readonly id = 'builtin:hashed-v1';
  constructor(readonly dims = 512) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): Float32Array {
    const v = new Float32Array(this.dims);
    const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
    const counts = new Map<string, number>();
    const add = (f: string, w: number) => counts.set(f, (counts.get(f) ?? 0) + w);
    words.forEach((w, i) => {
      add(`w:${w}`, 1);
      if (i > 0) add(`b:${words[i - 1]}_${w}`, 0.5);
      const padded = `^${w}$`;
      for (let j = 0; j + 3 <= padded.length; j++) add(`c:${padded.slice(j, j + 3)}`, 0.25);
    });
    for (const [f, c] of counts) {
      const h = hash(f);
      const sign = h & 1 ? 1 : -1;
      v[(h >>> 1) % this.dims] += sign * (1 + Math.log(c));
    }
    return normalize(v);
  }
}
