import { useEffect, useState } from 'react';
import { Tabs, EmptyState, Button, Kbd, SearchField } from '@basalt/ui';
import { NoteView } from './NoteView';
import { CanvasView } from './CanvasView';
import { GlobalComb } from './CombView';
import { api, closeTab, newNote, openPath, scheduleWorkspaceSave } from '../lib/actions';
import { formatHotkey } from '../lib/commands';
import { getState, noteTitle, setState, updateTab, useStore, type PaneState, type Tab } from '../lib/store';
import type { QueryRow } from '@basalt/core/browser';

function tabTitle(t: Tab): string {
  if (t.kind === 'comb') return 'Comb';
  if (t.kind === 'table') return 'Table';
  if (t.kind === 'empty') return 'New tab';
  return noteTitle(t.path);
}

function EmptyTab() {
  const recent = useStore((s) => [...(s.hive?.notes ?? [])].sort((a, b) => b.mtime - a.mtime).slice(0, 5));
  return (
    <div className="empty-tab">
      <EmptyState
        title="Nothing in this cell yet"
        pattern
        actions={
          <>
            <Button variant="primary" icon="new-note" onClick={() => void newNote()}>
              New note
            </Button>
            <Button variant="secondary" icon="search" onClick={() => setState({ palette: { mode: 'files', query: '' } })}>
              Open a note <Kbd>{formatHotkey('Mod+O')}</Kbd>
            </Button>
          </>
        }
      >
        Start a note, or pick up where you left off.
      </EmptyState>
      {recent.length ? (
        <ul className="recent-notes">
          {recent.map((n) => (
            <li key={n.path}>
              <button onClick={() => openPath(n.path)}>{n.title}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TableView({ tab, paneId }: { tab: Tab; paneId: string }) {
  const version = useStore((s) => s.version);
  const props = useStore((s) => s.hive?.notes.length);
  const [rows, setRows] = useState<QueryRow[]>([]);
  const [query, setQuery] = useState(tab.query ?? '');
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'title', desc: false });
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void api().hive.query({ where: query, sort: sort.key, desc: sort.desc }).then((r) => live && setRows(r)), 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, sort, version, props]);
  const cols = ['title', ...new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => k !== 'title' && k !== 'path'))].slice(0, 9);
  const fmt = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <div className="table-view">
      <div className="view-toolbar">
        <SearchField
          placeholder='Filter, e.g. [status:active] tag:#project'
          value={query}
          shortcut={null}
          onChange={(e) => {
            setQuery(e.target.value);
            updateTab(paneId, tab.id, { query: e.target.value });
            scheduleWorkspaceSave();
          }}
        />
        <span className="muted">{rows.length} notes</span>
      </div>
      <div className="table-scroll">
        <table className="props-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} aria-sort={sort.key === c ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                  <button onClick={() => setSort((s) => ({ key: c, desc: s.key === c ? !s.desc : false }))}>
                    {c === 'title' ? 'Note' : c}
                    {sort.key === c ? (sort.desc ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path}>
                {cols.map((c) => (
                  <td key={c}>{c === 'title' ? <a href="#" className="bs-link bs-link-internal" onClick={(e) => (e.preventDefault(), openPath(r.path))}>{r.title}</a> : fmt(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <EmptyState compact icon="task" title="No notes match">Try a property filter like [status] or a tag like tag:#project.</EmptyState> : null}
      </div>
    </div>
  );
}

function FileView({ tab }: { tab: Tab }) {
  const url = window.basalt.hive.fileUrl(tab.path!);
  if (tab.kind === 'image')
    return (
      <div className="media-view">
        <img src={url} alt={noteTitle(tab.path)} />
      </div>
    );
  if (tab.kind === 'pdf') return <iframe className="pdf-view" src={url} title={noteTitle(tab.path)} />;
  return (
    <EmptyState title="Basalt can't show this file" icon="note" actions={<Button onClick={() => void api().app.showInFolder(tab.path!)}>Show in folder</Button>}>
      {tab.path}
    </EmptyState>
  );
}

function View({ tab, paneId, isActive }: { tab: Tab; paneId: string; isActive: boolean }) {
  switch (tab.kind) {
    case 'note':
      return <NoteView tab={tab} isActive={isActive} />;
    case 'canvas':
      return <CanvasView path={tab.path!} />;
    case 'comb':
      return <GlobalComb />;
    case 'table':
      return <TableView tab={tab} paneId={paneId} />;
    case 'image':
    case 'pdf':
    case 'file':
      return <FileView tab={tab} />;
    default:
      return <EmptyTab />;
  }
}

export function Pane({ pane }: { pane: PaneState }) {
  const isActive = useStore((s) => s.activePane === pane.id);
  const multi = useStore((s) => s.panes.length > 1);
  useStore((s) => s.notesByPath); // re-render titles after renames
  const active = pane.tabs.find((t) => t.id === pane.active) ?? pane.tabs[0];
  return (
    <section
      className={`pane${isActive && multi ? ' pane-active' : ''}`}
      onMouseDownCapture={() => getState().activePane !== pane.id && setState({ activePane: pane.id })}
      aria-label="Editor pane"
    >
      <div
        className="pane-tabs"
        onMouseDown={(e) => {
          // Middle-click or the tab's close mark closes it.
          const tabEl = (e.target as HTMLElement).closest<HTMLElement>('.bs-tab');
          const onClose = !!(e.target as HTMLElement).closest('.bs-tab-close');
          if (tabEl && (e.button === 1 || (e.button === 0 && onClose))) {
            e.preventDefault();
            e.stopPropagation();
            const idx = [...tabEl.parentElement!.children].indexOf(tabEl);
            const t = pane.tabs[idx];
            if (t) closeTab(pane.id, t.id);
          }
        }}
      >
        <Tabs
          tabs={pane.tabs.map((t) => ({ id: t.id, title: tabTitle(t), pinned: t.pinned }))}
          active={active?.id}
          onSelect={(id) => {
            setState((s) => ({ panes: s.panes.map((p) => (p.id === pane.id ? { ...p, active: id } : p)), activePane: pane.id }));
            scheduleWorkspaceSave();
          }}
        />
        <div className="pane-tab-actions">
          {active ? (
            <Button size="sm" variant="quiet" icon="close" aria-label="Close tab" onClick={() => closeTab(pane.id, active.id)} />
          ) : null}
          <Button
            size="sm"
            variant="quiet"
            icon="new-note"
            aria-label="New tab"
            onClick={() => {
              const t: Tab = { id: `t${Date.now()}`, kind: 'empty', path: null, mode: 'live', history: [], hIndex: -1 };
              setState((s) => ({ panes: s.panes.map((p) => (p.id === pane.id ? { ...p, tabs: [...p.tabs, t], active: t.id } : p)), activePane: pane.id }));
            }}
          />
        </div>
      </div>
      <div className="pane-body">{active ? <View key={active.id} tab={active} paneId={pane.id} isActive={isActive} /> : null}</div>
    </section>
  );
}
