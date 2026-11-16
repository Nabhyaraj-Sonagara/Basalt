import { parseNote } from './parse';
import type { LinkResolver } from './resolve';
import { dirOf } from './resolve';
import type { LinkRef } from './types';

function encodeHref(p: string): string {
  return p.split('/').map((s) => encodeURIComponent(s).replace(/%2F/g, '/')).join('/');
}

function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

export function formatLink(
  ref: Pick<LinkRef, 'kind' | 'embed' | 'subpath' | 'display' | 'raw'>,
  linktext: string,
  hrefPath: string,
): string {
  if (ref.kind === 'wiki') {
    const pipe = ref.raw.includes('\\|') ? '\\|' : '|';
    return `${ref.embed ? '!' : ''}[[${linktext}${ref.subpath ?? ''}${ref.display != null ? pipe + ref.display : ''}]]`;
  }
  const sub = ref.subpath ? encodeHref(ref.subpath.slice(1)).replace(/^/, '#') : '';
  return `${ref.embed ? '!' : ''}[${ref.display ?? ''}](${encodeHref(hrefPath)}${sub})`;
}

export interface RewriteResult {
  text: string;
  changed: number;
}

/**
 * Rewrites links in one note after files moved.
 * `moves` maps old path -> new path. `before` resolves links against the hive as it was,
 * `after` against the hive as it is now. `sourceOld`/`sourceNew` are this note's paths.
 */
export function rewriteLinks(
  text: string,
  sourceOld: string,
  sourceNew: string,
  moves: Map<string, string>,
  before: LinkResolver,
  after: LinkResolver,
): RewriteResult {
  const meta = parseNote(text);
  const refs = [...meta.links, ...meta.embeds].sort((a, b) => b.start - a.start);
  let out = text;
  let changed = 0;
  const sourceMoved = sourceOld !== sourceNew;
  for (const ref of refs) {
    if (!ref.target) continue; // same-note link
    const oldTarget = before.resolve(ref.target, sourceOld);
    if (!oldTarget) continue;
    const newTarget = moves.get(oldTarget) ?? oldTarget;
    const targetMoved = newTarget !== oldTarget;
    let replacement: string | null = null;
    if (ref.kind === 'wiki') {
      if (!targetMoved && after.resolve(ref.target, sourceNew) === newTarget) continue;
      replacement = formatLink(ref, after.linktextFor(newTarget, sourceNew), newTarget);
    } else {
      const wasRelative = !before.has(ref.target.replace(/^\//, '')) && !before.has(ref.target.replace(/^\//, '') + '.md');
      if (!targetMoved && !(sourceMoved && wasRelative)) continue;
      const href = wasRelative ? relativePath(dirOf(sourceNew), newTarget) : newTarget;
      replacement = formatLink(ref, '', href);
    }
    if (replacement !== ref.raw) {
      out = out.slice(0, ref.start) + replacement + out.slice(ref.end);
      changed++;
    }
  }
  return { text: out, changed };
}
