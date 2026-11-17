import { describe, expect, it } from 'vitest';
import { layoutMindmap, outlineFromNote, parseMindmap, serializeMindmap, mindNode } from '../src/mindmap';

const NOTE = `---
tags: [plan]
view: mindmap
---
# Launch

- Product
  - Editor
  - [[Sync]]
- Marketing
  - Site
`;

describe('mind maps', () => {
  it('parses a mind-map note into a tree', () => {
    const t = parseMindmap(NOTE, 'fallback');
    expect(t.text).toBe('Launch');
    expect(t.children.map((c) => c.text)).toEqual(['Product', 'Marketing']);
    expect(t.children[0].children.map((c) => c.text)).toEqual(['Editor', '[[Sync]]']);
  });

  it('round-trips, keeping frontmatter', () => {
    const t = parseMindmap(NOTE, 'x');
    t.children[1].children.push(mindNode('Launch post'));
    const out = serializeMindmap(t, NOTE);
    expect(out).toContain('tags: [plan]');
    expect(out).toContain('  - Launch post');
    expect(parseMindmap(out, 'x').children[1].children.map((c) => c.text)).toEqual(['Site', 'Launch post']);
  });

  it('adds view: mindmap to a new or plain note', () => {
    expect(serializeMindmap(mindNode('Ideas', [mindNode('One')]))).toBe('---\nview: mindmap\n---\n# Ideas\n\n- One\n');
    const out = serializeMindmap(mindNode('X'), '---\ntags: [a]\n---\nbody');
    expect(out).toMatch(/^---\ntags:/);
    expect(out).toContain('view: mindmap');
  });

  it('builds a map from any note: headings branch, lists leaf, code ignored', () => {
    const t = outlineFromNote('# Plan\n\nIntro\n\n## Goals\n- Ship\n  - Beta\n## Risks\n```\n- not a list\n```\n- Time\n', 'Plan');
    expect(t.text).toBe('Plan');
    expect(t.children.map((c) => c.text)).toEqual(['Goals', 'Risks']);
    expect(t.children[0].children[0].children[0].text).toBe('Beta');
    expect(t.children[1].children.map((c) => c.text)).toEqual(['Time']);
    expect(outlineFromNote('# Welcome to your hive\n\n## Try\n- One\n', 'Welcome').text).toBe('Welcome to your hive');
  });

  it('lays out a tree with parents centred on their children', () => {
    const t = parseMindmap(NOTE, 'x');
    const nodes = layoutMindmap(t, { colGap: 100, rowGap: 10 });
    const by = (s: string) => nodes.find((n) => n.node.text === s)!;
    expect(by('Launch').x).toBe(0);
    expect(by('Editor').x).toBe(200);
    expect(by('Product').y).toBe((by('Editor').y + by('[[Sync]]').y) / 2);
    const collapsed = layoutMindmap(t, { collapsed: new Set([t.children[0].id]) });
    expect(collapsed.some((n) => n.node.text === 'Editor')).toBe(false);
  });
});
