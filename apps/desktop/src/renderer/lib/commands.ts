import type { IconName } from '@basalt/ui';
import {
  closeActiveTab,
  confirmTrash,
  go,
  newCanvas,
  newNote,
  openComb,
  openDailyNote,
  openRandomNote,
  openTable,
  openUniqueNote,
  promptNewFolder,
  promptRename,
  setMode,
  showSearch,
  splitPane,
  toggleBookmark,
  toggleReading,
  closeHive,
  copyNoteUri,
  extractSelection,
  openAnotherHive,
  openInNewWindow,
  api,
} from './actions';
import { editorFor } from '../components/Editor';
import { activeTab, getState, setState, setTheme } from './store';

export interface Command {
  id: string;
  name: string;
  icon?: IconName;
  hotkey?: string;
  /** Only shown when this returns true. */
  when?: () => boolean;
  run: () => void | Promise<void>;
}

const hasNote = () => activeTab()?.kind === 'note';
const hasFile = () => !!activeTab()?.path;

export const COMMANDS: Command[] = [
  { id: 'palette', name: 'Open command palette', icon: 'command', hotkey: 'Mod+P', run: () => setState({ palette: { mode: 'commands', query: '' } }) },
  { id: 'switcher', name: 'Open a note', icon: 'search', hotkey: 'Mod+O', run: () => setState({ palette: { mode: 'files', query: '' } }) },
  { id: 'new-note', name: 'New note', icon: 'new-note', hotkey: 'Mod+N', run: () => newNote() },
  { id: 'new-note-tab', name: 'New note in a new tab', icon: 'new-note', hotkey: 'Mod+Shift+N', run: () => newNote({ newTab: true }) },
  { id: 'new-canvas', name: 'New canvas', icon: 'comb', run: () => newCanvas() },
  { id: 'new-folder', name: 'New folder', icon: 'folder', run: () => promptNewFolder() },
  { id: 'daily', name: "Open today's daily note", icon: 'daily', hotkey: 'Mod+Shift+D', run: () => openDailyNote(0) },
  { id: 'daily-prev', name: "Open yesterday's daily note", icon: 'daily', run: () => openDailyNote(-1) },
  { id: 'daily-next', name: "Open tomorrow's daily note", icon: 'daily', run: () => openDailyNote(1) },
  { id: 'unique', name: 'New unique note', icon: 'new-note', run: () => openUniqueNote() },
  { id: 'template', name: 'Insert template', icon: 'note', hotkey: 'Mod+Shift+T', when: hasNote, run: () => setState({ palette: { mode: 'templates', query: '' } }) },
  { id: 'search', name: 'Search the hive', icon: 'search', hotkey: 'Mod+Shift+F', run: () => showSearch() },
  { id: 'comb', name: 'Open comb view', icon: 'comb', hotkey: 'Mod+G', run: () => openComb() },
  { id: 'table', name: 'Open a table of notes', icon: 'task', run: () => openTable() },
  { id: 'toggle-reading', name: 'Toggle reading view', icon: 'note', hotkey: 'Mod+E', when: hasNote, run: () => toggleReading() },
  { id: 'mode-live', name: 'Edit in live preview', icon: 'note', when: hasNote, run: () => setMode('live') },
  { id: 'mode-source', name: 'Edit as source', icon: 'note', when: hasNote, run: () => setMode('source') },
  { id: 'rename', name: 'Rename this note', icon: 'note', hotkey: 'F2', when: hasFile, run: () => promptRename(activeTab()!.path!) },
  { id: 'move', name: 'Move this note to another folder', icon: 'folder', when: hasFile, run: () => setState({ palette: { mode: 'move', query: '', payload: activeTab()!.path! } }) },
  { id: 'delete', name: 'Delete this note', icon: 'close', when: hasFile, run: () => confirmTrash(activeTab()!.path!) },
  { id: 'bookmark', name: 'Bookmark this note', icon: 'pin', hotkey: 'Mod+D', when: hasFile, run: () => toggleBookmark(activeTab()?.path ?? null) },
  { id: 'recovery', name: 'Open file recovery', icon: 'backlinks', when: hasNote, run: () => setState({ recoveryFor: activeTab()!.path }) },
  { id: 'random', name: 'Open a random note', icon: 'note', run: () => openRandomNote() },
  { id: 'close-tab', name: 'Close tab', icon: 'close', hotkey: 'Mod+W', run: () => closeActiveTab() },
  { id: 'split', name: 'Split right', icon: 'command', hotkey: 'Mod+\\', run: () => splitPane() },
  { id: 'back', name: 'Go back', icon: 'chevron', hotkey: 'Mod+Alt+ArrowLeft', run: () => go(-1) },
  { id: 'forward', name: 'Go forward', icon: 'chevron', hotkey: 'Mod+Alt+ArrowRight', run: () => go(1) },
  { id: 'left', name: 'Toggle left sidebar', icon: 'folder', hotkey: 'Mod+Shift+L', run: () => setState((s) => ({ leftOpen: !s.leftOpen })) },
  { id: 'right', name: 'Toggle right sidebar', icon: 'backlinks', hotkey: 'Mod+Shift+R', run: () => setState((s) => ({ rightOpen: !s.rightOpen })) },
  { id: 'backlinks', name: 'Show backlinks', icon: 'backlinks', run: () => setState({ rightOpen: true, rightView: 'backlinks' }) },
  { id: 'outline', name: 'Show outline', icon: 'note', run: () => setState({ rightOpen: true, rightView: 'outline' }) },
  { id: 'properties', name: 'Show properties', icon: 'tag', run: () => setState({ rightOpen: true, rightView: 'properties' }) },
  { id: 'related', name: 'Show related notes', icon: 'wikilink', run: () => setState({ rightOpen: true, rightView: 'related' }) },
  { id: 'assistant', name: 'Ask the assistant', icon: 'highlight', hotkey: 'Mod+J', run: () => {
    setState({ rightOpen: true, rightView: 'assistant' });
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('.assistant-input textarea')?.focus(), 40);
  } },
  { id: 'theme-comb', name: 'Use the Comb theme (light)', icon: 'settings', run: () => setTheme('comb') },
  { id: 'theme-basalt', name: 'Use the Basalt theme (dark)', icon: 'settings', run: () => setTheme('basalt') },
  { id: 'theme-toggle', name: 'Switch light and dark theme', icon: 'settings', run: () => setTheme(getState().theme === 'basalt' ? 'comb' : 'basalt') },
  { id: 'settings', name: 'Open settings', icon: 'settings', hotkey: 'Mod+,', run: () => setState({ settingsOpen: 'editor' }) },
  { id: 'hotkeys', name: 'Edit hotkeys', icon: 'settings', run: () => setState({ settingsOpen: 'hotkeys' }) },
  { id: 'agents', name: 'Connect an agent (MCP and CLI)', icon: 'command', run: () => setState({ settingsOpen: 'agents' }) },
  { id: 'open-window', name: 'Open this note in a new window', icon: 'note', when: hasFile, run: () => openInNewWindow(activeTab()?.path) },
  { id: 'copy-url', name: 'Copy Basalt link to this note', icon: 'wikilink', when: hasFile, run: () => copyNoteUri(activeTab()?.path) },
  { id: 'merge', name: 'Merge this note into another note', icon: 'note', when: hasNote, run: () => setState({ palette: { mode: 'merge', query: '', payload: activeTab()!.path! } }) },
  {
    id: 'extract',
    name: 'Extract selection to a new note',
    icon: 'new-note',
    when: hasNote,
    run: () => {
      const tab = activeTab();
      const view = tab ? editorFor(tab.id) : undefined;
      if (tab?.path && view) extractSelection(view, tab.path);
    },
  },
  { id: 'open-hive', name: 'Open another folder as a hive', icon: 'folder', run: () => openAnotherHive() },
  { id: 'check-updates', name: 'Check for updates', icon: 'settings', run: () => {
    void api().app.checkForUpdates();
    setState({ settingsOpen: 'about' });
  } },
  // Sent by the menu bar after it starts a check; not listed in the palette.
  { id: 'show-updates', name: 'Show updates', when: () => false, run: () => setState({ settingsOpen: 'about' }) },
  { id: 'close-hive', name: 'Close this hive', icon: 'folder', run: () => closeHive() },
];

export function commandById(id: string): Command | undefined {
  return COMMANDS.find((c) => c.id === id);
}

export function hotkeyFor(cmd: Command): string | undefined {
  const custom = getState().hotkeys[cmd.id];
  return custom === '' ? undefined : (custom ?? cmd.hotkey);
}

const isMac = navigator.platform.toLowerCase().includes('mac');

/** Turns a keyboard event into "Mod+Shift+K" form. */
export function eventToHotkey(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.code.startsWith('Key')) key = e.code.slice(3);
  if (e.code.startsWith('Digit')) key = e.code.slice(5);
  if (key === ' ') key = 'Space';
  parts.push(key);
  return parts.join('+');
}

export function formatHotkey(hk?: string): string {
  if (!hk) return '';
  return hk
    .split('+')
    .map((p) => (p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'Shift' ? (isMac ? '⇧' : 'Shift') : p === 'Alt' ? (isMac ? '⌥' : 'Alt') : p.replace('Arrow', '')))
    .join(isMac ? '' : '+');
}

export function runHotkey(e: KeyboardEvent): boolean {
  const hk = eventToHotkey(e);
  if (!hk) return false;
  const cmd = COMMANDS.find((c) => hotkeyFor(c) === hk && (!c.when || c.when()));
  if (!cmd) return false;
  e.preventDefault();
  e.stopPropagation();
  void cmd.run();
  return true;
}
