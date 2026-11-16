import { describe, expect, it } from 'vitest';
import { parseNote } from '../src/parse';
import { search, parseQuery } from '../src/search';
import { fuzzyFilter } from '../src/fuzzy';

const mk = (path: string, text: string) => ({ path, title: path.replace(/\.md$/, '').split('/').pop()!, text, meta: parseNote(text) });
const docs = [
  mk('Projects/Alpha.md', '---\nstatus: active\nrating: 4\ntags: [project]\n---\n# Plan\nship the engine\n- [ ] write tests\n- [x] design'),
  mk('Projects/Beta.md', '---\nstatus: done\nrating: 2\n---\n# Notes\nengine idea\n## Later\nmeeting notes #meeting/weekly'),
  mk('Journal.md', 'Nothing about engines here. Just a meeting.'),
];
const paths = (q: string) => search(docs, q).map((r) => r.path).sort();

describe('search query language', () => {
  it('matches terms, phrases, negation and OR', () => {
    expect(paths('engine')).toEqual(['Journal.md', 'Projects/Alpha.md', 'Projects/Beta.md']);
    expect(paths('"ship the engine"')).toEqual(['Projects/Alpha.md']);
    expect(paths('engine -meeting')).toEqual(['Projects/Alpha.md']);
    expect(paths('design OR idea')).toEqual(['Projects/Alpha.md', 'Projects/Beta.md']);
  });
  it('supports file, path, tag and regex operators', () => {
    expect(paths('file:alpha')).toEqual(['Projects/Alpha.md']);
    expect(paths('path:Projects')).toEqual(['Projects/Alpha.md', 'Projects/Beta.md']);
    expect(paths('tag:#meeting')).toEqual(['Projects/Beta.md']);
    expect(paths('/engines?/')).toEqual(['Journal.md', 'Projects/Alpha.md', 'Projects/Beta.md']);
  });
  it('scopes to lines, sections and tasks', () => {
    expect(paths('line:(engine idea)')).toEqual(['Projects/Beta.md']);
    expect(paths('section:(Later meeting)')).toEqual(['Projects/Beta.md']);
    expect(paths('task-todo:tests')).toEqual(['Projects/Alpha.md']);
    expect(paths('task-done:tests')).toEqual([]);
  });
  it('filters by properties', () => {
    expect(paths('[status:active]')).toEqual(['Projects/Alpha.md']);
    expect(paths('[rating:>3]')).toEqual(['Projects/Alpha.md']);
    expect(paths('[status]')).toEqual(['Projects/Alpha.md', 'Projects/Beta.md']);
  });
  it('returns highlighted line matches', () => {
    const [r] = search(docs, 'ship');
    expect(r.matches[0]).toEqual({ line: 6, text: 'ship the engine', ranges: [[0, 4]] });
  });
  it('parses nested groups', () => {
    expect(parseQuery('(a OR b) -c').t).toBe('and');
  });
});

describe('fuzzy', () => {
  it('ranks prefix and word-start matches first', () => {
    const items = ['Basalt launch', 'Linking notes', 'Welcome', 'Ballast'];
    expect(fuzzyFilter('bl', items, (s) => s).map((h) => h.item)[0]).toBe('Basalt launch');
    expect(fuzzyFilter('ln', items, (s) => s).map((h) => h.item)).toContain('Linking notes');
    expect(fuzzyFilter('zzz', items, (s) => s)).toEqual([]);
  });
});
