import { startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { getState, setState } from '../lib/store';

interface SlashItem {
  label: string;
  detail?: string;
  /** Text to insert; `|` marks where the cursor goes. */
  insert?: string;
  /** Inserted at the start of a line (adds a line break if the line isn't empty). */
  block?: boolean;
  run?: (view: EditorView, from: number, to: number) => void;
}

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function openCompletion(prefix: string) {
  return (view: EditorView, from: number, to: number) => {
    const hasClose = view.state.sliceDoc(to, to + 2) === ']]';
    view.dispatch({ changes: { from, to, insert: hasClose ? prefix : prefix + ']]' }, selection: { anchor: from + prefix.length } });
    startCompletion(view);
  };
}

const ITEMS: SlashItem[] = [
  { label: 'Heading 1', detail: '#', insert: '# |', block: true },
  { label: 'Heading 2', detail: '##', insert: '## |', block: true },
  { label: 'Heading 3', detail: '###', insert: '### |', block: true },
  { label: 'Task', detail: '- [ ]', insert: '- [ ] |', block: true },
  { label: 'Bulleted list', detail: '-', insert: '- |', block: true },
  { label: 'Numbered list', detail: '1.', insert: '1. |', block: true },
  { label: 'Quote', detail: '>', insert: '> |', block: true },
  { label: 'Callout', detail: '> [!note]', insert: '> [!note]\n> |', block: true },
  { label: 'Table', detail: '| |', insert: '| | |\n| --- | --- |\n| | |', block: true },
  { label: 'Code block', detail: '```', insert: '```\n|\n```', block: true },
  { label: 'Math block', detail: '$$', insert: '$$\n|\n$$', block: true },
  { label: 'Divider', detail: '---', insert: '---\n|', block: true },
  { label: 'Link to note', detail: '[[', run: openCompletion('[[') },
  { label: 'Embed', detail: '![[', run: openCompletion('![[') },
  {
    label: 'Insert template',
    run: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: '' } });
      setState({ palette: { mode: 'templates', query: '' } });
    },
  },
  { label: "Today's date", detail: today(), insert: '' },
];

function apply(item: SlashItem) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    if (item.run) return item.run(view, from, to);
    let text = item.label === "Today's date" ? today() + '|' : item.insert!;
    const line = view.state.doc.lineAt(from);
    if (item.block && view.state.sliceDoc(line.from, from).trim()) text = '\n' + text;
    const cursor = text.indexOf('|');
    text = text.replace('|', '');
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + cursor } });
  };
}

/** Typing `/` at the start of a line or after a space offers things to insert. */
export function slashCompletions(ctx: CompletionContext): CompletionResult | null {
  if (getState().hive?.info.settings.editor.slashCommands === false) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const m = /(?:^|\s)\/([\p{L}\p{N} ']{0,20})$/u.exec(before);
  if (!m || /\s{2}$/.test(m[1])) return null;
  const from = ctx.pos - m[1].length - 1;
  return {
    from,
    options: ITEMS.map((item) => ({ label: '/' + item.label, displayLabel: item.label, detail: item.detail, type: 'keyword', apply: apply(item) })),
    validFor: /^\/[\p{L}\p{N} ']*$/u,
  };
}
