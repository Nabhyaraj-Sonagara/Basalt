import { describe, expect, it } from 'vitest';
import { LinkResolver } from '../src/resolve';
import { rewriteLinks } from '../src/rename';
import { safeRelPath } from '../src/path';

const paths = ['Welcome.md', 'a/Note.md', 'b/Note.md', 'b/Other.md', 'img/pic.png', 'Deep/x/Leaf.md'];

describe('LinkResolver', () => {
  const r = new LinkResolver(paths, [['b/Other.md', ['Alias One']]]);
  it('resolves by basename, path, alias and attachment name', () => {
    expect(r.resolve('welcome')).toBe('Welcome.md');
    expect(r.resolve('Leaf')).toBe('Deep/x/Leaf.md');
    expect(r.resolve('a/Note')).toBe('a/Note.md');
    expect(r.resolve('x/Leaf')).toBe('Deep/x/Leaf.md');
    expect(r.resolve('Alias One')).toBe('b/Other.md');
    expect(r.resolve('pic.png')).toBe('img/pic.png');
    expect(r.resolve('Missing')).toBeNull();
  });
  it('prefers the same folder when a basename is ambiguous', () => {
    expect(r.resolve('Note', 'b/Other.md')).toBe('b/Note.md');
    expect(r.resolve('Note', 'a/x.md')).toBe('a/Note.md');
  });
  it('gives the shortest unambiguous link text', () => {
    expect(r.linktextFor('Deep/x/Leaf.md')).toBe('Leaf');
    expect(r.linktextFor('a/Note.md')).toBe('a/Note');
  });
});

describe('rewriteLinks', () => {
  it('rewrites wiki and markdown links, keeping subpath and display', () => {
    const before = new LinkResolver(paths);
    const after = new LinkResolver(paths.map((p) => (p === 'Deep/x/Leaf.md' ? 'Deep/x/Branch.md' : p)));
    const moves = new Map([['Deep/x/Leaf.md', 'Deep/x/Branch.md']]);
    const text = 'A [[Leaf#H|shown]] B ![[Leaf]] C [m](Deep/x/Leaf.md#H) D [[Welcome]]';
    const res = rewriteLinks(text, 'Welcome.md', 'Welcome.md', moves, before, after);
    expect(res.text).toBe('A [[Branch#H|shown]] B ![[Branch]] C [m](Deep/x/Branch.md#H) D [[Welcome]]');
    expect(res.changed).toBe(3);
  });
});

describe('safeRelPath', () => {
  it('blocks escapes', () => {
    expect(safeRelPath('a/./b.md')).toBe('a/b.md');
    expect(() => safeRelPath('../etc/passwd')).toThrow();
    expect(() => safeRelPath('a/../../x')).toThrow();
    expect(safeRelPath('/abs/x.md')).toBe('abs/x.md');
  });
});
