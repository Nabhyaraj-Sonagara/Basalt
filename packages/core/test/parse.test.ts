import { describe, expect, it } from 'vitest';
import { parseNote, parseLinktext, subpathText, maskNonContent } from '../src/parse';

describe('parseNote', () => {
  it('reads frontmatter, aliases and tags', () => {
    const m = parseNote('---\ntags: [a, "#b/c"]\naliases: Alt\ntitle: T\n---\nBody #inline and #b/c\n');
    expect(m.frontmatter.title).toBe('T');
    expect(m.aliases).toEqual(['Alt']);
    expect(m.tags).toEqual(['a', 'b/c', 'inline']);
    expect(m.inlineTags.map((t) => t.line)).toEqual([5, 5]);
  });

  it('finds wikilinks, embeds and markdown links with subpaths and display text', () => {
    const m = parseNote('See [[Note#Head|shown]] and ![[img.png|300]] and [md](Some%20Note.md#x) and [ext](https://a.b).');
    expect(m.links.map((l) => [l.target, l.subpath, l.display, l.kind])).toEqual([
      ['Note', '#Head', 'shown', 'wiki'],
      ['Some Note.md', '#x', 'md', 'markdown'],
    ]);
    expect(m.embeds.map((e) => [e.target, e.display])).toEqual([['img.png', '300']]);
  });

  it('ignores links and tags inside code, comments and math', () => {
    const m = parseNote('```\n[[NotALink]] #nottag\n```\n`[[inline]]` %%[[hidden]]%% $$#x$$ [[Real]] #real');
    expect(m.links.map((l) => l.target)).toEqual(['Real']);
    expect(m.tags).toEqual(['real']);
  });

  it('rejects numeric-only tags and heading markers', () => {
    const m = parseNote('# Heading\n#123 is not a tag, #y2026 is. Issue#5 is not.');
    expect(m.tags).toEqual(['y2026']);
    expect(m.headings).toEqual([expect.objectContaining({ level: 1, text: 'Heading', line: 0 })]);
  });

  it('parses tasks, block ids and sections', () => {
    const text = 'intro\n## A\n- [ ] todo ^b1\n- [x] done\n- [-] dropped\n## B\ntext';
    const m = parseNote(text);
    expect(m.tasks.map((t) => [t.status, t.done, t.text])).toEqual([
      [' ', false, 'todo ^b1'],
      ['x', true, 'done'],
      ['-', false, 'dropped'],
    ]);
    expect(m.blocks.map((b) => b.id)).toEqual(['b1']);
    expect(m.sections.map((s) => [s.heading, s.startLine, s.endLine])).toEqual([
      ['', 0, 0],
      ['A', 1, 4],
      ['B', 5, 6],
    ]);
  });

  it('keeps offsets aligned when masking', () => {
    const t = '---\na: 1\n---\n```js\nx\n```\nok';
    expect(maskNonContent(t, 13).length).toBe(t.length);
  });
});

describe('links and subpaths', () => {
  it('splits link text', () => {
    expect(parseLinktext('a/b#c#d|e')).toEqual({ target: 'a/b', subpath: '#c#d', display: 'e' });
    expect(parseLinktext('#Head')).toEqual({ target: '', subpath: '#Head', display: undefined });
    expect(parseLinktext('T\\|x')).toEqual({ target: 'T', subpath: undefined, display: 'x' });
  });

  it('extracts sections and blocks', () => {
    const text = '# A\none\n## B\ntwo\n# C\nthree ^blk';
    expect(subpathText(text, '#B')).toBe('## B\ntwo');
    expect(subpathText(text, '#A')).toBe('# A\none\n## B\ntwo');
    expect(subpathText(text, '#^blk')).toBe('three');
  });
});
