import { parseNote, splitFrontmatter } from '@basalt/core/browser';

export interface Chunk {
  path: string;
  heading: string;
  /** 0-based first line of the chunk in the note. */
  line: number;
  text: string;
}

/** Splits a note into ~maxChars chunks along headings and paragraphs, prefixed with the title for context. */
export function chunkNote(path: string, title: string, text: string, maxChars = 1200): Chunk[] {
  const { bodyStart } = splitFrontmatter(text);
  const meta = parseNote(text);
  const lines = text.split('\n');
  const bodyLine = text.slice(0, bodyStart).split('\n').length - 1;
  const chunks: Chunk[] = [];
  for (const s of meta.sections) {
    const start = Math.max(s.startLine, bodyLine);
    let buf: string[] = [];
    let bufStart = start;
    const flush = () => {
      const body = buf.join('\n').trim();
      if (body && (body.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 3) chunks.push({ path, heading: s.heading, line: bufStart, text: `${title}${s.heading ? ' › ' + s.heading : ''}\n${body}` });
      buf = [];
    };
    for (let i = start; i <= s.endLine && i < lines.length; i++) {
      const l = lines[i];
      if (buf.join('\n').length + l.length > maxChars && buf.length) {
        flush();
        bufStart = i;
      }
      buf.push(l);
    }
    flush();
  }
  if (!chunks.length && title) chunks.push({ path, heading: '', line: 0, text: title });
  return chunks;
}
