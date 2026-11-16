import { posix } from './path';

export const NOTE_EXTS = new Set(['md', 'markdown']);
export const CANVAS_EXT = 'canvas';

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function basenameOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function isNote(path: string): boolean {
  return NOTE_EXTS.has(extOf(path));
}

function stripMd(p: string): string {
  return p.replace(/\.(md|markdown)$/i, '');
}

/**
 * Resolves link text to files in a hive, following the shortest-path convention:
 * a bare name matches by basename anywhere; names with `/` are paths.
 */
export class LinkResolver {
  private byBase = new Map<string, string[]>();
  private byAlias = new Map<string, string[]>();
  private all = new Set<string>();
  private lower = new Map<string, string>();

  constructor(paths: Iterable<string> = [], aliases: Iterable<[string, string[]]> = []) {
    for (const p of paths) this.add(p);
    for (const [p, list] of aliases) this.setAliases(p, list);
  }

  add(path: string): void {
    if (this.all.has(path)) return;
    this.all.add(path);
    this.lower.set(path.toLowerCase(), path);
    const key = (isNote(path) ? basenameOf(path) : path.slice(path.lastIndexOf('/') + 1)).toLowerCase();
    const list = this.byBase.get(key) ?? [];
    list.push(path);
    this.byBase.set(key, list);
  }

  remove(path: string): void {
    if (!this.all.delete(path)) return;
    this.lower.delete(path.toLowerCase());
    const key = (isNote(path) ? basenameOf(path) : path.slice(path.lastIndexOf('/') + 1)).toLowerCase();
    const list = (this.byBase.get(key) ?? []).filter((p) => p !== path);
    if (list.length) this.byBase.set(key, list);
    else this.byBase.delete(key);
    this.setAliases(path, []);
  }

  private aliasOwners = new Map<string, string[]>();

  setAliases(path: string, aliases: string[]): void {
    for (const a of this.aliasOwners.get(path) ?? []) {
      const list = (this.byAlias.get(a) ?? []).filter((p) => p !== path);
      if (list.length) this.byAlias.set(a, list);
      else this.byAlias.delete(a);
    }
    const keys = aliases.map((a) => a.toLowerCase());
    this.aliasOwners.set(path, keys);
    for (const k of keys) this.byAlias.set(k, [...(this.byAlias.get(k) ?? []), path]);
  }

  has(path: string): boolean {
    return this.all.has(path);
  }

  paths(): string[] {
    return [...this.all];
  }

  /** Returns the hive-relative path the link points at, or null if unresolved. */
  resolve(target: string, sourcePath = ''): string | null {
    if (!target) return sourcePath || null; // [[#Heading]] = same note
    let t = target.trim().replace(/\\/g, '/');
    try {
      t = decodeURI(t);
    } catch {
      /* ignore */
    }
    if (t.startsWith('/')) t = t.slice(1);
    const sourceDir = dirOf(sourcePath);

    const tryPath = (p: string): string | null => {
      const norm = posix.normalize(p);
      if (norm.startsWith('..')) return null;
      for (const cand of [norm, `${norm}.md`]) {
        if (this.all.has(cand)) return cand;
        const ci = this.lower.get(cand.toLowerCase());
        if (ci) return ci;
      }
      return null;
    };

    if (t.includes('/') || t.startsWith('.')) {
      // Relative to the source note first when it looks relative, then from the hive root.
      if (t.startsWith('./') || t.startsWith('../')) {
        const r = tryPath(posix.join(sourceDir, t));
        if (r) return r;
      }
      const fromRoot = tryPath(t);
      if (fromRoot) return fromRoot;
      const rel = tryPath(posix.join(sourceDir, t));
      if (rel) return rel;
      // A partial path suffix, e.g. [[sub/Note]] when the file is a/sub/Note.md.
      const suffix = stripMd(t).toLowerCase();
      const hits = [...this.all].filter((p) => {
        const lp = (isNote(p) ? stripMd(p) : p).toLowerCase();
        return lp === suffix || lp.endsWith('/' + suffix);
      });
      return this.pick(hits, target, sourceDir);
    }

    const key = (extOf(t) && !NOTE_EXTS.has(extOf(t)) ? t : stripMd(t)).toLowerCase();
    const hits = this.byBase.get(key);
    if (hits?.length) return this.pick(hits, t, sourceDir);
    const aliasHits = this.byAlias.get(t.toLowerCase());
    if (aliasHits?.length) return this.pick(aliasHits, t, sourceDir);
    return null;
  }

  private pick(hits: string[], target: string, sourceDir: string): string | null {
    if (!hits.length) return null;
    if (hits.length === 1) return hits[0];
    const exact = hits.filter((h) => basenameOf(h) === basenameOf(target));
    const pool = exact.length ? exact : hits;
    const score = (p: string) => {
      const d = dirOf(p);
      if (d === sourceDir) return -1000;
      return p.split('/').length * 10 + p.length / 1000;
    };
    return [...pool].sort((a, b) => score(a) - score(b))[0];
  }

  /**
   * The shortest link text that resolves to `targetPath` from `sourcePath`:
   * the basename when it's unique, otherwise the full path without `.md`.
   */
  linktextFor(targetPath: string, sourcePath = ''): string {
    const base = isNote(targetPath) ? basenameOf(targetPath) : targetPath.slice(targetPath.lastIndexOf('/') + 1);
    if (this.resolve(base, sourcePath) === targetPath && (this.byBase.get(base.toLowerCase())?.length ?? 0) <= 1) return base;
    return isNote(targetPath) ? stripMd(targetPath) : targetPath;
  }
}
