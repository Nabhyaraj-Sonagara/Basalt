import { parse as parseYaml } from 'yaml';
import type { BlockId, Heading, LinkRef, NoteMeta, Section, TagRef, TaskItem } from './types';

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

export interface FrontmatterSplit {
  frontmatter: Record<string, unknown>;
  /** Raw YAML between the fences, or null when there is no frontmatter block. */
  yaml: string | null;
  bodyStart: number;
  error?: string;
}

/** Finds a leading `---` YAML block. Line endings may be \n or \r\n. */
export function splitFrontmatter(text: string): FrontmatterSplit {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) {
    // An empty block: ---\n---
    const e = /^---\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
    if (e) return { frontmatter: {}, yaml: '', bodyStart: e[0].length };
    return { frontmatter: {}, yaml: null, bodyStart: 0 };
  }
  try {
    const data = parseYaml(m[1], { logLevel: 'silent' }) as unknown;
    const fm = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    return { frontmatter: fm, yaml: m[1], bodyStart: m[0].length };
  } catch (err) {
    return { frontmatter: {}, yaml: m[1], bodyStart: m[0].length, error: (err as Error).message };
  }
}

/**
 * Returns a copy of `text` with regions that must not be scanned for links/tags
 * (frontmatter, fenced code, inline code, %%comments%%, $$math$$) replaced by spaces.
 * Newlines are preserved so offsets and line numbers stay aligned.
 */
export function maskNonContent(text: string, bodyStart = 0): string {
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
  };
  blank(0, bodyStart);

  // Fenced code blocks.
  const lines = text.split('\n');
  let offset = 0;
  let fence: { char: string; len: number; start: number } | null = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineEnd = offset + line.length;
    if (offset >= bodyStart) {
      const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (fm && fm[1][0] === fence.char && fm[1].length >= fence.len && line.trim() === fm[1]) {
          blank(fence.start, lineEnd);
          fence = null;
        }
      } else if (fm) {
        fence = { char: fm[1][0], len: fm[1].length, start: offset };
      }
    }
    offset = lineEnd + 1;
  }
  if (fence) blank(fence.start, text.length);

  let masked = out.join('');
  const blankRe = (re: RegExp) => {
    masked = masked.replace(re, (m) => m.replace(/[^\n\r]/g, ' '));
  };
  blankRe(/%%[\s\S]*?%%/g);
  blankRe(/\$\$[\s\S]*?\$\$/g);
  blankRe(/(`+)(?!`)[^\n]*?[^`]\1(?!`)|``/g);
  return masked;
}

function lineAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function toStringList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null).map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

export function frontmatterTags(fm: Record<string, unknown>): string[] {
  const raw = [...toStringList(fm.tags), ...toStringList(fm.tag)];
  return raw.flatMap((t) => t.split(/\s+/)).map((t) => t.replace(/^#/, '')).filter(Boolean);
}

export function frontmatterAliases(fm: Record<string, unknown>): string[] {
  return [...toStringList(fm.aliases), ...toStringList(fm.alias)];
}

/** Splits `Note#Heading|Shown` into its parts. `\|` (escaped in tables) also separates display text. */
export function parseLinktext(inner: string): { target: string; subpath?: string; display?: string } {
  const s = inner.replace(/\\\|/g, '|');
  const bar = s.indexOf('|');
  const pathPart = bar >= 0 ? s.slice(0, bar) : s;
  const display = bar >= 0 ? s.slice(bar + 1) : undefined;
  const hash = pathPart.indexOf('#');
  const target = (hash >= 0 ? pathPart.slice(0, hash) : pathPart).trim();
  const subpath = hash >= 0 ? pathPart.slice(hash).trim() : undefined;
  return { target, subpath: subpath || undefined, display };
}

const TAG_RE = /(^|[\s(,;:!?"'[\]{}])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Parses a note's text into its metadata. Pure; no file system access. */
export function parseNote(text: string): NoteMeta {
  const fmSplit = splitFrontmatter(text);
  const fm = fmSplit.frontmatter;
  const masked = maskNonContent(text, fmSplit.bodyStart);
  const starts = lineStarts(text);

  const links: LinkRef[] = [];
  const embeds: LinkRef[] = [];

  const wiki = /(!?)\[\[([^[\]\n]+?)\]\]/g;
  for (let m; (m = wiki.exec(masked)); ) {
    const start = m.index;
    const end = start + m[0].length;
    const raw = text.slice(start, end);
    const inner = raw.slice(m[1] ? 3 : 2, -2);
    const parts = parseLinktext(inner);
    const ref: LinkRef = { raw, ...parts, embed: !!m[1], kind: 'wiki', start, end, line: lineAt(starts, start) };
    (ref.embed ? embeds : links).push(ref);
  }

  const md = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
  for (let m; (m = md.exec(masked)); ) {
    let href = text.slice(m.index, m.index + m[0].length).match(/\]\(\s*(<[^>\n]+>|[^)\s]+)/)?.[1] ?? '';
    if (href.startsWith('<')) href = href.slice(1, -1);
    if (EXTERNAL.test(href) || href.startsWith('#') && !href.slice(1)) continue;
    let decoded = href;
    try {
      decoded = decodeURI(href);
    } catch {
      /* keep raw */
    }
    const hash = decoded.indexOf('#');
    const target = hash >= 0 ? decoded.slice(0, hash) : decoded;
    const subpath = hash >= 0 ? decoded.slice(hash) : undefined;
    const start = m.index;
    const end = start + m[0].length;
    const ref: LinkRef = {
      raw: text.slice(start, end),
      target,
      subpath,
      display: m[2] || undefined,
      embed: !!m[1],
      kind: 'markdown',
      start,
      end,
      line: lineAt(starts, start),
    };
    (ref.embed ? embeds : links).push(ref);
  }
  links.sort((a, b) => a.start - b.start);
  embeds.sort((a, b) => a.start - b.start);

  // Mask link bodies so `[[a#b]]` does not produce a tag.
  let tagScan = masked;
  for (const l of [...links, ...embeds]) {
    tagScan = tagScan.slice(0, l.start) + ' '.repeat(l.end - l.start) + tagScan.slice(l.end);
  }
  tagScan = tagScan.replace(/https?:\/\/\S+/g, (u) => ' '.repeat(u.length));

  const inlineTags: TagRef[] = [];
  for (let m; (m = TAG_RE.exec(tagScan)); ) {
    const start = m.index + m[1].length;
    const tag = m[2].replace(/\/+$/, '');
    if (!tag) continue;
    inlineTags.push({ tag, start, end: start + 1 + m[2].length, line: lineAt(starts, start) });
  }

  const headings: Heading[] = [];
  const headRe = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  for (let m; (m = headRe.exec(masked)); ) {
    const start = m.index;
    const textPart = text.slice(start, start + m[0].length).replace(/^#{1,6}[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '').trim();
    headings.push({ level: m[1].length, text: textPart, start, end: start + m[0].length, line: lineAt(starts, start) });
  }

  const blocks: BlockId[] = [];
  const blockRe = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/gm;
  for (let m; (m = blockRe.exec(masked)); ) {
    const start = m.index + m[0].indexOf('^');
    blocks.push({ id: m[1], start, end: start + 1 + m[1].length, line: lineAt(starts, start) });
  }

  const tasks: TaskItem[] = [];
  const taskRe = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[(.)\][ \t]+(.*)$/gm;
  for (let m; (m = taskRe.exec(masked)); ) {
    const start = m.index;
    const status = text[start + m[1].length + 1];
    tasks.push({
      text: text.slice(start + m[0].length - m[3].length, start + m[0].length).trim(),
      status,
      done: status === 'x' || status === 'X',
      start,
      end: start + m[0].length,
      line: lineAt(starts, start),
    });
  }

  const totalLines = starts.length;
  const sections: Section[] = [];
  const bodyLine = lineAt(starts, fmSplit.bodyStart);
  if (!headings.length || headings[0].line > bodyLine) {
    sections.push({ heading: '', startLine: bodyLine, endLine: (headings[0]?.line ?? totalLines) - 1 });
  }
  headings.forEach((h, i) => {
    sections.push({ heading: h.text, startLine: h.line, endLine: (headings[i + 1]?.line ?? totalLines) - 1 });
  });

  const tags = [...new Set([...frontmatterTags(fm), ...inlineTags.map((t) => t.tag)])];
  const body = masked.slice(fmSplit.bodyStart);
  const wordCount = (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;

  return {
    frontmatter: fm,
    bodyStart: fmSplit.bodyStart,
    aliases: frontmatterAliases(fm),
    tags,
    inlineTags,
    links,
    embeds,
    headings,
    blocks,
    tasks,
    sections,
    wordCount,
  };
}

/** Text of the block (paragraph or list item) a `^id` belongs to. */
export function blockText(text: string, id: string): string | null {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => new RegExp(`(?:^|\\s)\\^${id.replace(/[-]/g, '\\-')}\\s*$`).test(l));
  if (idx < 0) return null;
  let s = idx;
  if (!/^\s*([-*+]|\d+[.)])\s/.test(lines[idx])) {
    while (s > 0 && lines[s - 1].trim() !== '' && !/^#{1,6}\s/.test(lines[s - 1])) s--;
  }
  return lines
    .slice(s, idx + 1)
    .join('\n')
    .replace(new RegExp(`\\s*\\^${id}\\s*$`), '');
}

/** Text under a heading, up to the next heading of the same or higher level. */
export function sectionText(text: string, heading: string): string | null {
  const meta = parseNote(text);
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(heading.replace(/^#/, ''));
  const i = meta.headings.findIndex((h) => norm(h.text) === target);
  if (i < 0) return null;
  const h = meta.headings[i];
  const next = meta.headings.slice(i + 1).find((x) => x.level <= h.level);
  return text.slice(h.start, next ? next.start : text.length).trimEnd();
}

/** Resolves a subpath (`#Heading`, `#^block`, `#A#B`) into the text it points at. */
export function subpathText(text: string, subpath?: string): string {
  if (!subpath) return text.slice(splitFrontmatter(text).bodyStart);
  const s = subpath.replace(/^#/, '');
  if (s.startsWith('^')) return blockText(text, s.slice(1)) ?? '';
  const parts = s.split('#').filter(Boolean);
  return sectionText(text, parts[parts.length - 1] ?? '') ?? '';
}
