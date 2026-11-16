// A tiny POSIX path helper that works in both Node and the browser renderer.
function normalize(p: string): string {
  const abs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
    } else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/');
}

function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'));
}

export const posix = { normalize, join };

/** Validates a hive-relative path: no absolute paths, no `..` escapes, forward slashes. */
export function safeRelPath(p: string): string {
  const s = normalize(String(p).replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!s || s === '.' || s.startsWith('..') || s.split('/').includes('..')) {
    throw new Error(`Path is outside the hive: ${p}`);
  }
  return s;
}
