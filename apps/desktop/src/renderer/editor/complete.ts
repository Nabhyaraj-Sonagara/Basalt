import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { fuzzyFilter } from '@basalt/core/browser';
import { getState } from '../lib/store';

/** Inserts link text and moves the cursor past the ]] (auto-closed or added). */
function linkApply(text: string) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const hasClose = view.state.sliceDoc(to, to + 2) === ']]';
    view.dispatch({ changes: { from, to, insert: hasClose ? text : text + ']]' }, selection: { anchor: from + text.length + 2 } });
  };
}

/** Suggests notes after `[[`, headings after `[[Note#`, blocks after `[[Note#^`, and tags after `#`. */
export function basaltCompletions(sourcePath: () => string) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const s = getState();
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);

    const wiki = /\[\[([^[\]|\n]*)$/.exec(before);
    if (wiki) {
      const inner = wiki[1];
      const hash = inner.indexOf('#');
      if (hash >= 0) {
        const target = inner.slice(0, hash);
        const path = target ? s.resolver.resolve(target, sourcePath()) : sourcePath();
        const note = path ? s.notesByPath.get(path) : undefined;
        if (!note) return null;
        const rest = inner.slice(hash + 1);
        const from = ctx.pos - rest.length;
        if (rest.startsWith('^')) {
          return {
            from: from + 1,
            options: note.blocks.map((b) => ({ label: b, type: 'constant', apply: linkApply(b) })),
          };
        }
        return {
          from,
          options: note.headings.map((h) => ({ label: h.text, detail: 'H' + h.level, type: 'property', apply: linkApply(h.text) })),
          validFor: /^[^\]#|]*$/,
        };
      }
      const from = ctx.pos - inner.length;
      const notes = s.hive?.notes ?? [];
      const attachments = (s.hive?.files ?? []).filter((f) => f.kind === 'file' && f.ext !== 'md').map((f) => f.path);
      const items: { path: string; title: string; alias?: string }[] = [
        ...notes.map((n) => ({ path: n.path, title: n.title })),
        ...notes.flatMap((n) => n.aliases.map((a) => ({ path: n.path, title: n.title, alias: a }))),
        ...attachments.map((p) => ({ path: p, title: p.slice(p.lastIndexOf('/') + 1) })),
      ];
      const hits = fuzzyFilter(inner, items, (i) => [i.alias ?? i.title, i.path], 40);
      const options: Completion[] = hits.map(({ item }) => {
        const linktext = s.resolver.linktextFor(item.path, sourcePath());
        return {
          label: item.alias ?? item.title,
          detail: item.alias ? `→ ${item.title}` : item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : undefined,
          type: item.path.endsWith('.md') ? 'text' : 'variable',
          apply: linkApply(item.alias ? `${linktext}|${item.alias}` : linktext),
        };
      });
      if (inner.trim() && !hits.some((h) => h.item.title.toLowerCase() === inner.trim().toLowerCase())) {
        options.push({ label: inner.trim(), detail: 'New note', type: 'keyword', apply: linkApply(inner.trim()), boost: -99 });
      }
      return { from, options, filter: false };
    }

    const tag = /(?:^|[\s(,;])#([\p{L}\p{N}_\-/]*)$/u.exec(before);
    if (tag && !/^#{1,6}$/.test(before.trim())) {
      const counts = new Map<string, number>();
      for (const n of s.hive?.notes ?? []) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      const hits = fuzzyFilter(tag[1], [...counts.keys()], (t) => t, 30);
      if (!hits.length) return null;
      return {
        from: ctx.pos - tag[1].length,
        options: hits.map((h) => ({ label: h.item, detail: String(counts.get(h.item)), type: 'keyword' })),
        filter: false,
      };
    }
    return null;
  };
}
