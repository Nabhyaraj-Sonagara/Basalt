import { useRef, useSyncExternalStore } from 'react';
import { LinkResolver, extOf, isNote } from '@basalt/core/browser';
import type { HiveSnapshot, NoteSummary } from '../../shared/api';

export type ViewKind = 'note' | 'canvas' | 'comb' | 'image' | 'pdf' | 'file' | 'empty' | 'search' | 'table';
export type EditMode = 'live' | 'source' | 'reading';

export interface Tab {
  id: string;
  kind: ViewKind;
  path: string | null;
  mode: EditMode;
  pinned?: boolean;
  history: string[];
  hIndex: number;
  /** Line to scroll to on open. */
  line?: number;
  /** Mind-map notes: show the Markdown instead of the map. */
  mapText?: boolean;
  /** For table views: the query. */
  query?: string;
}

export interface PaneState {
  id: string;
  tabs: Tab[];
  active: string;
}

export type LeftView = 'files' | 'search' | 'tags' | 'bookmarks';
export type RightView = 'backlinks' | 'outline' | 'properties' | 'comb' | 'related' | 'assistant';
export type Theme = 'comb' | 'basalt' | 'auto';

export interface Toast {
  id: number;
  tone: 'neutral' | 'success' | 'progress' | 'danger';
  title: string;
  body?: string;
  progress?: number;
  action?: { label: string; onClick: () => void };
}

export interface Bookmark {
  type: 'file' | 'search' | 'heading';
  path?: string;
  query?: string;
  subpath?: string;
  title: string;
}

export type PaletteMode = 'commands' | 'files' | 'templates' | 'move' | 'merge';

export interface PromptState {
  title: string;
  label: string;
  value: string;
  confirm: string;
  danger?: boolean;
  multiline?: boolean;
  /** Plain confirmation, no input. */
  message?: string;
  onSubmit: (value: string) => void;
}

export interface State {
  hive: HiveSnapshot | null;
  notesByPath: Map<string, NoteSummary>;
  resolver: LinkResolver;
  version: number;
  panes: PaneState[];
  activePane: string;
  leftView: LeftView;
  leftOpen: boolean;
  rightView: RightView;
  rightOpen: boolean;
  theme: Theme;
  palette: { mode: PaletteMode; query: string; payload?: string } | null;
  settingsOpen: string | null;
  recoveryFor: string | null;
  /** The Illustrate dialog: what to start from. */
  illustrate: { source: 'note' | 'sketch' | 'picture'; kind?: 'mindmap' | 'flowchart' | 'sequence' | 'chart' } | null;
  toasts: Toast[];
  prompt: PromptState | null;
  bookmarks: Bookmark[];
  searchQuery: string;
  /** Bumped to ask the search box to take focus. */
  searchFocus: number;
  selection: string;
  hotkeys: Record<string, string>;
  expanded: Set<string>;
  snippets: { name: string; css: string }[];
  enabledSnippets: string[];
  /** This hive's own icon (emoji) and colour, from .basalt/appearance.json. */
  hiveIdentity: { icon?: string; color?: string };
  /** In a pop-out window: the note it shows. Pop-outs don't save the workspace layout. */
  popout: string | null;
}

let tabSeq = 0;
export const newTabId = () => `t${++tabSeq}`;

function emptyTab(): Tab {
  return { id: newTabId(), kind: 'empty', path: null, mode: 'live', history: [], hIndex: -1 };
}

const firstPane: PaneState = (() => {
  const t = emptyTab();
  return { id: 'p1', tabs: [t], active: t.id };
})();

let state: State = {
  hive: null,
  notesByPath: new Map(),
  resolver: new LinkResolver(),
  version: 0,
  panes: [firstPane],
  activePane: 'p1',
  leftView: 'files',
  leftOpen: true,
  rightView: 'backlinks',
  rightOpen: true,
  theme: ((): Theme => {
    try {
      return (localStorage.getItem('basalt.theme') as Theme) || 'comb';
    } catch {
      return 'comb';
    }
  })(),
  palette: null,
  settingsOpen: null,
  recoveryFor: null,
  illustrate: null,
  toasts: [],
  prompt: null,
  bookmarks: [],
  searchQuery: '',
  searchFocus: 0,
  selection: '',
  hotkeys: {},
  expanded: new Set(),
  snippets: [],
  enabledSnippets: [],
  hiveIdentity: {},
  popout: null,
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Subscribes a component to part of the store. The selected value is cached per store state,
 * so selectors that build new arrays or objects (for example `s.hive?.notes ?? []`) don't make
 * React think the store changed on every read, which would loop and blank the window.
 */
export function useStore<T>(sel: (s: State) => T): T {
  const cache = useRef<{ state: State; sel: (s: State) => T; value: T } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const c = cache.current;
    if (c && c.state === state && c.sel === sel) return c.value;
    const value = sel(state);
    // Same state, new selector function (an inline arrow re-created on render): keep the old value if it's equivalent.
    if (c && c.state === state && shallowEqual(c.value, value)) {
      cache.current = { state, sel, value: c.value };
      return c.value;
    }
    cache.current = { state, sel, value };
    return value;
  });
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  return false;
}

export function applySnapshot(snap: HiveSnapshot): void {
  const resolver = new LinkResolver(
    snap.files.filter((f) => f.kind === 'file').map((f) => f.path),
    snap.notes.map((n) => [n.path, n.aliases] as [string, string[]]),
  );
  setState((s) => ({ hive: snap, notesByPath: new Map(snap.notes.map((n) => [n.path, n])), resolver, version: s.version + 1 }));
}

export function viewKindFor(path: string): ViewKind {
  const ext = extOf(path);
  if (isNote(path)) return 'note';
  if (ext === 'canvas') return 'canvas';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

export function activePane(s = state): PaneState {
  return s.panes.find((p) => p.id === s.activePane) ?? s.panes[0];
}

export function activeTab(s = state): Tab | undefined {
  const p = activePane(s);
  return p.tabs.find((t) => t.id === p.active);
}

export function updateTab(paneId: string, tabId: string, patch: Partial<Tab>): void {
  setState((s) => ({
    panes: s.panes.map((p) => (p.id !== paneId ? p : { ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) })),
  }));
}

let toastSeq = 0;
export function toast(t: Omit<Toast, 'id'>, ms = 4500): number {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
  if (ms > 0) setTimeout(() => dismissToast(id), ms);
  return id;
}
export function dismissToast(id: number): void {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
export function updateToast(id: number, patch: Partial<Toast>): void {
  setState((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

export function noteTitle(path: string | null): string {
  if (!path) return 'New tab';
  const n = state.notesByPath.get(path);
  if (n) return n.title;
  const base = path.slice(path.lastIndexOf('/') + 1);
  return isNote(path) ? base.replace(/\.(md|markdown)$/i, '') : base;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem('basalt.theme', theme);
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = theme;
  setState({ theme });
}
