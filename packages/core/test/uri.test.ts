import { describe, expect, it } from 'vitest';
import { buildBasaltUri, parseBasaltUri } from '../src/uri';

describe('basalt:// links', () => {
  it('parses each action', () => {
    expect(parseBasaltUri('basalt://open?hive=My%20Notes&file=Projects%2FPlan')).toEqual({ action: 'open', hive: 'My Notes', file: 'Projects/Plan' });
    expect(parseBasaltUri('basalt://new?name=Idea&content=Hello%0Aworld')).toEqual({ action: 'new', hive: null, name: 'Idea', content: 'Hello\nworld' });
    expect(parseBasaltUri('basalt://daily?hive=Work')).toEqual({ action: 'daily', hive: 'Work' });
    expect(parseBasaltUri('basalt://search/?query=tag%3A%23x')).toEqual({ action: 'search', hive: null, query: 'tag:#x' });
  });

  it('rejects anything else', () => {
    for (const bad of ['https://open?file=a', 'basalt://delete?file=a', 'basalt://open', 'basalt://open?hive=x', 'basalt-file://hive/a.md', 'basalt://open?file=a#frag']) {
      expect(parseBasaltUri(bad)).toBeNull();
    }
  });

  it('round-trips', () => {
    const url = buildBasaltUri('open', { hive: 'Notes & more', file: 'A note #1.md' });
    expect(url).toBe('basalt://open?hive=Notes%20%26%20more&file=A%20note%20%231.md');
    expect(parseBasaltUri(url)).toEqual({ action: 'open', hive: 'Notes & more', file: 'A note #1.md' });
  });
});
