import { parseDocument, stringify } from 'yaml';
import { splitFrontmatter } from './parse';
import { matchesQuery, parseQuery, type SearchDoc } from './search';
import type { NoteRecord } from './types';

export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime' | 'tags' | 'aliases';

export function inferType(name: string, value: unknown): PropertyType {
  const n = name.toLowerCase();
  if (n === 'tags' || n === 'tag') return 'tags';
  if (n === 'aliases' || n === 'alias') return 'aliases';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'datetime';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime';
  }
  return 'text';
}

export interface PropertyInfo {
  name: string;
  type: PropertyType;
  count: number;
}

export function propertyCatalog(notes: Iterable<NoteRecord>, overrides: Record<string, PropertyType> = {}): PropertyInfo[] {
  const map = new Map<string, { types: Map<PropertyType, number>; count: number }>();
  for (const note of notes) {
    for (const [k, v] of Object.entries(note.frontmatter)) {
      const e = map.get(k) ?? { types: new Map(), count: 0 };
      const t = inferType(k, v);
      e.types.set(t, (e.types.get(t) ?? 0) + 1);
      e.count++;
      map.set(k, e);
    }
  }
  return [...map.entries()]
    .map(([name, e]) => ({
      name,
      count: e.count,
      type: overrides[name] ?? [...e.types.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Returns new file text with frontmatter keys set (or removed when value is undefined). Comments and order are kept. */
export function setFrontmatter(text: string, changes: Record<string, unknown>): string {
  const split = splitFrontmatter(text);
  const doc = parseDocument(split.yaml ?? '');
  if (doc.contents == null || typeof doc.contents !== 'object') doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) doc.delete(k);
    else doc.set(k, v);
  }
  const body = text.slice(split.bodyStart);
  const yamlText = doc.toString().trimEnd();
  if (!yamlText || yamlText === '{}') return split.yaml == null ? text : body.replace(/^\r?\n/, '');
  return `---\n${yamlText}\n---\n${body}`;
}

export function frontmatterToYaml(data: Record<string, unknown>): string {
  return stringify(data).trimEnd();
}

export interface NoteQuery {
  /** Filter in the search query language, e.g. `[status:active] tag:#project`. */
  where?: string;
  sort?: string;
  desc?: boolean;
  select?: string[];
  limit?: number;
}

export interface QueryRow {
  path: string;
  title: string;
  [prop: string]: unknown;
}

/** A table over notes and their properties (the engine behind table views). */
export function queryNotes(docs: SearchDoc[], q: NoteQuery): QueryRow[] {
  const ast = q.where?.trim() ? parseQuery(q.where) : null;
  let rows = docs.filter((d) => !ast || matchesQuery(d, ast));
  if (q.sort) {
    const key = q.sort;
    const val = (d: SearchDoc): unknown => (key === 'title' ? d.title : key === 'path' ? d.path : d.meta.frontmatter[key]);
    rows = [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return q.desc ? -c : c;
    });
  }
  if (q.limit) rows = rows.slice(0, q.limit);
  return rows.map((d) => {
    const row: QueryRow = { path: d.path, title: d.title };
    const cols = q.select ?? Object.keys(d.meta.frontmatter);
    for (const c of cols) row[c] = c === 'tags' ? d.meta.tags : d.meta.frontmatter[c];
    return row;
  });
}
