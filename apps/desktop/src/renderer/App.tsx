import { useEffect, useState } from 'react';
import { Button } from '@basalt/ui';
import { Sidebar } from './components/Sidebar';
import { Pane } from './components/Pane';
import { RightPanel } from './components/RightPanel';
import { Palette } from './components/Palette';
import { Settings } from './components/Settings';
import { PromptDialog, RecoveryDialog } from './components/Dialogs';
import { HoverLayer } from './components/HoverLayer';
import { Toasts } from './components/Toasts';
import { StartScreen } from './components/StartScreen';
import { SYNC_TEXT, useSyncStatus } from './components/SyncSettings';
import { api, go, handleChanges, handleUri, makeTab, openHive, scheduleWorkspaceSave } from './lib/actions';
import { commandById, runHotkey } from './lib/commands';
import { activeTab, applySnapshot, setMode, getState, setState, toast, useStore } from './lib/store-all';
import type { UpdateStatus } from '../shared/api';

function StatusBar() {
  const tab = useStore((s) => activeTab(s));
  const note = useStore((s) => (tab?.path ? s.notesByPath.get(tab.path) : undefined));
  const selection = useStore((s) => s.selection);
  const [indexing, setIndexing] = useState<string | null>(null);
  useEffect(
    () =>
      api().ai.onIndexProgress(({ done, total }) => {
        setIndexing(done >= total ? null : `Indexing ${done}/${total}`);
      }),
    [],
  );
  const words = selection ? (selection.match(/\S+/g) ?? []).length : note?.wordCount;
  return (
    <footer className="status-bar">
      {indexing ? <span>{indexing}</span> : null}
      {note ? (
        <>
          <span>{note.headings.length ? `${note.headings.length} headings` : ''}</span>
          <span>
            {words?.toLocaleString()} {selection ? 'words selected' : 'words'}
          </span>
          <button
            className="status-btn"
            onClick={() => setMode(tab!.mode === 'source' ? 'live' : tab!.mode === 'live' ? 'reading' : 'source')}
            title="Switch between live preview, reading and source"
          >
            {tab!.mode === 'live' ? 'Live preview' : tab!.mode === 'reading' ? 'Reading' : 'Source'}
          </button>
        </>
      ) : null}
      <SyncIndicator />
    </footer>
  );
}

function SyncIndicator() {
  const s = useSyncStatus();
  if (!s?.linked) return <span className="status-ok">✓ Saved to disk</span>;
  const label = s.state === 'idle' ? '✓ Synced' : s.state === 'offline' ? 'Offline' : SYNC_TEXT[s.state];
  return (
    <button className={`status-btn sync-${s.state}`} title={s.error ?? SYNC_TEXT[s.state]} onClick={() => setState({ settingsOpen: 'sync' })}>
      {label}
    </button>
  );
}

function Workspace() {
  const panes = useStore((s) => s.panes);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const popout = useStore((s) => !!s.popout);
  useEffect(() => scheduleWorkspaceSave(), [leftOpen, rightOpen]);
  return (
    <div className={`workspace${leftOpen ? '' : ' no-left'}${rightOpen ? '' : ' no-right'}`}>
      {leftOpen ? <Sidebar /> : null}
      <main className="panes" style={{ gridTemplateColumns: `repeat(${panes.length}, minmax(0, 1fr))` }}>
        {panes.map((p) => (
          <Pane key={p.id} pane={p} />
        ))}
      </main>
      {rightOpen ? <RightPanel /> : null}
      <div className="edge-toggles" hidden={popout}>
        <Button size="sm" variant="quiet" icon="folder" aria-label={leftOpen ? 'Hide left sidebar' : 'Show left sidebar'} onClick={() => setState((s) => ({ leftOpen: !s.leftOpen }))} />
        <Button size="sm" variant="quiet" icon="backlinks" aria-label={rightOpen ? 'Hide right sidebar' : 'Show right sidebar'} onClick={() => setState((s) => ({ rightOpen: !s.rightOpen }))} />
      </div>
      <StatusBar />
    </div>
  );
}

function Snippets() {
  const snippets = useStore((s) => s.snippets);
  const enabled = useStore((s) => s.enabledSnippets);
  const css = snippets
    .filter((s) => enabled.includes(s.name))
    .map((s) => `/* ${s.name} */\n${s.css}`)
    .join('\n');
  return css ? <style data-snippets>{css}</style> : null;
}

let announced = '';
function announceUpdate(s: UpdateStatus) {
  if (getState().popout || !s.latest || announced === s.state + s.latest) return;
  if (s.state === 'ready') {
    announced = s.state + s.latest;
    toast({ tone: 'neutral', title: `Basalt ${s.latest} is ready`, body: 'It installs when you quit, or restart now.', action: { label: 'Restart', onClick: () => void api().app.installUpdate() } }, 0);
  } else if (s.state === 'available') {
    announced = s.state + s.latest;
    toast({ tone: 'neutral', title: `Basalt ${s.latest} is available`, action: { label: 'Download', onClick: () => void api().app.installUpdate() } }, 0);
  }
}

export function App() {
  const hasHive = useStore((s) => !!s.hive);
  const spellcheck = useStore((s) => !!s.hive?.info.settings.editor.spellcheck);
  useEffect(() => void api().app.setSpellcheck(spellcheck), [spellcheck]);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.theme = getState().theme;
    void api()
      .app.info()
      .then(async (info) => {
        if (info.popout) {
          // A pop-out window shows one note from the hive the main window has open.
          applySnapshot(await api().hive.snapshot());
          const tab = makeTab(info.popout);
          setState({ popout: info.popout, panes: [{ id: 'p1', tabs: [tab], active: tab.id }], activePane: 'p1', leftOpen: false, rightOpen: false });
          return;
        }
        const p = await api().app.initialHive();
        if (p) await openHive(p);
        const pending = await api().app.takePendingUri();
        if (pending) await handleUri(pending);
      })
      .finally(() => setBooting(false));
    const off = api().hive.onChange(handleChanges);
    const offUri = api().app.onUri((u) => void handleUri(u));
    const offCommand = api().app.onCommand((id) => void commandById(id)?.run());
    const offUpdate = api().app.onUpdate(announceUpdate);
    const onKey = (e: KeyboardEvent) => {
      if (getState().palette || getState().prompt) return;
      runHotkey(e);
    };
    window.addEventListener('keydown', onKey);
    // Mouse back/forward buttons navigate history.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        if (activeTab()) go(e.button === 3 ? -1 : 1);
      }
    };
    window.addEventListener('mouseup', onMouse);
    return () => {
      off();
      offUri();
      offCommand();
      offUpdate();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);

  if (booting) return <div className="boot" />;
  return (
    <>
      {hasHive ? <Workspace /> : <StartScreen />}
      <Snippets />
      <Palette />
      <Settings />
      <PromptDialog />
      <RecoveryDialog />
      <HoverLayer />
      <Toasts />
    </>
  );
}
