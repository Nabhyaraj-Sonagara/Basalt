export interface FuzzyHit<T> {
  item: T;
  score: number;
  /** Indices in the matched string. */
  indices: number[];
}

/**
 * Subsequence fuzzy match with bonuses for word starts, consecutive runs and
 * prefix matches. Returns null when not every query character is found in order.
 */
export function fuzzyScore(query: string, target: string): { score: number; indices: number[] } | null {
  const a = scorePass(query, target, false);
  if (!a) return null;
  const b = scorePass(query, target, true);
  return b && b.score > a.score ? b : a;
}

const isBoundary = (target: string, t: string, at: number) =>
  at === 0 || /[\s/_\-.]/.test(t[at - 1]) || (target[at] !== t[at] && target[at - 1] === t[at - 1]);

function scorePass(query: string, target: string, preferWordStarts: boolean): { score: number; indices: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, indices: [] };
  const t = target.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    let at = t.indexOf(ch, ti);
    if (at < 0) return null;
    if (preferWordStarts && at !== prev + 1) {
      for (let k = at; k >= 0; k = t.indexOf(ch, k + 1)) {
        if (isBoundary(target, t, k)) {
          at = k;
          break;
        }
      }
    }
    indices.push(at);
    let s = 1;
    if (at === prev + 1) s += 4;
    if (isBoundary(target, t, at)) s += 3;
    score += s;
    prev = at;
    ti = at + 1;
  }
  if (t.startsWith(q)) score += 8;
  if (t.includes(q)) score += 6;
  score -= (target.length - q.length) * 0.02;
  return { score, indices };
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string | string[], limit = 50): FuzzyHit<T>[] {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, score: 0, indices: [] }));
  const hits: FuzzyHit<T>[] = [];
  for (const item of items) {
    const keys = ([] as string[]).concat(key(item));
    let best: { score: number; indices: number[] } | null = null;
    keys.forEach((k, i) => {
      const r = fuzzyScore(query, k);
      if (r && (!best || r.score - i > best.score)) best = { score: r.score - i, indices: i === 0 ? r.indices : [] };
    });
    if (best) hits.push({ item, ...(best as { score: number; indices: number[] }) });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
