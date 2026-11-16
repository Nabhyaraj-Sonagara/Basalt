import type { MarkdownConfig } from '@lezer/markdown';

/** Parses a leading YAML block (--- … ---) as one Frontmatter node so it isn't read as a heading. */
export const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || line.text.trimEnd() !== '---') return false;
        const start = cx.lineStart;
        while (cx.nextLine()) {
          const t = line.text.trimEnd();
          if (t === '---' || t === '...') {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('Frontmatter', start, end));
            return true;
          }
        }
        cx.addElement(cx.elt('Frontmatter', start, cx.prevLineEnd()));
        return true;
      },
    },
  ],
};
