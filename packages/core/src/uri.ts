// basalt:// links: open a note, create one, open today's daily note, or search, in a named hive.

export type UriAction = 'open' | 'new' | 'daily' | 'search';

export interface BasaltUri {
  action: UriAction;
  /** Hive name or absolute path; null means the open (or last) hive. */
  hive: string | null;
  /** For `open`: a path or link text (`Projects/Plan`, `Plan.md`, `Plan#Heading`). */
  file?: string;
  /** For `new`: the note name. */
  name?: string;
  /** For `new`: the note body. */
  content?: string;
  /** For `search`. */
  query?: string;
}

const ACTIONS: UriAction[] = ['open', 'new', 'daily', 'search'];
const MAX = 100_000;

/** Parses `basalt://open?hive=Notes&file=Plan`. Returns null for anything that isn't a valid Basalt link. */
export function parseBasaltUri(url: string): BasaltUri | null {
  if (typeof url !== 'string' || url.length > MAX) return null;
  const m = /^basalt:(?:\/\/)?([a-z]+)\/?(?:\?([^#]*))?$/i.exec(url.trim());
  if (!m) return null;
  const action = m[1].toLowerCase() as UriAction;
  if (!ACTIONS.includes(action)) return null;
  const q = new URLSearchParams(m[2] ?? '');
  const get = (k: string) => {
    const v = q.get(k);
    return v == null || v === '' ? undefined : v;
  };
  const out: BasaltUri = { action, hive: get('hive') ?? get('vault') ?? null };
  if (action === 'open') {
    out.file = get('file') ?? get('path');
    if (!out.file) return null;
  }
  if (action === 'new') {
    out.name = get('name') ?? get('file');
    out.content = get('content');
  }
  if (action === 'search') out.query = get('query') ?? '';
  return out;
}

/** Builds a basalt:// link. Spaces encode as %20 so links survive copy and paste. */
export function buildBasaltUri(action: UriAction, params: Record<string, string | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');
  return `basalt://${action}${qs ? '?' + qs : ''}`;
}
