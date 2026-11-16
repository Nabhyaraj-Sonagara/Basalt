import { dirOf, extOf, isNote } from '@basalt/core/browser';
import type { HiveChange } from '../../shared/api';
import {
  activePane,
  activeTab,
  applySnapshot,
  getState,
  newTabId,
  noteTitle,
  setState,
  toast,
  updateTab,
  viewKindFor,
  type Bookmark,
  type EditMode,
  type PaneState,
  type Tab,
} from './store';

export const api = () => window.basalt;

export function errorToast(title: string, err: unknown): void {
  toast({ tone: 'danger', title, body: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) }, 8000);
}

// ---------- hive lifecycle ----------

export async function openHive(path: string, create = false): Promise<void> {
  try {
    const snap = await api().app.openHive(path, { create });
    applySnapshot(snap);
    const [bookmarks, workspace, hotkeys, snippets, appearance] = await Promise.all([
      api().hive.readConfig<Bookmark[]>('bookmarks.json'),
      api().hive.readConfig<{ panes: PaneState[]; activePane: string; leftView?: string; rightView?: string }>('workspace.json'),
      api().hive.readConfig<Record<string, string>>('hotkeys.json'),
      api().hive.snippets(),
      api().hive.readConfig<{ enabledSnippets?: string[] }>('appearance.json'),
    ]);
    const files = new Set(snap.files.map((f) => f.path));
    let panes = workspace?.panes
      ?.map((p) => ({ ...p, tabs: p.tabs.filter((t) => !t.path || files.has(t.path) || t.kind === 'comb' || t.kind === 'table').map((t) => ({ ...t, id: newTabId() })) }))
      .filter((p) => p.tabs.length);
    if (!panes?.length) {
      const welcome = snap.notes.find((n) => /^(welcome|start here|readme)\.md$/i.test(n.path))?.path ?? snap.notes[0]?.path ?? null;
      panes = [{ id: 'p1', tabs: [makeTab(welcome)], active: '' }];
    }
    panes = panes.map((p) => ({ ...p, active: p.tabs[p.tabs.length - 1].id }));
    setState({
      panes,
      activePane: panes[0].id,
      bookmarks: bookmarks ?? [],
      hotkeys: hotkeys ?? {},
      snippets,
      enabledSnippets: appearance?.enabledSnippets ?? [],
      expanded: new Set(),
      ...(workspace?.leftView ? { leftView: workspace.leftView as never } : {}),
      ...(workspace?.rightView ? { rightView: workspace.rightView as never } : {}),
    });
  } catch (err) {
    errorToast("Couldn't open that folder", err);
  }
}

export async function closeHive(): Promise<void> {
  await api().app.closeHive();
  setState({ hive: null, notesByPath: new Map() });
}

let refreshTimer: number | null = null;
export function refreshSnapshot(): void {
  if (refreshTimer) return;
  refreshTimer = window.setTimeout(async () => {
    refreshTimer = null;
    if (!getState().hive) return;
    applySnapshot(await api().hive.snapshot());
  }, 60);
}

export function handleChanges(changes: HiveChange[]): void {
  for (const c of changes) {
    if (c.type === 'rename') {
      const remap = (p: string | null) => (p && (p === c.oldPath || p.startsWith(c.oldPath + '/')) ? c.path + p.slice(c.oldPath.length) : p);
      setState((s) => ({ panes: s.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => ({ ...t, path: remap(t.path), history: t.history.map((h) => remap(h)!) })) })) }));
    } else if (c.type === 'delete') {
      const gone = (p: string | null) => !!p && (p === c.path || p.startsWith(c.path + '/'));
      setState((s) => ({
        panes: s.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (gone(t.path) ? { ...t, kind: 'empty', path: null } : t)) })),
      }));
    }
  }
  refreshSnapshot();
  scheduleWorkspaceSave();
}

let saveTimer: number | null = null;
export function scheduleWorkspaceSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = getState();
    if (!s.hive) return;
    void api().hive.writeConfig('workspace.json', {
      panes: s.panes.map((p) => ({ ...p, tabs: p.tabs.filter((t) => t.kind !== 'empty' || p.tabs.length === 1).map(({ line: _l, ...t }) => t) })),
      activePane: s.activePane,
      leftView: s.leftView,
      rightView: s.rightView,
    });
  }, 600);
}

// ---------- tabs and navigation ----------

export function makeTab(path: string | null, mode?: EditMode): Tab {
  const defaultMode = getState().hive?.info.settings.editor.defaultMode ?? 'live';
  return {
    id: newTabId(),
    kind: path ? viewKindFor(path) : 'empty',
    path,
    mode: mode ?? defaultMode,
    history: path ? [path] : [],
    hIndex: path ? 0 : -1,
  };
}

export interface OpenOptions {
  newTab?: boolean;
  newPane?: boolean;
  line?: number;
  paneId?: string;
}

/** Opens a hive path in the active tab (or a new tab/pane). */
export function openPath(path: string, opts: OpenOptions = {}): void {
  const s = getState();
  if (opts.newPane) {
    splitPane(path);
    return;
  }
  const pane = s.panes.find((p) => p.id === (opts.paneId ?? s.activePane)) ?? activePane(s);
  const current = pane.tabs.find((t) => t.id === pane.active);
  if (!opts.newTab) {
    const existing = pane.tabs.find((t) => t.path === path);
    if (existing && existing.id !== current?.id && !current?.path) {
      // Prefer focusing an already-open tab when the current one is empty.
      setState({ panes: s.panes.map((p) => (p.id === pane.id ? { ...p, active: existing.id, tabs: p.tabs.filter((t) => t.id !== current?.id) } : p)), activePane: pane.id });
      return;
    }
  }
  if (opts.newTab || !current || current.pinned) {
    const tab = { ...makeTab(path), line: opts.line };
    setState({ panes: s.panes.map((p) => (p.id === pane.id ? { ...p, tabs: [...p.tabs, tab], active: tab.id } : p)), activePane: pane.id });
  } else {
    const history = [...current.history.slice(0, current.hIndex + 1), path];
    updateTab(pane.id, current.id, { path, kind: viewKindFor(path), history, hIndex: history.length - 1, line: opts.line, mode: current.kind === 'note' ? current.mode : makeTab(path).mode });
    setState({ activePane: pane.id });
  }
  scheduleWorkspaceSave();
}

/** Opens link text from a note: resolves it, scrolls to a heading or block, or offers to create it. */
export async function openLink(target: string, subpath: string | undefined, sourcePath: string, opts: OpenOptions = {}): Promise<void> {
  const s = getState();
  const path = target ? s.resolver.resolve(target, sourcePath) : sourcePath;
  if (!path) {
    const created = await createNote(target.replace(/\.md$/i, ''), { folder: newNoteFolder(sourcePath), exactPath: target.includes('/') });
    if (created) openPath(created, opts);
    return;
  }
  let line: number | undefined;
  if (subpath) {
    const note = s.notesByPath.get(path);
    const sub = subpath.replace(/^#/, '');
    if (sub.startsWith('^')) {
      const text = await api().hive.read(path);
      const idx = text.split('\n').findIndex((l) => new RegExp(`\\^${sub.slice(1)}\\s*$`).test(l));
      if (idx >= 0) line = idx;
    } else {
      const last = sub.split('#').pop()!.toLowerCase();
      line = note?.headings.find((h) => h.text.toLowerCase() === last)?.line;
    }
  }
  openPath(path, { ...opts, line });
}

function newNoteFolder(nearPath?: string): string {
  const s = getState();
  const configured = s.hive?.info.settings.newNotes.folder ?? '';
  if (configured === '.' || configured === '/') return dirOf(nearPath ?? '');
  return configured;
}

export async function createNote(name = 'Untitled', opts: { folder?: string; exactPath?: boolean; text?: string; template?: string } = {}): Promise<string | null> {
  try {
    const folder = opts.folder ?? newNoteFolder(activeTab()?.path ?? '');
    const path = opts.exactPath || !folder ? `${name}` : `${folder}/${name}`;
    const created = await api().hive.create(isNote(path) || extOf(path) === 'canvas' ? path : `${path}.md`, opts.text ?? '', opts.template);
    refreshSnapshot();
    return created;
  } catch (err) {
    errorToast("Couldn't create the note", err);
    return null;
  }
}

export async function newNote(opts: { folder?: string; newTab?: boolean } = {}): Promise<void> {
  const path = await createNote('Untitled', { folder: opts.folder });
  if (path) {
    openPath(path, { newTab: opts.newTab });
    pendingTitleFocus = path;
  }
}

/** Set when a fresh note should open with its title selected for renaming. */
export let pendingTitleFocus: string | null = null;
export function consumeTitleFocus(path: string): boolean {
  if (pendingTitleFocus === path) {
    pendingTitleFocus = null;
    return true;
  }
  return false;
}

export async function newCanvas(): Promise<void> {
  const path = await createNote('Untitled.canvas', { folder: newNoteFolder(activeTab()?.path ?? '') });
  if (path) openPath(path);
}

export function closeTab(paneId: string, tabId: string): void {
  setState((s) => {
    let panes = s.panes.map((p) => {
      if (p.id !== paneId) return p;
      const idx = p.tabs.findIndex((t) => t.id === tabId);
      const tabs = p.tabs.filter((t) => t.id !== tabId);
      const active = p.active === tabId ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? '') : p.active;
      return { ...p, tabs, active };
    });
    // A pane with no tabs closes, unless it's the last one.
    if (panes.length > 1) panes = panes.filter((p) => p.tabs.length);
    panes = panes.map((p) => (p.tabs.length ? p : (() => {
      const t = makeTab(null);
      return { ...p, tabs: [t], active: t.id };
    })()));
    const activePaneId = panes.some((p) => p.id === s.activePane) ? s.activePane : panes[0].id;
    return { panes, activePane: activePaneId };
  });
  scheduleWorkspaceSave();
}

export function closeActiveTab(): void {
  const p = activePane();
  closeTab(p.id, p.active);
}

export function splitPane(path?: string | null): void {
  const s = getState();
  const tab = makeTab(path ?? activeTab()?.path ?? null);
  if (s.panes.length >= 3) {
    openPath(tab.path ?? '', { newTab: true, paneId: s.panes[s.panes.length - 1].id });
    return;
  }
  const pane: PaneState = { id: `p${Date.now()}`, tabs: [tab], active: tab.id };
  setState({ panes: [...s.panes, pane], activePane: pane.id });
  scheduleWorkspaceSave();
}

export function go(delta: -1 | 1): void {
  const pane = activePane();
  const tab = activeTab();
  if (!tab) return;
  const i = tab.hIndex + delta;
  if (i < 0 || i >= tab.history.length) return;
  const path = tab.history[i];
  updateTab(pane.id, tab.id, { hIndex: i, path, kind: viewKindFor(path), line: undefined });
}

export function setMode(mode: EditMode): void {
  const pane = activePane();
  const tab = activeTab();
  if (tab?.kind === 'note') updateTab(pane.id, tab.id, { mode });
}

export function toggleReading(): void {
  const tab = activeTab();
  if (tab?.kind === 'note') setMode(tab.mode === 'reading' ? (getState().hive?.info.settings.editor.defaultMode === 'source' ? 'source' : 'live') : 'reading');
}

export function openComb(): void {
  const s = getState();
  const pane = activePane(s);
  const existing = pane.tabs.find((t) => t.kind === 'comb');
  if (existing) {
    setState({ panes: s.panes.map((p) => (p.id === pane.id ? { ...p, active: existing.id } : p)) });
    return;
  }
  const tab: Tab = { id: newTabId(), kind: 'comb', path: null, mode: 'live', history: [], hIndex: -1 };
  setState({ panes: s.panes.map((p) => (p.id === pane.id ? { ...p, tabs: [...p.tabs, tab], active: tab.id } : p)) });
}

export function openTable(query = '[status]'): void {
  const s = getState();
  const pane = activePane(s);
  const tab: Tab = { id: newTabId(), kind: 'table', path: null, mode: 'live', history: [], hIndex: -1, query };
  setState({ panes: s.panes.map((p) => (p.id === pane.id ? { ...p, tabs: [...p.tabs, tab], active: tab.id } : p)) });
}

// ---------- file operations ----------

export function promptRename(path: string): void {
  const isFolder = getState().hive?.files.find((f) => f.path === path)?.kind === 'folder';
  const base = path.slice(path.lastIndexOf('/') + 1);
  const shown = isNote(path) ? base.replace(/\.(md|markdown)$/i, '') : base;
  setState({
    prompt: {
      title: isFolder ? 'Rename folder' : 'Rename note',
      label: 'New name',
      value: shown,
      confirm: 'Rename',
      onSubmit: (value) => void renamePath(path, `${dirOf(path) ? dirOf(path) + '/' : ''}${value.trim()}${isNote(path) && !/\.(md|markdown)$/i.test(value) ? '.md' : ''}`),
    },
  });
}

export async function renamePath(from: string, to: string): Promise<void> {
  if (!to || from === to) return;
  try {
    const res = await api().hive.rename(from, to);
    if (res.updated.length) toast({ tone: 'success', title: `Updated links in ${res.updated.length} note${res.updated.length === 1 ? '' : 's'}` });
  } catch (err) {
    errorToast(`Couldn't rename ${noteTitle(from)}`, err);
  }
}

export function confirmTrash(path: string): void {
  setState({
    prompt: {
      title: `Delete ${noteTitle(path)}?`,
      message: 'It moves to the hive’s trash in .basalt/trash, so you can get it back.',
      label: '',
      value: '',
      confirm: 'Delete',
      danger: true,
      onSubmit: async () => {
        try {
          await api().hive.trash(path);
          toast({ tone: 'neutral', title: `Moved ${noteTitle(path)} to trash` });
        } catch (err) {
          errorToast("Couldn't delete it", err);
        }
      },
    },
  });
}

export function promptNewFolder(parent = ''): void {
  setState({
    prompt: {
      title: 'New folder',
      label: 'Folder name',
      value: 'New folder',
      confirm: 'Create',
      onSubmit: async (value) => {
        try {
          const p = await api().hive.createFolder(`${parent ? parent + '/' : ''}${value.trim()}`);
          setState((s) => ({ expanded: new Set([...s.expanded, p]) }));
        } catch (err) {
          errorToast("Couldn't create the folder", err);
        }
      },
    },
  });
}

export async function openDailyNote(offsetDays = 0): Promise<void> {
  try {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const path = await api().hive.dailyNote(d.toISOString());
    refreshSnapshot();
    openPath(path);
  } catch (err) {
    errorToast("Couldn't open the daily note", err);
  }
}

export async function openUniqueNote(): Promise<void> {
  const path = await api().hive.uniqueNote();
  refreshSnapshot();
  openPath(path);
}

export function openRandomNote(): void {
  const notes = getState().hive?.notes ?? [];
  if (!notes.length) return;
  openPath(notes[Math.floor(Math.random() * notes.length)].path);
}

// ---------- bookmarks ----------

export function isBookmarked(path: string | null): boolean {
  return !!path && getState().bookmarks.some((b) => b.type === 'file' && b.path === path);
}

export function toggleBookmark(path: string | null): void {
  if (!path) return;
  const s = getState();
  const bookmarks = isBookmarked(path) ? s.bookmarks.filter((b) => !(b.type === 'file' && b.path === path)) : [...s.bookmarks, { type: 'file' as const, path, title: noteTitle(path) }];
  setState({ bookmarks });
  void api().hive.writeConfig('bookmarks.json', bookmarks);
}

export function bookmarkSearch(query: string): void {
  if (!query.trim()) return;
  const bookmarks = [...getState().bookmarks, { type: 'search' as const, query, title: query }];
  setState({ bookmarks });
  void api().hive.writeConfig('bookmarks.json', bookmarks);
}

export function removeBookmark(i: number): void {
  const bookmarks = getState().bookmarks.filter((_, j) => j !== i);
  setState({ bookmarks });
  void api().hive.writeConfig('bookmarks.json', bookmarks);
}

export function showSearch(query?: string): void {
  setState((s) => ({ leftOpen: true, leftView: 'search', searchQuery: query ?? s.searchQuery, searchFocus: s.searchFocus + 1 }));
}
