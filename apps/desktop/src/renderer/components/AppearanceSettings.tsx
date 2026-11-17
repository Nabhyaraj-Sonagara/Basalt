import { useState } from 'react';
import { Button, Icon, Select, SettingRow, SettingsGroup, Toggle } from '@basalt/ui';
import { ACCENTS, DEFAULT_APPEARANCE, getAppearance, parseThemeFile, resetAppearance, setAppearance, useAppearance, type Appearance, type ThemeFile } from '../lib/appearance';
import { COMMANDS } from '../lib/commands';
import { api, errorToast, saveHiveAppearance } from '../lib/actions';
import { setState, setTheme, toast, useStore } from '../lib/store';
import { HiveCrest } from './HiveCrest';
import { PANELS } from './RightPanel';

const VIEW_LABELS: [string, string][] = [
  ['files', 'Files'],
  ['search', 'Search'],
  ['tags', 'Tags'],
  ['bookmarks', 'Bookmarks'],
];
const HIVE_COLORS = ['#e8a317', '#5f8a4c', '#3f7fb3', '#c8553d', '#8a5fb3', '#5d6b78', '#2f8f87', '#b08d57'];

function toggleIn(list: string[], id: string, on: boolean): string[] {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

function ToolbarEditor({ look }: { look: Appearance }) {
  const available = COMMANDS.filter((c) => c.icon && c.id !== 'settings' && c.id !== 'show-updates');
  const ordered = [...look.toolbar.map((id) => available.find((c) => c.id === id)).filter(Boolean), ...available.filter((c) => !look.toolbar.includes(c.id))] as typeof available;
  const move = (id: string, by: -1 | 1) => {
    const t = [...look.toolbar];
    const i = t.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= t.length) return;
    [t[i], t[j]] = [t[j], t[i]];
    setAppearance({ toolbar: t });
  };
  return (
    <div className="toolbar-editor" role="list" aria-label="Sidebar toolbar buttons">
      {ordered.map((c) => {
        const on = look.toolbar.includes(c.id);
        return (
          <div key={c.id} className="toolbar-row" role="listitem">
            <input type="checkbox" checked={on} aria-label={`Show ${c.name} in the toolbar`} onChange={(e) => setAppearance({ toolbar: on && !e.target.checked ? look.toolbar.filter((x) => x !== c.id) : [...look.toolbar, c.id] })} />
            <Icon name={c.icon!} size={18} />
            <span className="name">{c.name}</span>
            {on ? (
              <>
                <Button size="sm" variant="quiet" aria-label={`Move ${c.name} up`} disabled={look.toolbar[0] === c.id} onClick={() => move(c.id, -1)}>
                  ↑
                </Button>
                <Button size="sm" variant="quiet" aria-label={`Move ${c.name} down`} disabled={look.toolbar[look.toolbar.length - 1] === c.id} onClick={() => move(c.id, 1)}>
                  ↓
                </Button>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function HiveIdentity() {
  const hive = useStore((s) => s.hive!);
  const identity = useStore((s) => s.hiveIdentity);
  const [emoji, setEmoji] = useState(identity.icon ?? '');
  return (
    <SettingsGroup title="This hive" description="Every hive gets a crest of basalt columns drawn from its name. Pick a colour, or use an emoji instead.">
      <div className="crest-pick pad-row">
        <HiveCrest name={hive.info.name} size={64} icon={identity.icon} color={identity.color} />
        <div className="swatches" role="group" aria-label="Hive colour">
          {HIVE_COLORS.map((c) => (
            <button key={c} className={`swatch${identity.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Hive colour ${c}`} onClick={() => void saveHiveAppearance({ color: c })} />
          ))}
          <Button size="sm" variant="quiet" onClick={() => void saveHiveAppearance({ color: undefined })}>
            Automatic
          </Button>
        </div>
      </div>
      <SettingRow label="Emoji" description="Shown instead of the crest. Leave empty for the crest.">
        <form
          className="sync-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void saveHiveAppearance({ icon: [...emoji.trim()].slice(0, 2).join('') || undefined });
          }}
        >
          <input className="setting-input emoji-input" aria-label="Hive emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="📚" />
          <Button size="sm" variant="secondary" type="submit">
            Save
          </Button>
        </form>
      </SettingRow>
    </SettingsGroup>
  );
}

export function AppearanceSettings({ snippetsSection }: { snippetsSection: React.ReactNode }) {
  const look = useAppearance();
  const theme = useStore((s) => s.theme);
  const exportTheme = async () => {
    const file: ThemeFile = { basaltTheme: 1, name: 'My Basalt theme', colorScheme: theme, appearance: getAppearance() };
    try {
      const path = await api().app.saveTextFile('My theme.basalt-theme.json', JSON.stringify(file, null, 2));
      if (path) toast({ tone: 'success', title: 'Theme saved', body: path });
    } catch (e) {
      errorToast("Couldn't save the theme", e);
    }
  };
  const importTheme = async () => {
    try {
      const text = await api().app.openTextFile(['json']);
      if (!text) return;
      const t = parseThemeFile(text);
      setAppearance(t.appearance);
      if (t.colorScheme) setTheme(t.colorScheme);
      if (t.css) {
        const name = `${t.name.replace(/[^\w -]/g, '').trim() || 'theme'}.css`;
        await api().hive.writeConfigText(`snippets/${name}`, t.css);
        const snippets = await api().hive.snippets();
        setState({ snippets });
        await saveHiveAppearance({ enabledSnippets: [...new Set([...(await api().hive.readConfig<{ enabledSnippets?: string[] }>('appearance.json'))?.enabledSnippets ?? [], name])] });
      }
      toast({ tone: 'success', title: `Applied “${t.name}”` });
    } catch (e) {
      errorToast("Couldn't import that theme", e);
    }
  };
  return (
    <>
      <SettingsGroup title="Colour">
        <SettingRow label="Theme" description="Comb is beeswax light. Basalt is cooled-stone dark.">
          <Select value={theme} options={[{ value: 'comb', label: 'Comb (light)' }, { value: 'basalt', label: 'Basalt (dark)' }, { value: 'auto', label: 'Match the system' }]} onChange={(e) => setTheme(e.target.value as 'comb')} />
        </SettingRow>
        <SettingRow label="Accent" description="Buttons, links, selection and the active tab.">
          <div className="swatches" role="group" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button key={a.name} className={`swatch${look.accent === a.hex ? ' on' : ''}`} style={{ background: a.hex ?? '#e8a317' }} title={a.name} aria-label={`${a.name} accent`} onClick={() => setAppearance({ accent: a.hex })} />
            ))}
            <input className="swatch-custom" type="color" aria-label="Custom accent colour" value={look.accent ?? '#e8a317'} onChange={(e) => setAppearance({ accent: e.target.value })} />
          </div>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Text and size">
        <SettingRow label="Interface font">
          <Select value={look.uiFont} options={[{ value: 'hanken', label: 'Hanken Grotesk' }, { value: 'system', label: 'System font' }]} onChange={(e) => setAppearance({ uiFont: e.target.value as Appearance['uiFont'] })} />
        </SettingRow>
        <SettingRow label="Note font">
          <Select
            value={look.editorFont}
            options={[
              { value: 'literata', label: 'Literata (serif)' },
              { value: 'hanken', label: 'Hanken Grotesk (sans)' },
              { value: 'system', label: 'System font' },
              { value: 'mono', label: 'JetBrains Mono' },
            ]}
            onChange={(e) => setAppearance({ editorFont: e.target.value as Appearance['editorFont'] })}
          />
        </SettingRow>
        <SettingRow label={`Note text size · ${look.editorSize}px`}>
          <input type="range" min={13} max={24} value={look.editorSize} aria-label="Note text size" onChange={(e) => setAppearance({ editorSize: Number(e.target.value) })} />
        </SettingRow>
        <SettingRow label="Line width" description="Applies when readable line length is on (Settings → Editor).">
          <Select value={look.lineWidth} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }, { value: 'full', label: 'Full width' }]} onChange={(e) => setAppearance({ lineWidth: e.target.value as Appearance['lineWidth'] })} />
        </SettingRow>
        <SettingRow label="Density">
          <Select value={look.density} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} onChange={(e) => setAppearance({ density: e.target.value as Appearance['density'] })} />
        </SettingRow>
        <SettingRow label="Icon size" description="Sidebar toolbar and panel tabs.">
          <Select value={String(look.iconSize)} options={[{ value: '16', label: 'Small' }, { value: '20', label: 'Medium' }, { value: '24', label: 'Large' }]} onChange={(e) => setAppearance({ iconSize: Number(e.target.value) as Appearance['iconSize'] })} />
        </SettingRow>
      </SettingsGroup>
      <HiveIdentity />
      <SettingsGroup title="Sidebar toolbar" description="Pick the buttons under the hive name and their order.">
        <ToolbarEditor look={look} />
      </SettingsGroup>
      <SettingsGroup title="Panels">
        {VIEW_LABELS.map(([id, label]) => (
          <SettingRow key={id} label={`Left sidebar: ${label}`}>
            <Toggle checked={!look.hiddenViews.includes(id)} onChange={(v) => setAppearance({ hiddenViews: toggleIn(look.hiddenViews, id, !v) })} />
          </SettingRow>
        ))}
        {PANELS.map((p) => (
          <SettingRow key={p.id} label={`Right sidebar: ${p.label}`}>
            <Toggle checked={!look.hiddenPanels.includes(p.id)} onChange={(v) => setAppearance({ hiddenPanels: toggleIn(look.hiddenPanels, p.id, !v) })} />
          </SettingRow>
        ))}
        <SettingRow label="Status bar">
          <Toggle checked={look.statusBar} onChange={(v) => setAppearance({ statusBar: v })} />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Themes" description="Share a look as a .basalt-theme.json file: colours, fonts, sizes and layout.">
        <SettingRow label="Export this look">
          <Button size="sm" variant="secondary" onClick={() => void exportTheme()}>
            Export…
          </Button>
        </SettingRow>
        <SettingRow label="Import a theme">
          <Button size="sm" variant="secondary" onClick={() => void importTheme()}>
            Import…
          </Button>
        </SettingRow>
        <SettingRow label="Reset to Basalt's defaults">
          <Button size="sm" variant="quiet" disabled={JSON.stringify(look) === JSON.stringify(DEFAULT_APPEARANCE)} onClick={() => resetAppearance()}>
            Reset
          </Button>
        </SettingRow>
      </SettingsGroup>
      {snippetsSection}
    </>
  );
}
