// Mind maps are ordinary Markdown notes: frontmatter `view: mindmap`, a `# Root` heading and a
// nested bullet list. Links, tags, search and agents keep working on them, and they read fine in
// any other Markdown app. These helpers turn that outline into a tree and back.
import { splitFrontmatter } from './parse';
import { setFrontmatter } from './properties';

export interface MindNode {
  id: string;
  text: string;
  children: MindNode[];
}

let seq = 0;
const nid = () => `m${++seq}`;

export function mindNode(text: string, children: MindNode[] = []): MindNode {
  return { id: nid(), text, children };
}

const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;

/** Parses a mind-map note. The root is the first `# heading`, else `fallbackTitle`. */
export function parseMindmap(text: string, fallbackTitle: string): MindNode {
  const body = text.slice(splitFrontmatter(text).bodyStart);
  const root = mindNode(fallbackTitle);
  const stack: { indent: number; node: MindNode }[] = [{ indent: -1, node: root }];
  let rootSet = false;
  for (const line of body.split('\n')) {
    const h = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (h && !rootSet) {
      root.text = h[1];
      rootSet = true;
      continue;
    }
    const m = LIST.exec(line.replace(/\t/g, '  '));
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const node = mindNode(m[2].trim());
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }
  return root;
}

/** Writes a tree back as a mind-map note, keeping the existing frontmatter (and adding `view: mindmap`). */
export function serializeMindmap(root: MindNode, previous = ''): string {
  const { frontmatter } = splitFrontmatter(previous);
  const withView = frontmatter.view === 'mindmap' ? previous : setFrontmatter(previous, { view: 'mindmap' });
  const fm = withView.slice(0, splitFrontmatter(withView).bodyStart);
  const lines: string[] = [];
  const walk = (n: MindNode, depth: number) => {
    for (const c of n.children) {
      lines.push(`${'  '.repeat(depth)}- ${c.text.replace(/\n+/g, ' ')}`);
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return `${fm.endsWith('\n') ? fm : fm + '\n'}# ${root.text.replace(/\n+/g, ' ')}\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

/** Builds a mind map from any note: headings become branches, list items become leaves. */
export function outlineFromNote(text: string, title: string): MindNode {
  const body = text.slice(splitFrontmatter(text).bodyStart);
  const root = mindNode(title);
  const headingStack: { level: number; node: MindNode }[] = [{ level: 0, node: root }];
  let listStack: { indent: number; node: MindNode }[] = [];
  let inCode = false;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode;
    if (inCode) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      // A leading title heading names the map instead of becoming its only branch.
      if (level === 1 && headingStack.length === 1 && !root.children.length) {
        root.text = h[2];
        continue;
      }
      while (headingStack.length > 1 && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
      const node = mindNode(h[2]);
      headingStack[headingStack.length - 1].node.children.push(node);
      headingStack.push({ level, node });
      listStack = [];
      continue;
    }
    const m = LIST.exec(line);
    if (m) {
      const indent = m[1].length;
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
      const parent = listStack.length ? listStack[listStack.length - 1].node : headingStack[headingStack.length - 1].node;
      const node = mindNode(m[2].trim());
      parent.children.push(node);
      listStack.push({ indent, node });
    }
  }
  return root;
}

export interface LaidOutNode {
  node: MindNode;
  depth: number;
  x: number;
  y: number;
  parent: string | null;
}

/**
 * A left-to-right tree layout. Leaves are spaced `rowGap` apart; each parent sits at the middle
 * of its children. Collapsed nodes hide their subtrees.
 */
export function layoutMindmap(root: MindNode, opts: { colGap?: number; rowGap?: number; collapsed?: Set<string> } = {}): LaidOutNode[] {
  const colGap = opts.colGap ?? 220;
  const rowGap = opts.rowGap ?? 44;
  const collapsed = opts.collapsed ?? new Set<string>();
  const out: LaidOutNode[] = [];
  let row = 0;
  const place = (n: MindNode, depth: number, parent: string | null): number => {
    const kids = collapsed.has(n.id) ? [] : n.children;
    let y: number;
    if (!kids.length) y = row++ * rowGap;
    else {
      const ys = kids.map((c) => place(c, depth + 1, n.id));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    out.push({ node: n, depth, x: depth * colGap, y, parent });
    return y;
  };
  place(root, 0, null);
  return out;
}

export function findNode(root: MindNode, id: string): { node: MindNode; parent: MindNode | null; index: number } | null {
  if (root.id === id) return { node: root, parent: null, index: -1 };
  const stack: MindNode[] = [root];
  while (stack.length) {
    const p = stack.pop()!;
    for (let i = 0; i < p.children.length; i++) {
      if (p.children[i].id === id) return { node: p.children[i], parent: p, index: i };
      stack.push(p.children[i]);
    }
  }
  return null;
}
