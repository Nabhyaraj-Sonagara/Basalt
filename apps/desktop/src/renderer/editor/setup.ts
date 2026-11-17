import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, searchKeymap, search } from '@codemirror/search';
import { Compartment, EditorSelection, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder, rectangularSelection, dropCursor, type KeyBinding } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basaltCompletions } from './complete';
import { slashCompletions } from './slash';
import { frontmatter } from './frontmatter';
import { livePreview } from './livePreview';

export const modeCompartment = new Compartment();

const basaltHighlight = HighlightStyle.define([
  { tag: t.heading, fontFamily: 'var(--font-display)', fontWeight: '700', color: 'var(--ink)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--honey-text)' },
  { tag: t.url, color: 'var(--ink-muted)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.88em' },
  { tag: t.quote, color: 'var(--ink-muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--ink-faint)' },
  { tag: t.list, color: 'var(--ink-muted)' },
  { tag: t.keyword, color: 'var(--honey-text)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--moss)' },
  { tag: [t.number, t.bool, t.atom], color: 'var(--sky)' },
  { tag: t.comment, color: 'var(--ink-faint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: 'var(--ember)' },
  { tag: t.typeName, color: 'var(--sky)' },
]);

/** Wraps the selection in `mark` (or inserts it twice and places the cursor between). */
function wrap(mark: string): KeyBinding['run'] {
  return (view) => {
    view.dispatch(
      view.state.changeByRange((r) => {
        const text = view.state.sliceDoc(r.from, r.to);
        const already = text.startsWith(mark) && text.endsWith(mark) && text.length >= mark.length * 2;
        const insert = already ? text.slice(mark.length, -mark.length) : `${mark}${text}${mark}`;
        return {
          changes: { from: r.from, to: r.to, insert },
          range: r.empty ? EditorSelection.cursor(r.from + mark.length) : EditorSelection.range(r.from, r.from + insert.length),
        };
      }),
    );
    return true;
  };
}

const formatKeys: KeyBinding[] = [
  { key: 'Mod-b', run: wrap('**') },
  { key: 'Mod-i', run: wrap('*') },
  { key: 'Mod-Shift-h', run: wrap('==') },
  { key: 'Mod-Shift-x', run: wrap('~~') },
  { key: 'Mod-`', run: wrap('`') },
  {
    key: 'Mod-k',
    run: (view) => {
      view.dispatch(
        view.state.changeByRange((r) => {
          const text = view.state.sliceDoc(r.from, r.to);
          const insert = `[[${text}]]`;
          return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + insert.length - 2) };
        }),
      );
      return true;
    },
  },
  {
    key: 'Mod-l',
    run: (view) => {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const m = /^(\s*)([-*+] \[.\] |[-*+] )?/.exec(line.text)!;
      const marker = m[2] ?? '';
      const next = marker === '' ? '- [ ] ' : marker.includes('[') ? (marker.includes('[ ]') ? marker.replace('[ ]', '[x]') : marker.replace(/\[.\]/, '[ ]')) : '- [ ] ';
      view.dispatch({ changes: { from: line.from + m[1].length, to: line.from + m[1].length + marker.length, insert: next } });
      return true;
    },
  },
];

export const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)', fontFamily: 'var(--editor-font, var(--font-serif))', fontSize: 'var(--editor-size, 17px)' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'var(--editor-line, 28px)', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--honey-text)', padding: '0 0 40vh' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--honey-text)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--honey-soft) !important' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: 'var(--ink-faint)', fontStyle: 'italic' },
  '.cm-tooltip': { border: 'none', background: 'transparent' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-sans)', fontSize: '14px', background: 'var(--surface-raised)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: '4px', maxHeight: '320px', minWidth: '260px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 8px', borderRadius: 'var(--radius-sm)', color: 'var(--ink)', lineHeight: '20px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--honey-soft)', color: 'var(--ink)' },
  '.cm-completionDetail': { color: 'var(--ink-muted)', fontStyle: 'normal', marginLeft: '8px', fontSize: '12px' },
  '.cm-completionIcon': { display: 'none' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--honey-text)', fontWeight: '650' },
  '.cm-panels': { background: 'var(--surface-sunken)', color: 'var(--ink)', borderColor: 'var(--line)', fontFamily: 'var(--font-sans)', fontSize: '13px' },
  '.cm-searchMatch': { backgroundColor: 'var(--pollen)', color: 'var(--on-honey)', borderRadius: '2px' },
  '.cm-searchMatch-selected': { outline: '2px solid var(--honey-text)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--honey-soft)' },
});

export interface EditorHooks {
  sourcePath: () => string;
  onOpenLink: (target: string, subpath: string | undefined, newTab: boolean) => void;
  onOpenUrl: (url: string) => void;
  onTag: (tag: string) => void;
  onPasteFiles: (files: File[], view: EditorView) => void;
}

export function baseExtensions(hooks: EditorHooks, mode: 'live' | 'source', spellcheck: boolean, vim: Extension | null): Extension[] {
  return [
    vim ?? [],
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    closeBrackets(),
    search({ top: true }),
    highlightSelectionMatches(),
    autocompletion({ override: [basaltCompletions(hooks.sourcePath), slashCompletions], icons: false, activateOnTyping: true }),
    keymap.of([...formatKeys, ...closeBracketsKeymap, ...markdownKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true, extensions: [frontmatter] }),
    syntaxHighlighting(basaltHighlight),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: String(spellcheck), autocorrect: 'off', 'aria-label': 'Note editor' }),
    placeholder('Start writing. Type [[ to link a note.'),
    editorTheme,
    modeCompartment.of(mode === 'live' ? livePreview({ sourcePath: hooks.sourcePath }) : []),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        const el = (e.target as HTMLElement).closest<HTMLElement>('.cm-wikilink, .cm-link-external, .cm-tag');
        if (!el || e.button !== 0) return false;
        if (el.classList.contains('cm-tag')) {
          if (!(e.metaKey || e.ctrlKey)) return false;
          e.preventDefault();
          hooks.onTag(el.dataset.tag!);
          return true;
        }
        e.preventDefault();
        if (el.dataset.href) hooks.onOpenUrl(el.dataset.href);
        else hooks.onOpenLink(el.dataset.target ?? '', el.dataset.subpath || undefined, e.metaKey || e.ctrlKey);
        void view;
        return true;
      },
      paste(e, view) {
        const files = [...(e.clipboardData?.files ?? [])];
        if (!files.length) return false;
        e.preventDefault();
        hooks.onPasteFiles(files, view);
        return true;
      },
      drop(e, view) {
        const internal = e.dataTransfer?.getData('text/x-basalt-path');
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        if (internal) {
          e.preventDefault();
          const linktext = internal.replace(/\.md$/i, '');
          view.dispatch({ changes: { from: pos, insert: `[[${linktext}]]` }, selection: { anchor: pos + linktext.length + 4 } });
          return true;
        }
        const files = [...(e.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        e.preventDefault();
        view.dispatch({ selection: { anchor: pos } });
        hooks.onPasteFiles(files, view);
        return true;
      },
    }),
  ];
}

export { livePreview };
