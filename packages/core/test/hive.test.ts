import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Hive } from '../src/hive';
import { parseCanvas, serializeCanvas } from '../src/canvas';
import { layoutGlobalComb, layoutLocalComb, hexRing } from '../src/comb';
import { renderMarkdown } from '../src/markdown';
import { applyTemplate } from '../src/templates';
import { setFrontmatter } from '../src/properties';

const FIXTURE = resolve(__dirname, '../../../fixtures/sample-hive');
let dir: string;
let hive: Hive;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'basalt-hive-'));
  cpSync(FIXTURE, dir, { recursive: true });
  hive = await Hive.open(dir);
});
afterEach(async () => {
  await hive.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Hive', () => {
  it('indexes notes, folders and attachments', () => {
    expect(hive.notes.size).toBe(6);
    expect(hive.exists('Projects')).toBe(true);
    expect(hive.exists('Attachments/causeway.svg')).toBe(true);
    const tree = hive.tree();
    expect(tree.children!.map((c) => c.name).slice(0, 5)).toEqual(['Attachments', 'Daily', 'People', 'Projects', 'Templates']);
  });

  it('computes backlinks including canvas cards', () => {
    const bl = hive.backlinks('Projects/Basalt launch.md').map((b) => b.source);
    expect(bl).toEqual(['Canvas map.canvas', 'Daily/2026-11-15.md', 'People/Ada.md', 'Welcome.md']);
    expect([...new Set(hive.backlinks('Linking notes.md').map((b) => b.source))]).toEqual(['Projects/Basalt launch.md', 'Welcome.md']);
  });

  it('finds unlinked mentions', () => {
    const m = hive.unlinkedMentions('Welcome.md');
    expect(m.map((x) => x.source)).toContain('Linking notes.md');
    expect(m.every((x) => !x.context.includes('[[Welcome'))).toBe(true);
  });

  it('counts nested tags', () => {
    const tags = Object.fromEntries(hive.tags().map((t) => [t.tag, t.count]));
    expect(tags.basalt).toBe(3);
    expect(tags.tags).toBe(1);
    expect(tags['tags/nested']).toBe(1);
    expect(tags.engineering).toBe(1);
  });

  it('merges a note into another and repoints links', async () => {
    const res = await hive.merge('People/Ada.md', 'Projects/Basalt launch.md');
    expect(hive.exists('People/Ada.md')).toBe(false);
    const target = await hive.read('Projects/Basalt launch.md');
    expect(target).toMatch(/## Ada\n/);
    expect(res.updated.length).toBeGreaterThan(0);
    for (const p of res.updated) expect(await hive.read(p)).not.toMatch(/\[\[(People\/)?Ada(\||\]|#)/);
    expect(hive.backlinks('Projects/Basalt launch.md').some((b) => b.source === 'Projects/Basalt launch.md')).toBe(false);
    await expect(hive.merge('Welcome.md', 'Welcome.md')).rejects.toThrow();
  });

  it('renames and rewrites links everywhere, including canvases', async () => {
    const res = await hive.rename('Projects/Basalt launch.md', 'Projects/Launch plan.md');
    expect(res.updated.sort()).toEqual(['Canvas map.canvas', 'Daily/2026-11-15.md', 'People/Ada.md', 'Welcome.md']);
    const welcome = readFileSync(join(dir, 'Welcome.md'), 'utf8');
    expect(welcome).toContain('[[Launch plan|launch plan]]');
    expect(readFileSync(join(dir, 'Daily/2026-11-15.md'), 'utf8')).toContain('[[Launch plan]]');
    expect(parseCanvas(readFileSync(join(dir, 'Canvas map.canvas'), 'utf8')).nodes[2]).toMatchObject({ file: 'Projects/Launch plan.md' });
    expect(hive.backlinks('Projects/Launch plan.md')).toHaveLength(4);
  });

  it('moves folders and keeps links resolving', async () => {
    await hive.rename('People', 'Team');
    expect(hive.exists('Team/Ada.md')).toBe(true);
    const launch = hive.text('Projects/Basalt launch.md')!;
    expect(launch).toContain('owner: "[[Ada]]"'.slice(0, 0) + '[[Ada|Ada]]'.replace('[[Ada|Ada]]', '[[Ada\\|Ada]]'));
    expect(hive.resolve('Ada', 'Projects/Basalt launch.md')).toBe('Team/Ada.md');
  });

  it('creates notes from templates, daily notes and unique names', async () => {
    const p = await hive.create('Standup', '', { template: 'Templates/Meeting.md' });
    expect(p).toBe('Standup.md');
    expect(hive.text(p)).toMatch(/^---\ndate: \d{4}-\d{2}-\d{2}\ntags: \[meeting\]\n---\n# Standup/);
    expect(await hive.create('Standup')).toBe('Standup 1.md');
    const d = await hive.dailyNote(new Date(2026, 10, 15));
    expect(d).toEqual({ path: 'Daily/2026-11-15.md', created: false });
    const d2 = await hive.dailyNote(new Date(2026, 10, 16));
    expect(d2.created).toBe(true);
  });

  it('toggles tasks, sets properties, trashes and snapshots', async () => {
    expect(await hive.toggleTask('Welcome.md', 16)).toBe(true);
    expect(hive.text('Welcome.md')).toContain('- [x] Open the comb view');
    expect((await hive.snapshots('Welcome.md')).length).toBe(1);
    await hive.setProperties('Linking notes.md', { status: 'seedling', rating: undefined });
    expect(hive.note('Linking notes.md')!.frontmatter).toEqual({ tags: ['basalt'], status: 'seedling' });
    await hive.trash('Daily/2026-11-15.md');
    expect(hive.exists('Daily/2026-11-15.md')).toBe(false);
    expect(existsSync(join(dir, 'Daily/2026-11-15.md'))).toBe(false);
  });

  it('runs search and property queries', () => {
    expect(hive.search('tag:#project').map((r) => r.path)).toEqual(['Projects/Basalt launch.md']);
    const rows = hive.query({ where: '[status]', sort: 'status', select: ['status'] });
    expect(rows).toEqual([
      { path: 'Projects/Basalt launch.md', title: 'Basalt launch', status: 'active' },
      { path: 'Linking notes.md', title: 'Linking notes', status: 'evergreen' },
    ]);
    expect(hive.properties().find((p) => p.name === 'due')?.type).toBe('date');
  });

  it('refuses paths outside the hive', async () => {
    await expect(hive.write('../escape.md', 'x')).rejects.toThrow(/outside/);
  });

  it('builds a graph and comb layouts', () => {
    const g = hive.graph({ includeUnresolved: true });
    expect(g.nodes.find((n) => n.id === 'unresolved:Ideas')).toBeTruthy();
    const local = layoutLocalComb(g, 'Welcome.md');
    expect(local[0]).toMatchObject({ id: 'Welcome.md', q: 0, r: 0, weight: 3 });
    const cells = new Set(local.map((c) => `${c.q},${c.r}`));
    expect(cells.size).toBe(local.length);
    const global = layoutGlobalComb(g);
    expect(new Set(global.map((c) => `${c.q},${c.r}`)).size).toBe(g.nodes.length);
    expect(hexRing(0, 0, 2)).toHaveLength(12);
  });
});

describe('rendering and helpers', () => {
  it('renders Basalt markdown', () => {
    const html = renderMarkdown('---\na: 1\n---\n> [!warning] Careful\n> body\n\n- [ ] task\n\n==hi== #tag [[Note|x]] ![[pic.png|100]] %%secret%% para ^id1', {
      resolve: (t) => (t === 'Note' ? 'Note.md' : t === 'pic.png' ? 'pic.png' : null),
      fileUrl: (p) => `basalt-file://hive/${p}`,
    });
    expect(html).toContain('bs-callout bs-callout-warning');
    expect(html).toContain('<span>Careful</span>');
    expect(html).toContain('class="task-item"');
    expect(html).toContain('<mark>hi</mark>');
    expect(html).toContain('data-tag="tag"');
    expect(html).toContain('data-path="Note.md"');
    expect(html).toContain('<img class="bs-embed-img" src="basalt-file://hive/pic.png" alt="pic.png" width="100">');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('para ^id1');
    expect(html).toContain('id="^id1"');
  });

  it('renders unresolved links and callout folding', () => {
    const html = renderMarkdown('[[Nope]]\n\n> [!faq]- Why?\n> Because.', { resolve: () => null });
    expect(html).toContain('bs-link-unresolved');
    expect(html).toContain('<details class="bs-callout bs-callout-info"');
  });

  it('applies templates', () => {
    const out = applyTemplate('{{title}} {{date:YYYY}} {{yesterday}}', { title: 'T', date: new Date(2026, 0, 1) });
    expect(out).toBe('T 2026 2025-12-31');
  });

  it('round-trips canvases and keeps unknown fields', () => {
    const c = parseCanvas('{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":1,"height":1,"custom":true}],"edges":[{"id":"e","fromNode":"a","toNode":"missing"}],"extra":1}');
    expect(c.edges).toHaveLength(0);
    expect(JSON.parse(serializeCanvas(c))).toMatchObject({ extra: 1, nodes: [{ custom: true }] });
  });

  it('edits frontmatter in place', () => {
    expect(setFrontmatter('# Hi', { a: 1 })).toBe('---\na: 1\n---\n# Hi');
    expect(setFrontmatter('---\n# keep\na: 1\n---\nbody', { b: [1, 2] })).toBe('---\n# keep\na: 1\nb:\n  - 1\n  - 2\n---\nbody');
    expect(setFrontmatter('---\na: 1\n---\nbody', { a: undefined })).toBe('body');
  });
});
