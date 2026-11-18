import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { EditorState, StateEffect, StateField, type Range, type Transaction } from '@codemirror/state';

/** Dispatch to re-decorate after the hive changes (new notes make links resolve). */
export const refreshEffect = StateEffect.define<null>();
/** Tracks editor focus: without focus nothing counts as "under the cursor", so the note renders fully. */
const focusEffect = StateEffect.define<boolean>();
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { extOf, parseLinktext, splitFrontmatter, escapeHtml, subpathText } from '@basalt/core/browser';
import { getState } from '../lib/store';
import { renderNoteHtml, hydrate } from '../lib/render';
import { PAGE_SANDBOX, isPagePath, pageUrl } from '../lib/pages';
import { iconSvg } from '../lib/icons';

export interface LiveContext {
  sourcePath: () => string;
}

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

const TASK_SVG =
  '<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><polygon class="bs-task-ring" points="9,0.5 17.2,5.25 17.2,14.75 9,19.5 0.8,14.75 0.8,5.25"></polygon><polygon class="bs-task-hex" points="9,3 15,6.5 15,13.5 9,17 3,13.5 3,6.5"></polygon><path class="bs-task-check" d="M5.8 10.2l2.2 2.2 4.3-4.6"></path></svg>';

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(o: TaskWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = `bs-task cm-task${this.checked ? ' bs-task-done' : ''}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bs-task-cell';
    btn.setAttribute('role', 'checkbox');
    btn.setAttribute('aria-checked', String(this.checked));
    btn.innerHTML = TASK_SVG;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const ch = view.state.sliceDoc(this.pos + 1, this.pos + 2);
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: ch === ' ' ? 'x' : ' ' } });
    });
    wrap.appendChild(btn);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.textContent = '•';
    return s;
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-hr-line';
    return s;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width?: string,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.width === this.width;
  }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-embed-img';
    img.src = this.src;
    img.alt = this.alt;
    if (this.width) img.width = Number(this.width);
    return img;
  }
}

/** ![[page.html|height]]: the page, live, in its sandbox. */
class PageWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly height: number,
    readonly version: number,
  ) {
    super();
  }
  eq(o: PageWidget) {
    return o.path === this.path && o.height === this.height && o.version === this.version;
  }
  toDOM() {
    const f = document.createElement('iframe');
    f.className = 'bs-embed-page cm-embed-page';
    f.setAttribute('sandbox', PAGE_SANDBOX);
    f.src = pageUrl(this.path);
    f.title = this.path;
    f.style.height = `${this.height}px`;
    return f;
  }
  ignoreEvent() {
    return true;
  }
}

class NoteEmbedWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly subpath: string | undefined,
    readonly version: number,
  ) {
    super();
  }
  eq(o: NoteEmbedWidget) {
    return o.path === this.path && o.subpath === this.subpath && o.version === this.version;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'bs-embed cm-embed';
    el.dataset.hydrated = '1';
    const title = getState().notesByPath.get(this.path)?.title ?? this.path;
    el.innerHTML = `<div class="bs-embed-head">${iconSvg('note', 14)}<span>${escapeHtml(title)}${this.subpath ? ' › ' + escapeHtml(this.subpath.replace(/^#\^?/, '')) : ''}</span></div><div class="bs-embed-body">…</div>`;
    void window.basalt.hive.read(this.path).then(async (text) => {
      const body = el.querySelector('.bs-embed-body') as HTMLElement;
      body.innerHTML = renderNoteHtml(subpathText(text, this.subpath), this.path);
      await hydrate(body, this.path, 1);
    });
    return el;
  }
  get estimatedHeight() {
    return 120;
  }
}

class PropertiesWidget extends WidgetType {
  constructor(readonly yaml: string) {
    super();
  }
  eq(o: PropertiesWidget) {
    return o.yaml === this.yaml;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-properties';
    const keys = this.yaml
      .split('\n')
      .map((l) => /^([^\s:#][^:]*):/.exec(l)?.[1])
      .filter(Boolean);
    el.innerHTML = `${iconSvg('tag', 14)}<span>Properties</span><span class="cm-properties-keys">${keys.map((k) => escapeHtml(k!)).join(' · ')}</span>`;
    el.title = 'Click to edit the YAML';
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

let focused = false;

function activeLines(state: EditorState): Set<number> {
  const set = new Set<number>();
  if (!focused) return set;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}

function touches(state: EditorState, from: number, to: number): boolean {
  if (!focused) return false;
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

const hide = Decoration.replace({});

function build(state: EditorState, ctx: LiveContext): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const lines = activeLines(state);
  const doc = state.doc;
  const text = doc.toString();
  const s = getState();
  const source = ctx.sourcePath();

  // Frontmatter collapses into a small properties chip until the cursor enters it.
  const fm = splitFrontmatter(text);
  let bodyStart = 0;
  if (fm.yaml != null && fm.bodyStart > 0) {
    bodyStart = fm.bodyStart;
    const end = Math.max(0, fm.bodyStart - 1);
    if (!touches(state, 0, end)) decos.push(Decoration.replace({ block: true, widget: new PropertiesWidget(fm.yaml) }).range(0, end));
    else for (let l = 1; l <= doc.lineAt(end).number; l++) decos.push(Decoration.line({ class: 'cm-frontmatter' }).range(doc.line(l).from));
  }

  const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
  const codeRanges: [number, number][] = [];

  tree.iterate({
    from: bodyStart,
    enter: (node) => {
      const { name, from, to } = node;
      const lineNo = doc.lineAt(from).number;
      const lineActive = lines.has(lineNo);
      if (/^ATXHeading(\d)$/.test(name)) {
        const level = name.slice(-1);
        decos.push(Decoration.line({ class: `cm-h cm-h${level}` }).range(doc.lineAt(from).from));
        return;
      }
      if (name === 'HeaderMark' && !lineActive) {
        const after = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
        decos.push(hide.range(from, after));
        return;
      }
      if (name === 'FencedCode' || name === 'CodeBlock') {
        codeRanges.push([from, to]);
        for (let l = doc.lineAt(from).number; l <= doc.lineAt(to).number; l++) decos.push(Decoration.line({ class: 'cm-codeblock' }).range(doc.line(l).from));
        return false;
      }
      if (name === 'InlineCode') {
        codeRanges.push([from, to]);
        decos.push(Decoration.mark({ class: 'cm-inline-code' }).range(from, to));
        if (!touches(state, from, to)) {
          const c = node.node.getChildren('CodeMark');
          for (const m of c) decos.push(hide.range(m.from, m.to));
        }
        return false;
      }
      if (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'Strikethrough') {
        decos.push(Decoration.mark({ class: name === 'Emphasis' ? 'cm-em' : name === 'StrongEmphasis' ? 'cm-strong' : 'cm-strike' }).range(from, to));
        if (!touches(state, from, to)) {
          for (const m of [...node.node.getChildren('EmphasisMark'), ...node.node.getChildren('StrikethroughMark')]) decos.push(hide.range(m.from, m.to));
        }
        return;
      }
      if (name === 'Link' || name === 'Image') {
        const url = node.node.getChild('URL');
        const marks = node.node.getChildren('LinkMark');
        if (!url || marks.length < 2) return false;
        const href = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '');
        if (touches(state, from, to)) return false;
        if (name === 'Image') {
          const src = /^[a-z]+:/i.test(href) ? href : (() => {
            const p = s.resolver.resolve(decodeURI(href), source);
            return p ? window.basalt.hive.fileUrl(p) : href;
          })();
          decos.push(Decoration.replace({ widget: new ImageWidget(src, doc.sliceString(marks[0].to, marks[1].from)) }).range(from, to));
          return false;
        }
        const textFrom = marks[0].to;
        const textTo = marks[1].from;
        if (textTo <= textFrom) return false;
        const external = /^[a-z][a-z0-9+.-]*:/i.test(href);
        decos.push(hide.range(from, textFrom));
        decos.push(
          Decoration.mark({
            class: external ? 'cm-link cm-link-external' : 'cm-wikilink',
            attributes: external ? { 'data-href': href } : { 'data-target': decodeURI(href.split('#')[0]), 'data-subpath': href.includes('#') ? '#' + href.split('#')[1] : '' },
          }).range(textFrom, textTo),
        );
        decos.push(hide.range(textTo, to));
        return false;
      }
      if (name === 'Blockquote') {
        for (let l = doc.lineAt(from).number; l <= doc.lineAt(to).number; l++) decos.push(Decoration.line({ class: 'cm-quote' }).range(doc.line(l).from));
        return;
      }
      if (name === 'QuoteMark' && !lineActive) {
        const after = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
        decos.push(hide.range(from, after));
        return;
      }
      if (name === 'TaskMarker') {
        if (!touches(state, from, to)) {
          const checked = /x/i.test(doc.sliceString(from + 1, from + 2));
          decos.push(Decoration.replace({ widget: new TaskWidget(checked, from) }).range(from, to));
          if (checked) {
            const line = doc.lineAt(from);
            decos.push(Decoration.mark({ class: 'cm-task-done' }).range(Math.min(to + 1, line.to), line.to));
          }
        }
        return;
      }
      if (name === 'ListMark' && !lineActive) {
        const mark = doc.sliceString(from, to);
        const next = doc.sliceString(to, to + 4);
        if (/^[-*+]$/.test(mark) && !/^ \[.\]/.test(next)) decos.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
        else if (/^[-*+]$/.test(mark)) decos.push(hide.range(from, Math.min(to + 1, doc.lineAt(from).to)));
        return;
      }
      if (name === 'HorizontalRule') {
        decos.push(Decoration.line({ class: 'cm-hr' }).range(doc.lineAt(from).from));
        if (!lineActive) decos.push(Decoration.replace({ widget: new HrWidget() }).range(from, to));
        return;
      }
    },
  });

  const inCode = (pos: number) => codeRanges.some(([a, b]) => pos >= a && pos < b);

  // Basalt syntax the Markdown grammar doesn't know, line by line.
  for (let i = doc.lineAt(bodyStart).number; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (inCode(line.from) && inCode(line.to - 1 < line.from ? line.from : line.to - 1)) continue;
    const t = line.text;
    const active = lines.has(i);

    // Callout header: > [!type] Title
    const callout = /^(>\s*)\[!([\w-]+)\]([+-]?)\s*/.exec(t);
    if (callout) {
      decos.push(Decoration.line({ class: `cm-callout-head cm-callout-${callout[2].toLowerCase()}` }).range(line.from));
      if (!active) decos.push(Decoration.replace({}).range(line.from + callout[1].length, line.from + callout[0].length));
    }

    for (const m of t.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
      const from = line.from + m.index!;
      const to = from + m[0].length;
      if (inCode(from)) continue;
      const embed = !!m[1];
      const { target, subpath, display } = parseLinktext(m[2]);
      const resolved = target ? s.resolver.resolve(target, source) : source;
      if (touches(state, from, to)) {
        decos.push(Decoration.mark({ class: 'cm-wikilink-source' }).range(from, to));
        continue;
      }
      if (embed && resolved) {
        const ext = extOf(resolved);
        if (IMAGE.has(ext)) {
          const width = /^\d+/.exec(display ?? '')?.[0];
          decos.push(Decoration.replace({ widget: new ImageWidget(window.basalt.hive.fileUrl(resolved), target, width) }).range(from, to));
          continue;
        }
        if (isPagePath(resolved)) {
          const height = Math.max(120, Math.min(2000, Number.parseInt(display ?? '', 10) || 360));
          const mtime = s.hive?.files.find((f) => f.path === resolved)?.mtime ?? 0;
          decos.push(Decoration.replace({ widget: new PageWidget(resolved, height, mtime) }).range(from, to));
          continue;
        }
        if (ext === 'md') {
          decos.push(Decoration.replace({ widget: new NoteEmbedWidget(resolved, subpath, s.version) }).range(from, to));
          continue;
        }
      }
      const innerFrom = from + (embed ? 3 : 2);
      const innerTo = to - 2;
      const pipe = m[2].replace(/\\\|/g, '||').indexOf('|');
      const labelFrom = display != null && pipe >= 0 ? innerFrom + m[2].indexOf(display, pipe) : innerFrom;
      decos.push(hide.range(from, labelFrom));
      decos.push(
        Decoration.mark({
          class: `cm-wikilink${resolved ? '' : ' cm-unresolved'}`,
          attributes: { 'data-target': target, 'data-subpath': subpath ?? '', 'data-path': resolved ?? '' },
        }).range(labelFrom, innerTo),
      );
      decos.push(hide.range(innerTo, to));
    }

    for (const m of t.matchAll(/==([^=\n]+)==/g)) {
      const from = line.from + m.index!;
      const to = from + m[0].length;
      if (inCode(from)) continue;
      decos.push(Decoration.mark({ class: 'cm-highlight' }).range(from + 2, to - 2));
      if (!touches(state, from, to)) {
        decos.push(hide.range(from, from + 2));
        decos.push(hide.range(to - 2, to));
      }
    }

    for (const m of t.matchAll(/(^|[\s(,;:!?"'])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu)) {
      const from = line.from + m.index! + m[1].length;
      const to = from + 1 + m[2].length;
      if (inCode(from) || /^#{1,6}\s/.test(t) && m.index === 0) continue;
      // Skip '#' inside wikilinks.
      if (/\[\[[^\]]*$/.test(t.slice(0, m.index! + m[1].length))) continue;
      decos.push(Decoration.mark({ class: 'cm-tag', attributes: { 'data-tag': m[2] } }).range(from, to));
    }

    for (const m of t.matchAll(/%%.*?%%/g)) {
      const from = line.from + m.index!;
      const to = from + m[0].length;
      if (inCode(from)) continue;
      if (touches(state, from, to)) decos.push(Decoration.mark({ class: 'cm-comment-md' }).range(from, to));
      else decos.push(hide.range(from, to));
    }

    const block = /\s\^([A-Za-z0-9-]+)\s*$/.exec(t);
    if (block && !active) decos.push(Decoration.mark({ class: 'cm-block-id' }).range(line.from + block.index + 1, line.to));
  }

  return Decoration.set(decos, true);
}

/** Live preview: Markdown renders in place, with syntax revealed around the cursor. */
export function livePreview(ctx: LiveContext) {
  // `focused` is module state read by build(); each field records its own and sets it before building.
  const field = StateField.define<{ deco: DecorationSet; focused: boolean }>({
    create: (state) => {
      focused = false;
      return { deco: build(state, ctx), focused: false };
    },
    update(value, tr: Transaction) {
      let f = value.focused;
      for (const e of tr.effects) if (e.is(focusEffect)) f = e.value;
      if (tr.docChanged || tr.selection || tr.effects.length) {
        focused = f;
        return { deco: build(tr.state, ctx), focused: f };
      }
      return value;
    },
    provide: (fld) => EditorView.decorations.from(fld, (v) => v.deco),
  });
  return [field, EditorView.focusChangeEffect.of((_state, focusing) => focusEffect.of(focusing))];
}
