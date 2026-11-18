import { useEffect, useRef, useState } from 'react';
import { Button } from '@basalt/ui';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { closeBrackets } from '@codemirror/autocomplete';
import { html } from '@codemirror/lang-html';
import { api, errorToast } from '../lib/actions';
import { noteTitle, updateTab, useStore, type Tab } from '../lib/store';
import { PAGE_SANDBOX, pageUrl } from '../lib/pages';

/** The HTML behind a page, in a code editor that saves as you type. */
function PageSource({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saved = useRef('');
  const timer = useRef<number | null>(null);
  useEffect(() => {
    let live = true;
    const flush = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const text = view.current?.state.doc.toString();
      if (text == null || text === saved.current) return;
      saved.current = text;
      void api().hive.write(path, text).catch((e) => errorToast("Couldn't save the page", e));
    };
    void api()
      .hive.read(path)
      .then((text) => {
        if (!live || !host.current) return;
        saved.current = text;
        view.current = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: text,
            extensions: [
              lineNumbers(),
              history(),
              drawSelection(),
              highlightActiveLine(),
              indentOnInput(),
              bracketMatching(),
              closeBrackets(),
              syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
              html(),
              EditorView.lineWrapping,
              keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
              EditorView.updateListener.of((u) => {
                if (!u.docChanged) return;
                if (timer.current) clearTimeout(timer.current);
                timer.current = window.setTimeout(flush, 400);
              }),
            ],
          }),
        });
        view.current.focus();
      });
    return () => {
      live = false;
      flush();
      view.current?.destroy();
      view.current = null;
    };
  }, [path]);
  return <div ref={host} className="page-source" data-path={path} />;
}

export function PageView({ tab, paneId }: { tab: Tab; paneId: string }) {
  const path = tab.path!;
  const editing = tab.mode === 'source';
  // Reload the preview when the page file itself changes (assets: use Reload).
  const mtime = useStore((s) => s.hive?.files.find((f) => f.path === path)?.mtime ?? 0);
  const [nonce, setNonce] = useState(0);
  return (
    <div className="page-view">
      <div className="page-bar">
        <span className="page-title">{noteTitle(path)}</span>
        <span className="page-note">Runs offline in a sandbox</span>
        <span className="grow" />
        {editing ? null : (
          <Button size="sm" variant="quiet" onClick={() => setNonce((n) => n + 1)}>
            Reload
          </Button>
        )}
        <Button size="sm" variant="quiet" onClick={() => updateTab(paneId, tab.id, { mode: editing ? 'reading' : 'source' })}>
          {editing ? 'Preview' : 'Edit HTML'}
        </Button>
      </div>
      {editing ? (
        <PageSource key={path} path={path} />
      ) : (
        <iframe key={`${mtime}:${nonce}`} className="page-frame" sandbox={PAGE_SANDBOX} src={pageUrl(path)} title={noteTitle(path)} />
      )}
    </div>
  );
}
