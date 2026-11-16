import type { Hive } from '@basalt/core';
import { createEmbedder, providersFromEnv, SemanticIndex, type ProviderConfig } from '@basalt/ai';

/** Accepts a path (`Projects/Plan.md`) or link text (`Plan`, `Projects/Plan`) and returns the hive path. */
export function resolveNote(hive: Hive, ref: string): string {
  const clean = ref.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
  if (hive.exists(clean)) return clean;
  const r = hive.resolve(clean);
  if (r) return r;
  throw new Error(`No note matches "${ref}". Try \`basalt list\` or a search.`);
}

/** Where a new note should go: keeps folders, adds `.md`. */
export function newNotePath(ref: string): string {
  const clean = ref.replace(/^\[\[|\]\]$/g, '').trim();
  return /\.[a-z0-9]+$/i.test(clean) ? clean : `${clean}.md`;
}

/** The embedding provider for semantic search: BASALT_EMBEDDINGS=<provider id>, else the built-in offline embedder. */
export function embeddingProvider(env = process.env): ProviderConfig | null {
  const want = env.BASALT_EMBEDDINGS;
  if (!want || want === 'builtin') return null;
  return providersFromEnv(env).find((p) => p.id === want && p.embeddingModel) ?? null;
}

export async function semanticIndex(hive: Hive): Promise<SemanticIndex> {
  const idx = new SemanticIndex(hive, createEmbedder(embeddingProvider()));
  await idx.update();
  return idx;
}
