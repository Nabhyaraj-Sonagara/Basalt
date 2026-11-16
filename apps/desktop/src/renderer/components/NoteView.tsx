import { useEffect, useRef, useState } from 'react';
import { Tag, Button } from '@basalt/ui';
import { dirOf } from '@basalt/core/browser';
import { Editor } from './Editor';
import { api, consumeTitleFocus, openLink, renamePath, showSearch } from '../lib/actions';
import { hydrate, renderNoteHtml } from '../lib/render';
import { activeTab, setMode, type Tab } from '../lib/store-bridge';
import { useStore } from '../lib/store';

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function InlineTitle({ path }: { path: string }) {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '');
  const [value, setValue] = useState(base);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(base), [base]);
  useEffect(() => {
    if (consumeTitleFocus(path)) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [path]);
  const committed = useRef<string | null>(null);
  const commit = () => {
    const v = value.trim().replace(/[\\/:*?"<>|#^[\]]/g, '-');
    if (!v || v === base) return setValue(base);
    // Enter commits and then blur fires; rename only once.
    if (committed.current === v) return;
    committed.current = v;
    void renamePath(path, `${dirOf(path) ? dirOf(path) + '/' : ''}${v}.md`);
  };
  return (
    <input
      ref={ref}
      className="note-title"
      aria-label="Note title"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          (document.querySelector(`.editor-host[data-path="${CSS.escape(path)}"] .cm-content`) as HTMLElement | null)?.focus();
        }
        if (e.key === 'Escape') {
          setValue(base);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Reading({ path, line }: { path: string; line?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const version = useStore((s) => s.version);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api().hive.read(path).then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [path, version]);
  useEffect(() => {
    if (!ref.current || text == null) return;
    ref.current.innerHTML = renderNoteHtml(text, path);
    void hydrate(ref.current, path);
    if (line != null) ref.current.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'start' });
  }, [text, path, line]);
  return (
    <div
      ref={ref}
      className="reading prose"
      onClick={(e) => {
        const el = e.target as HTMLElement;
        const task = el.closest<HTMLElement>('.bs-task-cell[data-line]');
        if (task) {
          e.preventDefault();
          void api().hive.toggleTask(path, Number(task.dataset.line));
          return;
        }
        const tag = el.closest<HTMLElement>('[data-tag]');
        if (tag) {
          e.preventDefault();
          showSearch(`tag:#${tag.dataset.tag}`);
          return;
        }
        const link = el.closest<HTMLElement>('a[data-target], a[data-path], a[data-external]');
        if (link) {
          e.preventDefault();
          if (link.dataset.external) void api().app.openExternal(link.dataset.external);
          else {
            const owner = link.closest<HTMLElement>('.bs-embed[data-path]')?.dataset.path;
            void openLink(link.dataset.target || link.dataset.path || '', link.dataset.subpath || undefined, owner ?? path, { newTab: e.metaKey || e.ctrlKey });
          }
        }
      }}
    />
  );
}

export function NoteView({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const path = tab.path!;
  const note = useStore((s) => s.notesByPath.get(path));
  const readable = useStore((s) => s.hive?.info.settings.editor.readableLineLength ?? true);
  return (
    <div className={`note-view${readable ? ' readable' : ''}`}>
      <div className="note-scroll">
        <header className="note-head">
          <InlineTitle key={path} path={path} />
          <div className="note-meta">
            <span>{note ? `Edited ${ago(note.mtime)}` : ''}</span>
            {note ? <span>· {note.wordCount.toLocaleString()} words</span> : null}
            {note?.tags.slice(0, 6).map((t) => (
              <Tag key={t} onClick={() => showSearch(`tag:#${t}`)}>
                {t}
              </Tag>
            ))}
            <span className="note-mode">
              <Button size="sm" variant="quiet" aria-pressed={tab.mode === 'reading'} onClick={() => setMode(tab.mode === 'reading' ? 'live' : 'reading')}>
                {tab.mode === 'reading' ? 'Edit' : 'Read'}
              </Button>
            </span>
          </div>
        </header>
        {tab.mode === 'reading' ? <Reading path={path} line={tab.line} /> : <Editor key={tab.id} tabId={tab.id} path={path} mode={tab.mode} line={tab.line} focus={isActive && activeTab()?.id === tab.id} />}
      </div>
    </div>
  );
}
