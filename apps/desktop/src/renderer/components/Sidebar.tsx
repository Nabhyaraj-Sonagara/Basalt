import { LabeledToggle } from './LabeledToggle';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, HexAvatar, Icon, SearchField, Tag, TreeItem, EmptyState, type IconName } from '@basalt/ui';
import { dirOf, isNote, type SearchResult, type TreeNode } from '@basalt/core/browser';
import type { SemanticHit } from '@basalt/ai/types-only';
import {
  api,
  bookmarkSearch,
  confirmTrash,
  newNote,
  openComb,
  openDailyNote,
  openPath,
  promptNewFolder,
  promptRename,
  removeBookmark,
  renamePath,
  showSearch,
  toggleBookmark,
  isBookmarked,
  errorToast,
  closeHive,
} from '../lib/actions';
import { activeTab, setState, useStore, type LeftView } from '../lib/store';
import { ContextMenu, type MenuItem } from './ContextMenu';

function displayName(n: TreeNode): string {
  return n.kind === 'file' && isNote(n.path) ? n.name.replace(/\.(md|markdown)$/i, '') : n.name;
}

function iconFor(n: TreeNode): IconName {
  if (n.kind === 'folder') return 'folder';
  if (n.ext === 'canvas') return 'comb';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf'].includes(n.ext)) return 'highlight';
  return 'note';
}

function FileTree() {
  const tree = useStore((s) => s.hive?.tree);
  const expanded = useStore((s) => s.expanded);
  const current = useStore((s) => activeTab(s)?.path ?? null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Reveal the open note's folder.
  useEffect(() => {
    if (!current) return;
    let d = dirOf(current);
    const add: string[] = [];
    while (d) {
      if (!expanded.has(d)) add.push(d);
      d = dirOf(d);
    }
    if (add.length) setState((s) => ({ expanded: new Set([...s.expanded, ...add]) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!tree) return null;
  const toggle = (p: string) =>
    setState((s) => {
      const next = new Set(s.expanded);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return { expanded: next };
    });

  const menuFor = (n: TreeNode): MenuItem[] =>
    n.kind === 'folder'
      ? [
          { label: 'New note here', icon: 'new-note', run: () => void newNote({ folder: n.path }) },
          { label: 'New folder here', icon: 'folder', run: () => promptNewFolder(n.path) },
          { label: 'Rename', run: () => promptRename(n.path) },
          { label: 'Show in system folder', run: () => void api().app.showInFolder(n.path) },
          { label: 'Delete', danger: true, run: () => confirmTrash(n.path) },
        ]
      : [
          { label: 'Open in new tab', run: () => openPath(n.path, { newTab: true }) },
          { label: 'Open to the right', run: () => openPath(n.path, { newPane: true }) },
          { label: isBookmarked(n.path) ? 'Remove bookmark' : 'Bookmark', icon: 'pin', run: () => toggleBookmark(n.path) },
          { label: 'Rename', run: () => promptRename(n.path) },
          { label: 'Move to…', icon: 'folder', run: () => setState({ palette: { mode: 'move', query: '', payload: n.path } }) },
          { label: 'Show in system folder', run: () => void api().app.showInFolder(n.path) },
          { label: 'Delete', danger: true, run: () => confirmTrash(n.path) },
        ];

  const rows: JSX.Element[] = [];
  const walk = (n: TreeNode, depth: number) => {
    for (const c of n.children ?? []) {
      const open = expanded.has(c.path);
      const count = c.kind === 'folder' ? c.children?.filter((x) => x.kind === 'file').length : undefined;
      rows.push(
        <div
          key={c.path}
          className={`tree-row${dropTarget === c.path ? ' drop-target' : ''}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/x-basalt-path', c.path);
            e.dataTransfer.effectAllowed = 'copyMove';
          }}
          onDragOver={(e) => {
            if (c.kind !== 'folder' || !e.dataTransfer.types.includes('text/x-basalt-path')) return;
            e.preventDefault();
            setDropTarget(c.path);
          }}
          onDragLeave={() => setDropTarget((d) => (d === c.path ? null : d))}
          onDrop={(e) => {
            setDropTarget(null);
            const from = e.dataTransfer.getData('text/x-basalt-path');
            if (!from || c.kind !== 'folder' || from === c.path || c.path.startsWith(from + '/')) return;
            e.preventDefault();
            void renamePath(from, `${c.path}/${from.slice(from.lastIndexOf('/') + 1)}`);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, items: menuFor(c) });
          }}
        >
          <TreeItem
            kind={c.kind === 'folder' ? 'folder' : 'note'}
            icon={c.kind === 'file' ? iconFor(c) : undefined}
            label={displayName(c)}
            depth={depth}
            open={open}
            count={count || undefined}
            active={c.path === current}
            onClick={(e) => (c.kind === 'folder' ? toggle(c.path) : openPath(c.path, { newTab: e.metaKey || e.ctrlKey }))}
          />
        </div>,
      );
      if (c.kind === 'folder' && open) walk(c, depth + 1);
    }
  };
  walk(tree, 0);

  return (
    <div
      className={`file-tree${dropTarget === '' ? ' drop-target' : ''}`}
      role="tree"
      aria-label="Notes"
      onDragOver={(e) => {
        if (e.target === e.currentTarget && e.dataTransfer.types.includes('text/x-basalt-path')) {
          e.preventDefault();
          setDropTarget('');
        }
      }}
      onDrop={(e) => {
        if (e.target !== e.currentTarget) return;
        setDropTarget(null);
        const from = e.dataTransfer.getData('text/x-basalt-path');
        if (from && dirOf(from)) void renamePath(from, from.slice(from.lastIndexOf('/') + 1));
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'New note', icon: 'new-note', run: () => void newNote({ folder: '' }) }, { label: 'New folder', icon: 'folder', run: () => promptNewFolder('') }] });
      }}
    >
      {rows.length ? rows : <EmptyState compact icon="note" title="Nothing in this cell yet">Create a note to start your hive.</EmptyState>}
      {menu ? <ContextMenu {...menu} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

/** Strips Markdown syntax from an excerpt for display in result lists. */
export function plainSnippet(s: string): string {
  return s
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)#{1,6}\s/g, '$1')
    .replace(/[*_~=`]{1,3}/g, '')
    .replace(/^\s*[-*+]\s(\[.\]\s)?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: JSX.Element[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a < at) return;
    parts.push(<span key={`t${i}`}>{text.slice(at, a)}</span>);
    parts.push(<mark key={`m${i}`}>{text.slice(a, b)}</mark>);
    at = b;
  });
  parts.push(<span key="end">{text.slice(at)}</span>);
  return <>{parts}</>;
}

function SearchPane() {
  const query = useStore((s) => s.searchQuery);
  const version = useStore((s) => s.version);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [semantic, setSemantic] = useState<SemanticHit[] | null>(null);
  const [byMeaning, setByMeaning] = useState(false);
  const [busy, setBusy] = useState(false);
  const focusReq = useStore((s) => s.searchFocus);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (focusReq) box.current?.querySelector('input')?.focus();
  }, [focusReq]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        setSemantic(null);
        return;
      }
      setBusy(true);
      try {
        if (byMeaning) {
          const hits = await api().ai.semanticSearch(query);
          if (live) setSemantic(hits);
        } else {
          const r = await api().hive.search(query);
          if (live) {
            setResults(r);
            setSemantic(null);
          }
        }
      } catch (err) {
        errorToast('Search failed', err);
      } finally {
        if (live) setBusy(false);
      }
    }, byMeaning ? 350 : 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, byMeaning, version]);

  return (
    <div className="search-pane">
      <div className="side-search" ref={box}>
        <SearchField placeholder={byMeaning ? 'Describe what you are looking for' : 'Search, e.g. tag:#idea "exact words"'} value={query} shortcut={null} onChange={(e) => setState({ searchQuery: e.target.value })} />
      </div>
      <div className="search-options">
        <LabeledToggle label="By meaning" checked={byMeaning} onChange={setByMeaning} />
        <span className="spacer" />
        <Button size="sm" variant="quiet" icon="pin" aria-label="Bookmark this search" disabled={!query.trim()} onClick={() => bookmarkSearch(query)} />
      </div>
      <div className="search-results" aria-busy={busy}>
        {semantic
          ? semantic.map((h) => (
              <button key={h.path} className="result" onClick={() => openPath(h.path, { line: h.line })}>
                <span className="result-title">{h.title}</span>
                {h.heading ? <span className="result-sub">{h.heading}</span> : null}
                <span className="result-line clamp">{plainSnippet(h.snippet)}</span>
              </button>
            ))
          : results.map((r) => (
              <div key={r.path} className="result-group">
                <button className="result-title-btn" onClick={() => openPath(r.path)}>
                  <Icon name="note" size={14} /> <span className="result-title">{r.title}</span>
                  <span className="result-count">{r.matches.length || ''}</span>
                </button>
                {r.matches.map((m) => (
                  <button key={m.line} className="result-line" onClick={() => openPath(r.path, { line: m.line })}>
                    <Highlighted text={m.text.trim().slice(0, 200)} ranges={m.ranges.map(([a, b]) => [a - (m.text.length - m.text.trimStart().length), b - (m.text.length - m.text.trimStart().length)] as [number, number])} />
                  </button>
                ))}
              </div>
            ))}
        {query.trim() && !busy && !(semantic ?? results).length ? <p className="muted pad">No notes match. Try fewer words{byMeaning ? '' : ', or turn on By meaning'}.</p> : null}
        {!query.trim() ? (
          <div className="search-help">
            <p>Operators</p>
            <code>file:</code> <code>path:</code> <code>tag:#idea</code> <code>"exact phrase"</code> <code>-exclude</code> <code>a OR b</code> <code>/regex/</code> <code>line:(a b)</code>{' '}
            <code>section:(…)</code> <code>task-todo:</code> <code>[status:active]</code> <code>[rating:&gt;3]</code>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface TagNode {
  name: string;
  full: string;
  count: number;
  children: Map<string, TagNode>;
}

function TagsPane() {
  const notes = useStore((s) => s.hive?.notes);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const root = useMemo(() => {
    const r: TagNode = { name: '', full: '', count: 0, children: new Map() };
    for (const n of notes ?? []) {
      const seen = new Set<string>();
      for (const t of n.tags) {
        let node = r;
        const parts = t.split('/');
        parts.forEach((p, i) => {
          const full = parts.slice(0, i + 1).join('/');
          if (!node.children.has(p)) node.children.set(p, { name: p, full, count: 0, children: new Map() });
          node = node.children.get(p)!;
          if (!seen.has(full)) {
            seen.add(full);
            node.count++;
          }
        });
      }
    }
    return r;
  }, [notes]);
  const rows: JSX.Element[] = [];
  const walk = (n: TagNode, depth: number) => {
    for (const c of [...n.children.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))) {
      rows.push(
        <div key={c.full} className="tag-row" style={{ paddingLeft: 8 + depth * 16 }}>
          {c.children.size ? (
            <button className="caret" aria-label={open.has(c.full) ? 'Collapse' : 'Expand'} onClick={() => setOpen((o) => new Set(o.has(c.full) ? [...o].filter((x) => x !== c.full) : [...o, c.full]))}>
              <Icon name="chevron" size={12} className={open.has(c.full) ? 'rot90' : ''} />
            </button>
          ) : (
            <span className="caret" />
          )}
          <Tag count={c.count} onClick={() => showSearch(`tag:#${c.full}`)}>
            {c.name}
          </Tag>
        </div>,
      );
      if (open.has(c.full)) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return <div className="tags-pane">{rows.length ? rows : <EmptyState compact icon="tag" title="No tags yet">Add #tags to notes to group them.</EmptyState>}</div>;
}

function BookmarksPane() {
  const bookmarks = useStore((s) => s.bookmarks);
  if (!bookmarks.length)
    return (
      <EmptyState compact icon="pin" title="No bookmarks yet">
        Bookmark notes and searches you come back to.
      </EmptyState>
    );
  return (
    <div className="bookmarks">
      {bookmarks.map((b, i) => (
        <div key={i} className="bookmark-row">
          <TreeItem
            label={b.title}
            icon={b.type === 'search' ? 'search' : 'pin'}
            onClick={() => (b.type === 'search' ? showSearch(b.query) : b.path && openPath(b.path))}
          />
          <Button size="sm" variant="quiet" icon="close" aria-label={`Remove bookmark ${b.title}`} onClick={() => removeBookmark(i)} />
        </div>
      ))}
    </div>
  );
}

const VIEWS: { id: LeftView; icon: IconName; label: string }[] = [
  { id: 'files', icon: 'folder', label: 'Files' },
  { id: 'search', icon: 'search', label: 'Search' },
  { id: 'tags', icon: 'tag', label: 'Tags' },
  { id: 'bookmarks', icon: 'pin', label: 'Bookmarks' },
];

export function Sidebar() {
  const hive = useStore((s) => s.hive);
  const view = useStore((s) => s.leftView);
  const ref = useRef<HTMLElement>(null);
  if (!hive) return null;
  return (
    <nav className="sidebar" ref={ref} aria-label="Hive">
      <div className="hive-head">
        <HexAvatar name={hive.info.name} size={28} />
        <div className="hive-name">
          <b title={hive.info.root}>{hive.info.name}</b>
          <small>Hive · {hive.notes.length} notes</small>
        </div>
        <Button size="sm" variant="quiet" icon="chevron" aria-label="Switch hive" onClick={() => void closeHive()} />
      </div>
      <div className="side-actions">
        <Button size="sm" variant="quiet" icon="new-note" aria-label="New note" title="New note" onClick={() => void newNote()} />
        <Button size="sm" variant="quiet" icon="folder" aria-label="New folder" title="New folder" onClick={() => promptNewFolder()} />
        <Button size="sm" variant="quiet" icon="daily" aria-label="Today's daily note" title="Today's daily note" onClick={() => void openDailyNote()} />
        <Button size="sm" variant="quiet" icon="comb" aria-label="Comb view" title="Comb view" onClick={() => openComb()} />
        <Button size="sm" variant="quiet" icon="command" aria-label="Command palette" title="Command palette" onClick={() => setState({ palette: { mode: 'commands', query: '' } })} />
        <span className="spacer" />
        <Button size="sm" variant="quiet" icon="settings" aria-label="Settings" title="Settings" onClick={() => setState({ settingsOpen: 'editor' })} />
      </div>
      <div className="side-views" role="tablist" aria-label="Sidebar views">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className={`side-view${view === v.id ? ' on' : ''}`} title={v.label} onClick={() => (v.id === 'search' ? showSearch() : setState({ leftView: v.id }))}>
            <Icon name={v.icon} size={16} label={v.label} />
          </button>
        ))}
      </div>
      <div className="side-body">
        {view === 'files' ? <FileTree /> : view === 'search' ? <SearchPane /> : view === 'tags' ? <TagsPane /> : <BookmarksPane />}
      </div>
    </nav>
  );
}
