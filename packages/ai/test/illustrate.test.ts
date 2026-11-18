import { describe, expect, it } from 'vitest';
import { extractIllustration, illustrationPrompt } from '../src/illustrate';

describe('illustrate', () => {
  it('asks for the right format, with the note or the picture', () => {
    const p = illustrationPrompt({ kind: 'flowchart', title: 'Deploy', text: 'Build, test, ship', instructions: 'left to right' });
    expect(p.system).toMatch(/Mermaid flowchart/);
    expect(p.user).toContain('("Deploy")');
    expect(p.user).toContain('Also: left to right');
    const img = illustrationPrompt({ kind: 'mindmap', hasImage: true });
    expect(img.system).toMatch(/hand drawing/);
    expect(img.user).toBe('Illustrate the attached picture.');
    expect(illustrationPrompt({ kind: 'chart', text: 'x' }).system).toMatch(/never invent data/);
  });

  it('extracts Mermaid from fenced or chatty answers', () => {
    expect(extractIllustration('flowchart', 'Sure!\n```mermaid\nflowchart TD\n  A --> B\n```\nHope that helps')).toBe('flowchart TD\n  A --> B\n');
    expect(extractIllustration('sequence', 'Here:\nsequenceDiagram\n  A->>B: hi')).toBe('sequenceDiagram\n  A->>B: hi\n');
    expect(extractIllustration('chart', 'pie title Pets\n  "Dogs" : 3')).toMatch(/^pie title Pets/);
    expect(() => extractIllustration('flowchart', 'I cannot see the image.')).toThrow(/didn't return a diagram/);
  });

  it('extracts a mind-map outline', () => {
    expect(extractIllustration('mindmap', 'Here you go:\n\n# Trip\n\n- Pack\n  - Socks\n- Book\n\nEnjoy!')).toBe('# Trip\n\n- Pack\n  - Socks\n- Book\n');
    expect(() => extractIllustration('mindmap', 'No idea')).toThrow(/mind map/);
  });
});
