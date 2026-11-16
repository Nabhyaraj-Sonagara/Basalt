import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions, livePreview, modeCompartment } from '../editor/setup';
import { api, errorToast, openLink, showSearch } from '../lib/actions';
import { getState, setState, useStore } from '../lib/store';
import { refreshEffect } from '../editor/livePreview';
import { splitFrontmatter } from '@basalt/core/browser';

const views = new Map<string, EditorView>();

/** The CodeMirror view of a tab, for commands that edit the active note. */
export function editorFor(tabId: string): EditorView | undefined {
  return views.get(tabId);
}

interface Props {
  tabId: string;
  path: string;
  mode: 'live' | 'source';
  line?: number;
  focus?: boolean;
}

export function Editor({ tabId, path, mode, line, focus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pathRef = useRef(path);
  const pendingSave = useRef<number | null>(null);
  const lastSaved = useRef<string>('');

  const flush = () => {
    const view = viewRef.current;
    if (pendingSave.current == null || !view) return;
    clearTimeout(pendingSave.current);
    pendingSave.current = null;
    const text = view.state.doc.toString();
    if (text === lastSaved.current) return;
    lastSaved.current = text;
    api()
      .hive.write(pathRef.current, text)
      .catch((err) => errorToast("Couldn't save the note. Your text is still here; Basalt will try again on the next edit.", err));
  };

  // Create the editor once per tab; swap documents when the path changes.
  useEffect(() => {
    let cancelled = false;
    const settings = getState().hive?.info.settings.editor;
    const start = async () => {
      const text = await api().hive.read(path).catch(() => '');
      if (cancelled || !host.current) return;
      lastSaved.current = text;
      pathRef.current = path;
      const state = EditorState.create({
        doc: text,
        extensions: [
          baseExtensions(
            {
              sourcePath: () => pathRef.current,
              onOpenLink: (target, subpath, newTab) => void openLink(target, subpath, pathRef.current, { newTab }),
              onOpenUrl: (url) => void api().app.openExternal(url),
              onTag: (tag) => showSearch(`tag:#${tag}`),
              onPasteFiles: async (files, view) => {
                for (const f of files) {
                  try {
                    const saved = await api().hive.saveAttachment(f.name || `Pasted ${Date.now()}.png`, new Uint8Array(await f.arrayBuffer()));
                    const name = saved.slice(saved.lastIndexOf('/') + 1);
                    const pos = view.state.selection.main.head;
                    view.dispatch({ changes: { from: pos, insert: `![[${name}]]\n` }, selection: { anchor: pos + name.length + 6 } });
                  } catch (err) {
                    errorToast(`Couldn't add ${f.name}`, err);
                  }
                }
              },
            },
            mode,
            !!settings?.spellcheck,
            null,
          ),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              if (pendingSave.current != null) clearTimeout(pendingSave.current);
              pendingSave.current = window.setTimeout(flush, 350);
            }
            if (u.selectionSet || u.docChanged) {
              const sel = u.state.selection.main;
              const selected = sel.empty ? '' : u.state.sliceDoc(sel.from, sel.to);
              if (selected !== getState().selection) setState({ selection: selected });
            }
          }),
        ],
      });
      const view = new EditorView({ state, parent: host.current });
      viewRef.current = view;
      views.set(tabId, view);
      if (settings?.vimMode) {
        const { vim } = await import('@replit/codemirror-vim').catch(() => ({ vim: null as never }));
        if (vim) view.dispatch({ effects: modeCompartment.reconfigure([vim(), mode === 'live' ? livePreview({ sourcePath: () => pathRef.current }) : []]) });
      }
      if (line != null) scrollToLine(view, line);
      else {
        // Start after the frontmatter so properties stay collapsed.
        const body = splitFrontmatter(text).bodyStart;
        view.dispatch({ selection: { anchor: Math.min(body, view.state.doc.length) } });
        // Don't take focus from the title of a note that was just created.
        if (focus && !document.activeElement?.classList.contains('note-title')) view.focus();
      }
    };
    void start();
    return () => {
      cancelled = true;
      flush();
      viewRef.current?.destroy();
      viewRef.current = null;
      views.delete(tabId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: modeCompartment.reconfigure(mode === 'live' ? livePreview({ sourcePath: () => pathRef.current }) : []) });
  }, [mode]);

  useEffect(() => {
    if (line != null && viewRef.current) scrollToLine(viewRef.current, line);
  }, [line]);

  // Pick up changes made outside this editor (agents, the CLI, sync, another pane).
  useEffect(
    () =>
      api().hive.onChange((changes) => {
        const view = viewRef.current;
        if (!view || !changes.some((c) => c.path === pathRef.current && c.type === 'modify')) return;
        if (pendingSave.current != null) return;
        void api()
          .hive.read(pathRef.current)
          .then((text) => {
            const current = view.state.doc.toString();
            if (text === current) return;
            lastSaved.current = text;
            const head = Math.min(view.state.selection.main.head, text.length);
            view.dispatch({ changes: { from: 0, to: current.length, insert: text }, selection: { anchor: head } });
          });
      }),
    [],
  );

  // Re-decorate when the hive's link targets change (a note was created or renamed).
  const version = useStore((s) => s.version);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshEffect.of(null) });
  }, [version]);

  return <div ref={host} className="editor-host" data-path={path} />;
}

function scrollToLine(view: EditorView, line: number) {
  const l = view.state.doc.line(Math.min(Math.max(1, line + 1), view.state.doc.lines));
  view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 60 }) });
  view.focus();
}
