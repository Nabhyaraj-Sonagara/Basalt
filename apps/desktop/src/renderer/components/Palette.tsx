import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette, type PaletteItem } from '@basalt/ui';
import { applyTemplate, fuzzyFilter } from '@basalt/core/browser';
import { COMMANDS, formatHotkey, hotkeyFor } from '../lib/commands';
import { api, createNote, errorToast, mergeNotes, openPath, renamePath } from '../lib/actions';
import { activeTab, getState, noteTitle, setState, useStore } from '../lib/store';
import { editorFor } from './Editor';
import { addNoteToCanvas } from './CanvasView';

const NONE: NonNullable<ReturnType<typeof getState>['hive']>['notes'] = [];
const NONE_FILES: NonNullable<ReturnType<typeof getState>['hive']>['files'] = [];

interface Row extends PaletteItem {
  run: (opts: { newTab: boolean }) => void;
}

const RECENT_KEY = 'basalt.recentCommands';
function recentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function rememberCommand(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentCommands().filter((x) => x !== id)].slice(0, 6)));
  } catch {
    /* ignore */
  }
}

export function Palette() {
  const palette = useStore((s) => s.palette);
  const notes = useStore((s) => s.hive?.notes ?? NONE);
  const files = useStore((s) => s.hive?.files ?? NONE_FILES);
  const [index, setIndex] = useState(0);
  const [templates, setTemplates] = useState<string[]>([]);
  const wrap = useRef<HTMLDivElement>(null);

  // Focus before the next keystroke arrives, so fast typing lands in the palette.
  const isOpen = !!palette;
  const mode = palette?.mode;
  useLayoutEffect(() => {
    if (!isOpen) return;
    setIndex(0);
    wrap.current?.querySelector('input')?.focus();
    if (mode === 'templates') void api().hive.templates().then(setTemplates);
  }, [isOpen, mode]);

  const close = () => setState({ palette: null });
  const query = palette?.query ?? '';

  const rows: Row[] = useMemo(() => {
    if (!palette) return [];
    if (palette.mode === 'commands') {
      const avail = COMMANDS.filter((c) => c.id !== 'palette' && (!c.when || c.when()));
      const recent = recentCommands();
      const ordered = query.trim() ? avail : [...recent.map((id) => avail.find((c) => c.id === id)).filter(Boolean), ...avail.filter((c) => !recent.includes(c.id))];
      return fuzzyFilter(query, ordered as typeof avail, (c) => c.name, 60).map(({ item: c }) => ({
        icon: c.icon,
        label: c.name,
        shortcut: formatHotkey(hotkeyFor(c)) || undefined,
        run: () => {
          rememberCommand(c.id);
          void c.run();
        },
      }));
    }
    if (palette.mode === 'files') {
      const canvasTarget = palette.payload?.startsWith('canvas:') ? palette.payload.slice(7) : null;
      const items = [
        ...notes.map((n) => ({ path: n.path, label: n.title, alias: undefined as string | undefined, mtime: n.mtime })),
        ...notes.flatMap((n) => n.aliases.map((a) => ({ path: n.path, label: n.title, alias: a, mtime: n.mtime }))),
        ...files.filter((f) => f.kind === 'file' && !/\.(md|markdown)$/i.test(f.path)).map((f) => ({ path: f.path, label: f.path.slice(f.path.lastIndexOf('/') + 1), alias: undefined, mtime: f.mtime })),
      ];
      const pool = query.trim() ? items : [...items].sort((a, b) => b.mtime - a.mtime);
      const hits = fuzzyFilter(query, pool, (i) => [i.alias ?? i.label, i.path], 40);
      const out: Row[] = hits.map(({ item }) => ({
        icon: item.path.endsWith('.canvas') ? 'comb' : item.path.endsWith('.md') ? 'note' : 'highlight',
        label: item.alias ?? item.label,
        hint: item.alias ? `→ ${item.label}` : item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : undefined,
        run: ({ newTab }) => {
          if (canvasTarget) void addNoteToCanvas(canvasTarget, item.path).catch((e) => errorToast("Couldn't add it to the canvas", e));
          else openPath(item.path, { newTab });
        },
      }));
      const q = query.trim();
      if (q && !canvasTarget && !notes.some((n) => n.title.toLowerCase() === q.toLowerCase())) {
        out.push({
          icon: 'new-note',
          label: `Create “${q}”`,
          hint: 'New note',
          shortcut: formatHotkey('Shift+Enter'),
          run: async ({ newTab }) => {
            const p = await createNote(q, { exactPath: q.includes('/') });
            if (p) openPath(p, { newTab });
          },
        });
      }
      return out;
    }
    if (palette.mode === 'templates') {
      return fuzzyFilter(query, templates, (t) => t, 40).map(({ item }) => ({
        icon: 'note',
        label: noteTitle(item),
        run: async () => {
          const tab = activeTab();
          const view = tab ? editorFor(tab.id) : undefined;
          if (!tab?.path || !view) return;
          const s = getState().hive!.info.settings.templates;
          const text = applyTemplate(await api().hive.read(item), { title: noteTitle(tab.path) }, { date: s.dateFormat, time: s.timeFormat });
          const pos = view.state.selection.main.head;
          view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
          view.focus();
        },
      }));
    }
    if (palette.mode === 'merge') {
      const source = palette.payload!;
      const pool = notes.filter((n) => n.path !== source);
      return fuzzyFilter(query, query.trim() ? pool : [...pool].sort((a, b) => b.mtime - a.mtime), (n) => [n.title, n.path], 40).map(({ item }) => ({
        icon: 'note',
        label: item.title,
        hint: item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : undefined,
        run: () => void mergeNotes(source, item.path),
      }));
    }
    // move
    const from = palette.payload!;
    const folders = ['', ...files.filter((f) => f.kind === 'folder').map((f) => f.path)];
    return fuzzyFilter(query, folders, (f) => f || '/', 40).map(({ item }) => ({
      icon: 'folder',
      label: item || 'Hive root',
      run: () => void renamePath(from, `${item ? item + '/' : ''}${from.slice(from.lastIndexOf('/') + 1)}`),
    }));
  }, [palette, query, notes, files, templates]);

  useEffect(() => {
    wrap.current?.querySelector('.bs-palette-row-active')?.scrollIntoView({ block: 'nearest' });
  }, [index, rows]);

  if (!palette) return null;
  const placeholder =
    palette.mode === 'commands' ? 'Type a command' : palette.mode === 'files' ? (palette.payload ? 'Pick a note to add to the canvas' : 'Find or create a note') : palette.mode === 'templates' ? 'Pick a template' : palette.mode === 'merge' ? `Merge ${noteTitle(palette.payload!)} into…` : `Move ${noteTitle(palette.payload!)} to…`;
  const clamped = Math.min(index, Math.max(0, rows.length - 1));
  const choose = (i: number, newTab = false) => {
    const row = rows[i];
    close();
    if (row) void row.run({ newTab });
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={wrap}
        className="palette-wrap"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((clamped + 1) % Math.max(1, rows.length));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((clamped - 1 + rows.length) % Math.max(1, rows.length));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey && palette.mode === 'files') choose(rows.length - 1);
            else choose(clamped, e.metaKey || e.ctrlKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
        onClick={(e) => {
          const li = (e.target as HTMLElement).closest('li[role="option"]');
          if (!li) return;
          choose([...li.parentElement!.children].indexOf(li), e.metaKey || e.ctrlKey);
        }}
        onMouseMove={(e) => {
          const li = (e.target as HTMLElement).closest('li[role="option"]');
          if (li) {
            const i = [...li.parentElement!.children].indexOf(li);
            if (i !== clamped) setIndex(i);
          }
        }}
      >
        <CommandPalette
          query={query}
          placeholder={placeholder}
          onQueryChange={(e) => {
            setIndex(0);
            setState({ palette: { ...palette, query: e.target.value } });
          }}
          items={rows.length ? rows : [{ icon: 'info', label: 'Nothing matches' }]}
          activeIndex={clamped}
        />
      </div>
    </div>
  );
}
