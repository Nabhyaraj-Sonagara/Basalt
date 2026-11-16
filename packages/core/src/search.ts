import type { NoteMeta, SearchMatch, SearchResult } from './types';

/**
 * Search query language (compatible with the common Markdown-notes conventions):
 *   word  "exact phrase"  /regex/  -exclude  a OR b  (grouping)
 *   file:  path:  content:  tag:#t  line:(…)  block:(…)  section:(…)
 *   task:  task-todo:  task-done:  match-case:  ignore-case:
 *   [property]  [property:value]  [rating:>3]
 */
export type QueryNode =
  | { t: 'term'; v: string; phrase?: boolean }
  | { t: 'regex'; re: RegExp }
  | { t: 'and'; items: QueryNode[] }
  | { t: 'or'; items: QueryNode[] }
  | { t: 'not'; item: QueryNode }
  | { t: 'op'; op: string; arg: QueryNode }
  | { t: 'prop'; name: string; value?: QueryNode; cmp?: { op: string; n: number } }
  | { t: 'all' };

const OPS = new Set([
  'file', 'path', 'content', 'tag', 'line', 'block', 'section', 'task', 'task-todo', 'task-done', 'match-case', 'ignore-case',
]);

type Tok =
  | { k: 'word'; v: string }
  | { k: 'phrase'; v: string }
  | { k: 'regex'; v: RegExp }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'neg' }
  | { k: 'or' }
  | { k: 'op'; v: string }
  | { k: 'prop'; name: string; value?: string };

function tokenize(q: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      toks.push({ k: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ k: 'rp' });
      i++;
      continue;
    }
    if (c === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])) {
      toks.push({ k: 'neg' });
      i++;
      continue;
    }
    if (c === '"') {
      const end = q.indexOf('"', i + 1);
      const v = end < 0 ? q.slice(i + 1) : q.slice(i + 1, end);
      toks.push({ k: 'phrase', v });
      i = end < 0 ? q.length : end + 1;
      continue;
    }
    if (c === '/') {
      let j = i + 1;
      while (j < q.length && q[j] !== '/') j += q[j] === '\\' ? 2 : 1;
      if (j < q.length) {
        const flags = /^[a-z]*/.exec(q.slice(j + 1))?.[0] ?? '';
        try {
          toks.push({ k: 'regex', v: new RegExp(q.slice(i + 1, j), flags.includes('i') ? 'i' : '') });
          i = j + 1 + flags.length;
          continue;
        } catch {
          /* fall through: treat as a word */
        }
      }
    }
    if (c === '[') {
      const end = q.indexOf(']', i + 1);
      if (end > 0) {
        const inner = q.slice(i + 1, end);
        const colon = inner.indexOf(':');
        toks.push(colon < 0 ? { k: 'prop', name: inner.trim() } : { k: 'prop', name: inner.slice(0, colon).trim(), value: inner.slice(colon + 1).trim() });
        i = end + 1;
        continue;
      }
    }
    let j = i;
    while (j < q.length && !/[\s()"]/.test(q[j])) {
      if (q[j] === ':' && OPS.has(q.slice(i, j).toLowerCase())) break;
      j++;
    }
    const word = q.slice(i, j);
    if (q[j] === ':' && OPS.has(word.toLowerCase())) {
      toks.push({ k: 'op', v: word.toLowerCase() });
      i = j + 1;
      continue;
    }
    if (word === 'OR') toks.push({ k: 'or' });
    else toks.push({ k: 'word', v: word });
    i = j;
  }
  return toks;
}

export function parseQuery(q: string): QueryNode {
  const toks = tokenize(q);
  let p = 0;
  const peek = () => toks[p];

  function parseOr(): QueryNode {
    const items = [parseAnd()];
    while (peek()?.k === 'or') {
      p++;
      items.push(parseAnd());
    }
    return items.length === 1 ? items[0] : { t: 'or', items };
  }
  function parseAnd(): QueryNode {
    const items: QueryNode[] = [];
    while (p < toks.length && peek().k !== 'rp' && peek().k !== 'or') items.push(parseUnary());
    if (!items.length) return { t: 'all' };
    return items.length === 1 ? items[0] : { t: 'and', items };
  }
  function parseUnary(): QueryNode {
    if (peek()?.k === 'neg') {
      p++;
      return { t: 'not', item: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary(): QueryNode {
    const tok = toks[p++];
    switch (tok.k) {
      case 'lp': {
        const n = parseOr();
        if (peek()?.k === 'rp') p++;
        return n;
      }
      case 'word':
        return { t: 'term', v: tok.v };
      case 'phrase':
        return { t: 'term', v: tok.v, phrase: true };
      case 'regex':
        return { t: 'regex', re: tok.v };
      case 'op': {
        if (p >= toks.length || peek().k === 'rp' || peek().k === 'or') return { t: 'op', op: tok.v, arg: { t: 'all' } };
        return { t: 'op', op: tok.v, arg: parsePrimary() };
      }
      case 'prop': {
        if (tok.value == null || tok.value === '') return { t: 'prop', name: tok.name };
        const cmp = /^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/.exec(tok.value);
        if (cmp) return { t: 'prop', name: tok.name, cmp: { op: cmp[1], n: Number(cmp[2]) } };
        return { t: 'prop', name: tok.name, value: parseQuery(tok.value) };
      }
      default:
        return { t: 'all' };
    }
  }
  return parseOr();
}

export interface SearchDoc {
  path: string;
  title: string;
  text: string;
  meta: NoteMeta;
}

interface Ctx {
  doc: SearchDoc;
  scope: string;
  cs: boolean;
  /** When true, plain terms may also match the file name. */
  top: boolean;
}

function includes(hay: string, needle: string, cs: boolean): boolean {
  return cs ? hay.includes(needle) : hay.toLowerCase().includes(needle.toLowerCase());
}

function evalNode(n: QueryNode, c: Ctx): boolean {
  switch (n.t) {
    case 'all':
      return true;
    case 'term':
      return includes(c.scope, n.v, c.cs) || (c.top && includes(c.doc.path, n.v, c.cs));
    case 'regex':
      return n.re.test(c.scope);
    case 'and':
      return n.items.every((i) => evalNode(i, c));
    case 'or':
      return n.items.some((i) => evalNode(i, c));
    case 'not':
      return !evalNode(n.item, c);
    case 'prop':
      return evalProp(n, c);
    case 'op':
      return evalOp(n.op, n.arg, c);
  }
}

function evalProp(n: Extract<QueryNode, { t: 'prop' }>, c: Ctx): boolean {
  const fm = c.doc.meta.frontmatter;
  const key = Object.keys(fm).find((k) => k.toLowerCase() === n.name.toLowerCase());
  if (key == null) return false;
  const v = fm[key];
  if (n.cmp) {
    const num = Number(v);
    if (Number.isNaN(num)) return false;
    const { op, n: x } = n.cmp;
    return op === '>' ? num > x : op === '<' ? num < x : op === '>=' ? num >= x : op === '<=' ? num <= x : num === x;
  }
  if (!n.value) return true;
  const values = Array.isArray(v) ? v.map(String) : [v == null ? 'null' : String(v)];
  return values.some((s) => evalNode(n.value!, { ...c, scope: s, top: false }));
}

function evalOp(op: string, arg: QueryNode, c: Ctx): boolean {
  const sub = (scope: string, extra: Partial<Ctx> = {}) => evalNode(arg, { ...c, scope, top: false, ...extra });
  const { doc } = c;
  switch (op) {
    case 'file':
      return sub(doc.path.slice(doc.path.lastIndexOf('/') + 1));
    case 'path':
      return sub(doc.path);
    case 'content':
      return sub(doc.text);
    case 'match-case':
      return evalNode(arg, { ...c, cs: true });
    case 'ignore-case':
      return evalNode(arg, { ...c, cs: false });
    case 'tag': {
      const want = (arg.t === 'term' ? arg.v : '').replace(/^#/, '').toLowerCase();
      if (!want) return doc.meta.tags.length > 0;
      return doc.meta.tags.some((t) => {
        const lt = t.toLowerCase();
        return lt === want || lt.startsWith(want + '/');
      });
    }
    case 'line':
      return doc.text.split('\n').some((l) => sub(l));
    case 'block':
      return doc.text.split(/\n\s*\n/).some((b) => sub(b));
    case 'section': {
      const lines = doc.text.split('\n');
      return doc.meta.sections.some((s) => sub(lines.slice(s.startLine, s.endLine + 1).join('\n')));
    }
    case 'task':
      return doc.meta.tasks.some((t) => sub(t.text));
    case 'task-todo':
      return doc.meta.tasks.some((t) => !t.done && t.status !== '-' && sub(t.text));
    case 'task-done':
      return doc.meta.tasks.some((t) => t.done && sub(t.text));
    default:
      return false;
  }
}

/** Positive literal terms and regexes, used for highlighting matched lines. */
function highlighters(n: QueryNode, neg = false, out: { s?: string; re?: RegExp }[] = []): { s?: string; re?: RegExp }[] {
  switch (n.t) {
    case 'term':
      if (!neg && n.v) out.push({ s: n.v });
      break;
    case 'regex':
      if (!neg) out.push({ re: n.re });
      break;
    case 'and':
    case 'or':
      n.items.forEach((i) => highlighters(i, neg, out));
      break;
    case 'not':
      highlighters(n.item, !neg, out);
      break;
    case 'op':
      if (!['file', 'path', 'tag'].includes(n.op)) highlighters(n.arg, neg, out);
      break;
  }
  return out;
}

function lineMatches(text: string, hl: { s?: string; re?: RegExp }[], limit: number): SearchMatch[] {
  if (!hl.length) return [];
  const out: SearchMatch[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i];
    const ranges: [number, number][] = [];
    const lower = line.toLowerCase();
    for (const h of hl) {
      if (h.s) {
        const needle = h.s.toLowerCase();
        for (let from = 0, at; (at = lower.indexOf(needle, from)) >= 0; from = at + needle.length) ranges.push([at, at + needle.length]);
      } else if (h.re) {
        const g = new RegExp(h.re.source, h.re.flags.includes('g') ? h.re.flags : h.re.flags + 'g');
        for (let m; (m = g.exec(line)) && m[0].length; ) ranges.push([m.index, m.index + m[0].length]);
      }
    }
    if (ranges.length) out.push({ line: i, text: line, ranges: ranges.sort((a, b) => a[0] - b[0]) });
  }
  return out;
}

/** True when the document matches a parsed query. */
export function matchesQuery(doc: SearchDoc, ast: QueryNode): boolean {
  return evalNode(ast, { doc, scope: doc.text, cs: false, top: true });
}

export interface SearchOptions {
  limit?: number;
  matchesPerFile?: number;
}

export function search(docs: Iterable<SearchDoc>, query: string, opts: SearchOptions = {}): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const ast = parseQuery(q);
  const hl = highlighters(ast);
  const results: SearchResult[] = [];
  for (const doc of docs) {
    if (!evalNode(ast, { doc, scope: doc.text, cs: false, top: true })) continue;
    const matches = lineMatches(doc.text, hl, opts.matchesPerFile ?? 20);
    const titleHit = hl.some((h) => (h.s ? doc.title.toLowerCase().includes(h.s.toLowerCase()) : h.re?.test(doc.title)));
    const score = matches.reduce((s, m) => s + m.ranges.length, 0) + (titleHit ? 10 : 0);
    results.push({ path: doc.path, title: doc.title, score, matches });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return opts.limit ? results.slice(0, opts.limit) : results;
}
