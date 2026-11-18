import { useEffect, useState } from 'react';
import { Button, Kbd, Select, SettingRow, SettingsGroup, Toggle, Icon } from '@basalt/ui';
import type { HiveSettings } from '@basalt/core/browser';
import type { AiSettings, ProviderSettings, UpdateStatus } from '../../shared/api';
import { SyncSection } from './SyncSettings';
import { PluginSettings } from './PluginSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { ConnectApps, QuickStart } from './ConnectSettings';
import { COMMANDS, eventToHotkey, formatHotkey, hotkeyFor } from '../lib/commands';
import { api, errorToast, saveHiveAppearance } from '../lib/actions';
import { getState, setState, setTheme, toast, updateToast, dismissToast, useStore } from '../lib/store';

const SECTIONS = [
  { id: 'editor', label: 'Editor' },
  { id: 'files', label: 'Files and links' },
  { id: 'daily', label: 'Daily notes and templates' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'agents', label: 'AI apps and agents' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'sync', label: 'Sync' },
  { id: 'about', label: 'About and updates' },
];

function useHiveSettings(): [HiveSettings, (patch: Partial<HiveSettings>) => void] {
  const settings = useStore((s) => s.hive!.info.settings);
  const save = (patch: Partial<HiveSettings>) => {
    void api()
      .hive.saveSettings(patch)
      .then((next) => setState((s) => ({ hive: s.hive && { ...s.hive, info: { ...s.hive.info, settings: next } } })))
      .catch((e) => errorToast("Couldn't save settings", e));
  };
  return [settings, save];
}

function TextSetting({ value, onSave, placeholder, label }: { value: string; onSave: (v: string) => void; placeholder?: string; label: string }) {
  return <input className="setting-input" aria-label={label} defaultValue={value} key={value} placeholder={placeholder} onBlur={(e) => e.target.value !== value && onSave(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

function EditorSection() {
  const [s, save] = useHiveSettings();
  return (
    <SettingsGroup title="Editor">
      <SettingRow label="Default view for new tabs" description="Live preview hides Markdown syntax until your cursor reaches it.">
        <Select value={s.editor.defaultMode} options={[{ value: 'live', label: 'Live preview' }, { value: 'source', label: 'Source' }, { value: 'reading', label: 'Reading' }]} onChange={(e) => save({ editor: { ...s.editor, defaultMode: e.target.value as 'live' } })} />
      </SettingRow>
      <SettingRow label="Readable line length" description="Keep lines to about 68 characters.">
        <Toggle checked={s.editor.readableLineLength} onChange={(v) => save({ editor: { ...s.editor, readableLineLength: v } })} />
      </SettingRow>
      <SettingRow label="Spellcheck" description="Right-click a misspelled word for suggestions.">
        <Toggle checked={s.editor.spellcheck} onChange={(v) => save({ editor: { ...s.editor, spellcheck: v } })} />
      </SettingRow>
      <SettingRow label="Slash commands" description="Type / to insert headings, tasks, callouts, tables, links and templates.">
        <Toggle checked={s.editor.slashCommands !== false} onChange={(v) => save({ editor: { ...s.editor, slashCommands: v } })} />
      </SettingRow>
      <SettingRow label="Vim key bindings" description="Applies to notes opened after the change.">
        <Toggle checked={s.editor.vimMode} onChange={(v) => save({ editor: { ...s.editor, vimMode: v } })} />
      </SettingRow>
    </SettingsGroup>
  );
}

function FilesSection() {
  const [s, save] = useHiveSettings();
  return (
    <SettingsGroup title="Files and links">
      <SettingRow label="Folder for new notes" description="Leave empty for the hive root.">
        <TextSetting label="Folder for new notes" value={s.newNotes.folder} onSave={(v) => save({ newNotes: { folder: v } })} />
      </SettingRow>
      <SettingRow label="Folder for attachments" description="Pasted and dropped files go here.">
        <TextSetting label="Folder for attachments" value={s.attachments.folder} onSave={(v) => save({ attachments: { folder: v } })} />
      </SettingRow>
      <SettingRow label="Update links when renaming" description="Rewrites every link to a note you rename or move.">
        <Toggle checked={s.links.updateOnRename} onChange={(v) => save({ links: { ...s.links, updateOnRename: v } })} />
      </SettingRow>
      <SettingRow label="File recovery snapshots" description="How often to keep a copy of a note while you edit it, in minutes.">
        <TextSetting label="Snapshot interval" value={String(s.snapshots.intervalMinutes)} onSave={(v) => save({ snapshots: { ...s.snapshots, intervalMinutes: Math.max(1, Number(v) || 5) } })} />
      </SettingRow>
    </SettingsGroup>
  );
}

function DailySection() {
  const [s, save] = useHiveSettings();
  return (
    <>
      <SettingsGroup title="Daily notes">
        <SettingRow label="Date format" description="YYYY-MM-DD gives 2026-11-16. Use / for subfolders, like YYYY/MM/YYYY-MM-DD.">
          <TextSetting label="Daily note format" value={s.dailyNotes.format} onSave={(v) => save({ dailyNotes: { ...s.dailyNotes, format: v || 'YYYY-MM-DD' } })} />
        </SettingRow>
        <SettingRow label="Folder">
          <TextSetting label="Daily notes folder" value={s.dailyNotes.folder} onSave={(v) => save({ dailyNotes: { ...s.dailyNotes, folder: v } })} />
        </SettingRow>
        <SettingRow label="Template" description="A note to copy into each new daily note.">
          <TextSetting label="Daily note template" value={s.dailyNotes.template} placeholder="Templates/Daily" onSave={(v) => save({ dailyNotes: { ...s.dailyNotes, template: v } })} />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Templates" description="Templates can use {{title}}, {{date}}, {{time}} and {{date:YYYY-MM-DD}}.">
        <SettingRow label="Templates folder">
          <TextSetting label="Templates folder" value={s.templates.folder} onSave={(v) => save({ templates: { ...s.templates, folder: v } })} />
        </SettingRow>
        <SettingRow label="Unique note name format">
          <TextSetting label="Unique note format" value={s.uniqueNote.format} onSave={(v) => save({ uniqueNote: { ...s.uniqueNote, format: v || 'YYYYMMDDHHmm' } })} />
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function AppearanceSection() {
  const snippets = useStore((s) => s.snippets);
  const enabled = useStore((s) => s.enabledSnippets);
  const setEnabled = (next: string[]) => {
    void saveHiveAppearance({ enabledSnippets: next });
  };
  return (
    <AppearanceSettings
      snippetsSection={
        <>
      <SettingsGroup title="CSS snippets" description="CSS files in .basalt/snippets/ in this hive.">
        {snippets.length ? (
          snippets.map((sn) => (
            <SettingRow key={sn.name} label={sn.name}>
              <Toggle checked={enabled.includes(sn.name)} onChange={(v) => setEnabled(v ? [...enabled, sn.name] : enabled.filter((x) => x !== sn.name))} />
            </SettingRow>
          ))
        ) : (
          <SettingRow label="No snippets yet" description="Add a .css file to .basalt/snippets/, then reload snippets.">
            <span />
          </SettingRow>
        )}
        <SettingRow label="Reload snippets">
          <Button size="sm" variant="secondary" onClick={() => void api().hive.snippets().then((sn) => setState({ snippets: sn }))}>
            Reload
          </Button>
        </SettingRow>
      </SettingsGroup>
        </>
      }
    />
  );
}

function HotkeysSection() {
  const hotkeys = useStore((s) => s.hotkeys);
  const [capturing, setCapturing] = useState<string | null>(null);
  const save = (next: Record<string, string>) => {
    setState({ hotkeys: next });
    void api().hive.writeConfig('hotkeys.json', next);
  };
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapturing(null);
      const hk = eventToHotkey(e);
      if (!hk) return;
      save({ ...getState().hotkeys, [capturing]: hk });
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);
  return (
    <SettingsGroup title="Hotkeys" description="Click Change, then press the new keys. Esc cancels.">
      {COMMANDS.map((c) => {
        const hk = hotkeyFor(c);
        const clash = hk ? COMMANDS.find((o) => o.id !== c.id && hotkeyFor(o) === hk) : undefined;
        return (
          <SettingRow key={c.id} label={c.name} description={clash ? `Also used by “${clash.name}”` : undefined} tone={clash ? 'danger' : 'default'}>
            <span className="hotkey-cell">
              {capturing === c.id ? <span className="muted">Press keys…</span> : hk ? <Kbd>{formatHotkey(hk)}</Kbd> : <span className="muted">None</span>}
              <Button size="sm" variant="quiet" onClick={() => setCapturing(c.id)}>
                Change
              </Button>
              {c.id in hotkeys ? (
                <Button size="sm" variant="quiet" onClick={() => save(Object.fromEntries(Object.entries(hotkeys).filter(([k]) => k !== c.id)))}>
                  Reset
                </Button>
              ) : hk ? (
                <Button size="sm" variant="quiet" onClick={() => save({ ...hotkeys, [c.id]: '' })}>
                  Clear
                </Button>
              ) : null}
            </span>
          </SettingRow>
        );
      })}
    </SettingsGroup>
  );
}

function ProviderCard({ p, onChange }: { p: ProviderSettings; onChange: (s: AiSettings) => void }) {
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const save = (patch: Partial<ProviderSettings>, apiKey?: string | null) =>
    void api()
      .ai.saveProvider({ ...p, ...patch }, apiKey)
      .then(onChange)
      .catch((e) => errorToast("Couldn't save the provider", e));
  const load = async () => {
    setLoading(true);
    try {
      setModels(await api().ai.listModels(p.id));
    } catch (e) {
      errorToast(`Couldn't list ${p.label} models`, e);
    } finally {
      setLoading(false);
    }
  };
  const needsKey = p.kind !== 'openai-compatible' || !/localhost|127\.0\.0\.1/.test(p.baseUrl ?? '');
  return (
    <SettingsGroup title={p.label} description={p.baseUrl}>
      {needsKey ? (
        <SettingRow label="API key" description={p.hasKey ? 'Saved. Paste a new key to replace it.' : 'Stored in your system keychain, never in the hive.'} badge={p.hasKey ? 'Saved' : undefined}>
          <span className="hotkey-cell">
            <input className="setting-input" type="password" autoComplete="off" aria-label={`${p.label} API key`} placeholder={p.hasKey ? '••••••••' : 'Paste key'} value={key} onChange={(e) => setKey(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={!key} onClick={() => (save({}, key), setKey(''))}>
              Save
            </Button>
            {p.hasKey ? (
              <Button size="sm" variant="quiet" onClick={() => save({}, null)}>
                Forget
              </Button>
            ) : null}
          </span>
        </SettingRow>
      ) : null}
      {p.kind === 'openai-compatible' ? (
        <SettingRow label="Endpoint">
          <TextSetting label="Endpoint URL" value={p.baseUrl ?? ''} onSave={(v) => save({ baseUrl: v })} />
        </SettingRow>
      ) : null}
      <SettingRow label="Chat model" description={models.length ? `${models.length} models available` : 'Type a model name, or load the list from the provider.'}>
        <span className="hotkey-cell">
          {models.length ? (
            <Select aria-label="Chat model" value={p.model} options={[...(models.includes(p.model) || !p.model ? [] : [p.model]), ...models]} onChange={(e) => save({ model: e.target.value })} />
          ) : (
            <TextSetting label="Chat model" value={p.model} onSave={(v) => save({ model: v })} />
          )}
          <Button size="sm" variant="quiet" disabled={loading || (needsKey && !p.hasKey)} onClick={() => void load()}>
            {loading ? 'Loading…' : 'Load models'}
          </Button>
        </span>
      </SettingRow>
      {p.kind === 'anthropic' ? (
        <SettingRow label="Effort" description="How hard Claude thinks before answering. Higher is slower and costs more.">
          <Select value={p.effort ?? 'medium'} options={['low', 'medium', 'high', 'xhigh', 'max']} onChange={(e) => save({ effort: e.target.value as 'medium' })} />
        </SettingRow>
      ) : (
        <SettingRow label="Embedding model" description="Used for semantic search when chosen below.">
          <TextSetting label="Embedding model" value={p.embeddingModel ?? ''} onSave={(v) => save({ embeddingModel: v || undefined })} />
        </SettingRow>
      )}
      <SettingRow label="Remove this provider" tone="danger">
        <Button size="sm" variant="danger" onClick={() => void api().ai.removeProvider(p.id).then(onChange)}>
          Remove
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}

function AssistantSection() {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [presets, setPresets] = useState<Awaited<ReturnType<typeof window.basalt.ai.presets>>>([]);
  const [pick, setPick] = useState('claude');
  useEffect(() => {
    void api().ai.settings().then(setAi);
    void api().ai.presets().then(setPresets);
  }, []);
  if (!ai) return null;
  const add = () => {
    const p = presets.find((x) => x.id === pick);
    if (!p) return;
    const id = ai.providers.some((x) => x.id === p.id) ? `${p.id}-${Date.now().toString(36)}` : p.id;
    void api()
      .ai.saveProvider({ id, kind: p.kind, label: p.label, baseUrl: p.baseUrl, model: p.model, embeddingModel: p.embeddingModel, hasKey: false })
      .then(setAi);
  };
  const reindex = async () => {
    const t = toast({ tone: 'progress', title: 'Building the semantic index', progress: 0 }, 0);
    const off = api().ai.onIndexProgress(({ done, total }) => updateToast(t, { progress: total ? done / total : 1, body: `${done} of ${total} notes` }));
    try {
      const { chunks } = await api().ai.reindex();
      updateToast(t, { tone: 'success', title: 'Semantic index ready', body: `${chunks} passages`, progress: undefined });
      setTimeout(() => dismissToast(t), 3000);
    } catch (e) {
      dismissToast(t);
      errorToast("Couldn't build the semantic index", e);
    } finally {
      off();
    }
  };
  const embedOptions = [{ value: 'builtin', label: 'Built in (offline, no setup)' }, ...ai.providers.filter((p) => p.embeddingModel).map((p) => ({ value: p.id, label: `${p.label} · ${p.embeddingModel}` }))];
  return (
    <>
      <QuickStart onChange={setAi} />
      <SettingsGroup title="Models" description="Basalt works with Claude, OpenAI, Gemini and any OpenAI-compatible endpoint, including local models in Ollama and LM Studio.">
        <SettingRow label="Add a provider">
          <span className="hotkey-cell">
            <Select aria-label="Provider" value={pick} options={presets.map((p) => ({ value: p.id, label: p.label }))} onChange={(e) => setPick(e.target.value)} />
            <Button size="sm" variant="primary" onClick={add}>
              Add
            </Button>
          </span>
        </SettingRow>
        {!ai.keychain ? (
          <SettingRow label="System keychain unavailable" description="Keys you enter are kept only until you quit Basalt." tone="danger">
            <Icon name="warning" />
          </SettingRow>
        ) : null}
      </SettingsGroup>
      {ai.providers.map((p) => (
        <ProviderCard key={p.id} p={p} onChange={setAi} />
      ))}
      <SettingsGroup title="Semantic search" description="Finds notes by meaning and suggests links. The built-in model runs offline; a provider's embedding model understands meaning better.">
        <SettingRow label="Embeddings from">
          <Select value={ai.embeddings} options={embedOptions} onChange={(e) => void api().ai.setEmbeddings(e.target.value).then(setAi)} />
        </SettingRow>
        <SettingRow label="Rebuild the index" description="Runs automatically as notes change.">
          <Button size="sm" variant="secondary" onClick={() => void reindex()}>
            Rebuild
          </Button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function CopyBlock({ text }: { text: string }) {
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <Button size="sm" variant="quiet" onClick={() => void navigator.clipboard.writeText(text).then(() => toast({ tone: 'success', title: 'Copied' }, 1500))}>
        Copy
      </Button>
    </div>
  );
}

function AgentsSection() {
  const root = useStore((s) => s.hive!.info.root);
  const [cli, setCli] = useState('basalt');
  useEffect(() => void api().app.cliCommand().then(setCli), []);
  const [launch, setLaunch] = useState<{ command: string; args: string[] } | null>(null);
  useEffect(() => void api().connect.launchCommand().then(setLaunch), []);
  const desktop = launch ? JSON.stringify({ mcpServers: { basalt: launch } }, null, 2) : '';
  return (
    <>
      <ConnectApps />
      <SettingsGroup title="Connect an agent" description="Basalt's MCP server lets Claude Code, Claude Desktop and other agents search, read and edit this hive. It can't delete notes, and it reads .basalt/agents.md for your conventions.">
        <div className="agents-body">
          <p>Any MCP client (Cursor, Windsurf, VS Code, …): Basalt starts itself as the server.</p>
          {desktop ? <CopyBlock text={desktop} /> : null}
          <p>With Node installed, you can use the CLI instead</p>
          <CopyBlock text={`claude mcp add basalt -- ${cli} mcp -H "${root}"`} />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Command line" description="Every command takes --json for scripts and agents.">
        <div className="agents-body">
          <CopyBlock text={`${cli} -H "${root}" search 'tag:#project task-todo:'\n${cli} -H "${root}" query --where '[status:active]' --sort due\n${cli} -H "${root}" semantic 'notes about pricing'\n${cli} -H "${root}" ask 'What did I decide about the launch?'`} />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Hive conventions">
        <SettingRow label=".basalt/agents.md" description="Tell agents and the assistant how this hive is organised.">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const existing = await api().hive.readConfigText('agents.md');
              setState({
                settingsOpen: null,
                prompt: {
                  title: 'Hive conventions',
                  label: 'agents.md',
                  value: existing ?? '',
                  confirm: 'Save',
                  multiline: true,
                  onSubmit: (v) => void api().hive.writeConfigText('agents.md', v),
                },
              });
            }}
          >
            Edit
          </Button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

const UPDATE_TEXT: Record<UpdateStatus['state'], string> = {
  idle: '',
  checking: 'Checking for updates…',
  current: 'You have the latest version.',
  available: 'A new version is available.',
  downloading: 'Downloading the update…',
  ready: 'The update is ready. It installs when you quit Basalt.',
  error: "Couldn't check for updates.",
  unsupported: 'Updates are checked only in installed builds, not in development.',
};

function AboutSection() {
  const [s, setS] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    void api().app.updateStatus().then(setS);
    return api().app.onUpdate(setS);
  }, []);
  if (!s) return null;
  const text = [UPDATE_TEXT[s.state], s.latest && s.latest !== s.version ? `Latest: ${s.latest}.` : '', s.state === 'downloading' && s.percent != null ? `${s.percent}%` : '', s.error ?? ''].filter(Boolean).join(' ');
  return (
    <SettingsGroup title="About Basalt" description="A local-first Markdown notes app. Your notes stay plain files in your hive.">
      <SettingRow label={`Version ${s.version}`} description={text || 'Basalt checks for updates when it starts and every few hours.'}>
        {s.state === 'ready' ? (
          <Button size="sm" variant="primary" onClick={() => void api().app.installUpdate()}>
            Restart and update
          </Button>
        ) : s.state === 'available' && s.downloadUrl ? (
          <Button size="sm" variant="primary" onClick={() => void api().app.installUpdate()}>
            Download {s.latest}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={s.state === 'checking' || s.state === 'downloading'} onClick={() => void api().app.checkForUpdates().then(setS)}>
            Check for updates
          </Button>
        )}
      </SettingRow>
      <SettingRow label="Website" description="Downloads, release notes and help.">
        <Button size="sm" variant="quiet" onClick={() => void api().app.openExternal('https://nabhyaraj-sonagara.github.io/Basalt/')}>
          Open
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}

export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const hasHive = useStore((s) => !!s.hive);
  // Escape closes Settings even when focus has left it (e.g. after a confirmation dialog closed).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !getState().prompt) setState({ settingsOpen: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open || !hasHive) return null;
  const close = () => setState({ settingsOpen: null });
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="settings" role="dialog" aria-label="Settings">
        <nav className="settings-nav">
          <div className="panel-label">Settings</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={open === s.id ? 'on' : ''} onClick={() => setState({ settingsOpen: s.id })}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <Button size="sm" variant="quiet" icon="close" aria-label="Close settings" className="settings-close" onClick={close} />
          {open === 'editor' ? <EditorSection /> : null}
          {open === 'files' ? <FilesSection /> : null}
          {open === 'daily' ? <DailySection /> : null}
          {open === 'appearance' ? <AppearanceSection /> : null}
          {open === 'hotkeys' ? <HotkeysSection /> : null}
          {open === 'assistant' ? <AssistantSection /> : null}
          {open === 'agents' ? <AgentsSection /> : null}
          {open === 'plugins' ? <PluginSettings /> : null}
          {open === 'sync' ? <SyncSection /> : null}
          {open === 'about' ? <AboutSection /> : null}
        </div>
      </div>
    </div>
  );
}
