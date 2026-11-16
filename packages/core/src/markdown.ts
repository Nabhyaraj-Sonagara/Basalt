// Markdown → HTML for reading view, hover previews and embeds.
// Runs in both Node and the browser. Output uses the design system's class names.
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import type { StateInline, StateCore, Token } from 'markdown-it';
import { parseLinktext, splitFrontmatter } from './parse';
import { extOf } from './resolve';

export interface RenderOptions {
  /** Path of the note being rendered, for relative link resolution. */
  sourcePath?: string;
  resolve?: (target: string, sourcePath: string) => string | null;
  /** SVG markup for a design-system icon. */
  icon?: (name: string) => string;
  /** Returns HTML for an embed, or null to emit a placeholder the UI hydrates later. */
  embed?: (path: string | null, target: string, subpath: string | undefined, display: string | undefined) => string | null;
  /** URL for an attachment (image, PDF) at a hive path. */
  fileUrl?: (path: string) => string;
  math?: (tex: string, display: boolean) => string;
  highlight?: (code: string, lang: string) => string;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const CALLOUT_KIND: Record<string, 'note' | 'tip' | 'info' | 'warning'> = {};
for (const k of ['note', 'abstract', 'summary', 'tldr', 'todo', 'example', 'quote', 'cite']) CALLOUT_KIND[k] = 'note';
for (const k of ['tip', 'hint', 'important', 'success', 'check', 'done']) CALLOUT_KIND[k] = 'tip';
for (const k of ['info', 'question', 'help', 'faq']) CALLOUT_KIND[k] = 'info';
for (const k of ['warning', 'caution', 'attention', 'failure', 'fail', 'missing', 'danger', 'error', 'bug']) CALLOUT_KIND[k] = 'warning';
const CALLOUT_ICON = { note: 'note', tip: 'highlight', info: 'info', warning: 'warning' };

const TASK_SVG =
  '<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><polygon class="bs-task-ring" points="9,0.5 17.2,5.25 17.2,14.75 9,19.5 0.8,14.75 0.8,5.25"></polygon><polygon class="bs-task-hex" points="9,3 15,6.5 15,13.5 9,17 3,13.5 3,6.5"></polygon><path class="bs-task-check" d="M5.8 10.2l2.2 2.2 4.3-4.6"></path></svg>';

/** Replaces %%comments%% with blanks, keeping newlines so line numbers stay put. */
export function stripComments(src: string): string {
  return src.replace(/%%[\s\S]*?%%/g, (m) => m.replace(/[^\n]/g, ''));
}

export function createMarkdown(opts: RenderOptions = {}): InstanceType<typeof MarkdownIt> {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    highlight: (code, lang) => {
      if (lang === 'mermaid') return `<div class="mermaid-block" data-src="${escapeHtml(code)}"></div>`;
      if (opts.highlight) {
        try {
          return `<pre class="code"><code class="hljs language-${escapeHtml(lang)}">${opts.highlight(code, lang)}</code></pre>`;
        } catch {
          /* fall through */
        }
      }
      return '';
    },
  });
  md.use(footnote);
  const icon = opts.icon ?? (() => '');
  const source = () => opts.sourcePath ?? '';

  // [[wikilinks]] and ![[embeds]]
  md.inline.ruler.before('link', 'wikilink', (state: StateInline, silent: boolean) => {
    const src = state.src;
    let pos = state.pos;
    const embed = src.charCodeAt(pos) === 0x21; /* ! */
    if (embed) pos++;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const close = src.indexOf(']]', pos + 2);
    if (close < 0) return false;
    const inner = src.slice(pos + 2, close);
    if (!inner || inner.includes('\n') || inner.includes('[')) return false;
    if (!silent) {
      const t = state.push('wikilink', '', 0);
      t.meta = { inner, embed };
    }
    state.pos = close + 2;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, idx) => {
    const { inner, embed } = tokens[idx].meta as { inner: string; embed: boolean };
    const { target, subpath, display } = parseLinktext(inner);
    const resolved = opts.resolve ? opts.resolve(target, source()) : target || source();
    if (embed) {
      const custom = opts.embed?.(resolved, target, subpath, display);
      if (custom != null) return custom;
      const ext = extOf(resolved ?? target);
      if (resolved && IMAGE_EXTS.has(ext)) {
        const size = /^(\d+)(?:x(\d+))?$/.exec(display ?? '');
        const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ''}` : '';
        const alt = size ? target : display ?? target;
        return `<img class="bs-embed-img" src="${escapeHtml(opts.fileUrl?.(resolved) ?? resolved)}" alt="${escapeHtml(alt)}"${dims}>`;
      }
      return `<div class="bs-embed" data-path="${escapeHtml(resolved ?? '')}" data-target="${escapeHtml(target)}" data-subpath="${escapeHtml(subpath ?? '')}"></div>`;
    }
    const label = display ?? (target ? target + (subpath ? ' › ' + subpath.replace(/^#\^?/, '') : '') : (subpath ?? '').replace(/^#\^?/, ''));
    const kind = resolved ? 'internal' : 'unresolved';
    return `<a href="#" class="bs-link bs-link-${kind}" data-path="${escapeHtml(resolved ?? '')}" data-target="${escapeHtml(target)}" data-subpath="${escapeHtml(subpath ?? '')}"${kind === 'unresolved' ? ' title="Not written yet — click to create"' : ''}>${escapeHtml(label)}</a>`;
  };

  // ==highlight==
  md.inline.ruler.before('emphasis', 'highlight', (state: StateInline, silent: boolean) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false;
    const end = src.indexOf('==', start + 2);
    if (end < 0 || end === start + 2) return false;
    if (!silent) {
      state.push('mark_open', 'mark', 1);
      const old = state.posMax;
      state.pos = start + 2;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = old;
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + 2;
    return true;
  });

  // #tags
  md.inline.ruler.before('text', 'tag', (state: StateInline, silent: boolean) => {
    const src = state.src;
    const pos = state.pos;
    if (src.charCodeAt(pos) !== 0x23) return false;
    if (pos > 0 && !/[\s(,;:!?"'[\]{}]/.test(src[pos - 1])) return false;
    const m = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(src.slice(pos));
    if (!m) return false;
    if (!silent) {
      const t = state.push('tag', '', 0);
      t.meta = { tag: m[1].replace(/\/+$/, '') };
    }
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.tag = (tokens, idx) => {
    const tag = escapeHtml((tokens[idx].meta as { tag: string }).tag);
    return `<a href="#" class="bs-tag-hit" data-tag="${tag}"><span class="bs-tag"><span class="bs-tag-hash" aria-hidden="true">#</span>${tag}</span></a>`;
  };
  // markdown-it's text rule swallows '#'; make it a terminator so the tag rule can run.
  const textRule = md.inline.ruler.__rules__.find((r: { name: string }) => r.name === 'text');
  if (textRule) {
    const orig = textRule.fn;
    textRule.fn = (state: StateInline, silent: boolean) => {
      const hash = state.src.indexOf('#', state.pos);
      const dollar = opts.math ? state.src.indexOf('$', state.pos) : -1;
      const stops = [hash, dollar].filter((x) => x > state.pos);
      if (!stops.length) return orig(state, silent);
      const stop = Math.min(...stops);
      const oldMax = state.posMax;
      state.posMax = Math.min(oldMax, stop);
      const ok = orig(state, silent);
      state.posMax = oldMax;
      return ok;
    };
  }

  // $math$ and $$math$$
  if (opts.math) {
    const math = opts.math;
    md.inline.ruler.after('escape', 'math_inline', (state: StateInline, silent: boolean) => {
      const src = state.src;
      const start = state.pos;
      if (src.charCodeAt(start) !== 0x24) return false;
      const display = src.charCodeAt(start + 1) === 0x24;
      const open = display ? 2 : 1;
      const close = src.indexOf(display ? '$$' : '$', start + open);
      if (close < 0 || close === start + open) return false;
      const tex = src.slice(start + open, close);
      if (!display && (/^\s/.test(tex) || /\s$/.test(tex))) return false;
      if (!silent) {
        const t = state.push('math', '', 0);
        t.meta = { tex, display };
      }
      state.pos = close + open;
      return true;
    });
    md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      if (state.src.slice(start, start + 2) !== '$$') return false;
      const firstLine = state.src.slice(start + 2, state.eMarks[startLine]);
      let tex = '';
      let line = startLine;
      if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
        tex = firstLine.trim().slice(0, -2);
      } else {
        const parts = [firstLine];
        for (line = startLine + 1; line < endLine; line++) {
          const l = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
          if (l.trim().endsWith('$$')) {
            parts.push(l.trim().slice(0, -2));
            break;
          }
          parts.push(l);
        }
        if (line >= endLine) return false;
        tex = parts.join('\n');
      }
      if (silent) return true;
      const t = state.push('math', '', 0);
      t.meta = { tex: tex.trim(), display: true };
      t.map = [startLine, line + 1];
      t.block = true;
      state.line = line + 1;
      return true;
    });
    md.renderer.rules.math = (tokens, idx) => {
      const { tex, display } = tokens[idx].meta as { tex: string; display: boolean };
      try {
        return math(tex, display);
      } catch {
        return `<code class="math-error">${escapeHtml(tex)}</code>`;
      }
    };
  }

  // Callouts: > [!type]± Title
  md.core.ruler.after('block', 'callout', (state: StateCore) => {
    const toks = state.tokens;
    const stack: { open: number; kind: string | null }[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type === 'blockquote_open') {
        let kind: string | null = null;
        const inline = toks[i + 2];
        if (toks[i + 1]?.type === 'paragraph_open' && inline?.type === 'inline') {
          const m = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)(?:\n|$)/.exec(inline.content);
          if (m) {
            const raw = m[1].toLowerCase();
            const k = CALLOUT_KIND[raw] ?? 'note';
            const fold = m[2];
            const title = m[3] || raw.charAt(0).toUpperCase() + raw.slice(1);
            inline.content = inline.content.slice(m[0].length);
            const head = `<div class="bs-callout-head">${icon(CALLOUT_ICON[k])}<span>${md.renderInline(title, state.env)}</span></div>`;
            const tag = fold ? 'details' : 'aside';
            const open = fold === '+' ? ' open' : '';
            t.type = 'html_block';
            t.content = fold
              ? `<details class="bs-callout bs-callout-${k}" data-callout="${escapeHtml(raw)}"${open}><summary>${head}</summary><div class="bs-callout-body">\n`
              : `<aside class="bs-callout bs-callout-${k}" data-callout="${escapeHtml(raw)}">${head}<div class="bs-callout-body">\n`;
            kind = tag;
            if (!inline.content.trim()) {
              // Title-only first paragraph: drop it.
              toks[i + 1].hidden = true;
              toks[i + 3].hidden = true;
              inline.content = '';
            }
          }
        }
        stack.push({ open: i, kind });
      } else if (t.type === 'blockquote_close') {
        const s = stack.pop();
        if (s?.kind) {
          t.type = 'html_block';
          t.content = `</div></${s.kind}>\n`;
        }
      }
    }
  });

  // Task list items and trailing ^block-ids.
  md.core.ruler.after('inline', 'tasks_blocks', (state: StateCore) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== 'inline' || !t.children?.length) continue;
      const last = t.children[t.children.length - 1];
      if (last.type === 'text') {
        const m = /\s*\^([A-Za-z0-9-]+)\s*$/.exec(last.content);
        if (m) {
          last.content = last.content.slice(0, m.index);
          const blockOpen = toks[i - 1];
          if (blockOpen && blockOpen.type.endsWith('_open')) blockOpen.attrSet('id', `^${m[1]}`);
        }
      }
      const li = toks[i - 2];
      const first = t.children[0];
      if (li?.type === 'list_item_open' && first?.type === 'text') {
        const m = /^\[(.)\]\s+/.exec(first.content);
        if (m) {
          const status = m[1];
          const done = status === 'x' || status === 'X';
          first.content = first.content.slice(m[0].length);
          li.attrJoin('class', `task-item${done ? ' task-done' : ''}${status === '-' ? ' task-cancelled' : ''}`);
          li.attrSet('data-task', status);
          const line = li.map?.[0] ?? 0;
          const box = new (state.Token as unknown as new (type: string, tag: string, nesting: number) => Token)('html_inline', '', 0);
          box.content = `<span class="bs-task${done ? ' bs-task-done' : ''}"><button type="button" role="checkbox" aria-checked="${done}" class="bs-task-cell" data-line="${line}">${TASK_SVG}</button></span>`;
          t.children.unshift(box);
        }
      }
    }
  });

  // Source line numbers for scroll sync and click-to-edit.
  for (const name of ['paragraph_open', 'heading_open', 'list_item_open', 'blockquote_open', 'table_open', 'code_block', 'fence', 'hr']) {
    const prev = md.renderer.rules[name];
    md.renderer.rules[name] = (tokens, idx, o, env, self) => {
      const tok = tokens[idx];
      if (tok.map) tok.attrSet('data-line', String(tok.map[0]));
      return prev ? prev(tokens, idx, o, env, self) : self.renderToken(tokens, idx, o);
    };
  }

  // External links open outside the app.
  md.renderer.rules.link_open = (tokens, idx, o, env, self) => {
    const href = String(tokens[idx].attrGet('href') ?? '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      tokens[idx].attrJoin('class', 'bs-link bs-link-external');
      tokens[idx].attrSet('data-external', href);
    } else {
      let target = href;
      try {
        target = decodeURI(href);
      } catch {
        /* keep */
      }
      const hash = target.indexOf('#');
      const path = hash >= 0 ? target.slice(0, hash) : target;
      const resolved = opts.resolve ? opts.resolve(path, source()) : path;
      tokens[idx].attrJoin('class', `bs-link bs-link-${resolved ? 'internal' : 'unresolved'}`);
      tokens[idx].attrSet('data-path', resolved ?? '');
      tokens[idx].attrSet('data-target', path);
      tokens[idx].attrSet('data-subpath', hash >= 0 ? target.slice(hash) : '');
      tokens[idx].attrSet('href', '#');
    }
    return self.renderToken(tokens, idx, o);
  };

  return md;
}

export function renderMarkdown(src: string, opts: RenderOptions = {}): string {
  const md = createMarkdown(opts);
  const { bodyStart } = splitFrontmatter(src);
  // Blank the frontmatter but keep its newlines so data-line numbers match the source.
  const body = src.slice(0, bodyStart).replace(/[^\n]/g, '') + src.slice(bodyStart);
  return md.render(stripComments(body));
}
