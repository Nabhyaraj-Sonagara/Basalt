import { Button, SettingRow, SettingsGroup, Toggle } from '@basalt/ui';
import type { PluginInfo } from '../../shared/api';
import { api, errorToast } from '../lib/actions';
import { PERMISSION_TEXT, loadPlugins, missingPermissions, removePlugin, setPluginEnabled } from '../lib/plugins';
import { setState, toast, useStore } from '../lib/store';

function describe(p: PluginInfo): string {
  const m = p.manifest!;
  const can = m.permissions.length ? `Can ${m.permissions.map((x) => PERMISSION_TEXT[x].toLowerCase()).join(' and ')}.` : 'Needs no access to your notes.';
  return [m.description, `v${m.version}${m.author ? ` by ${m.author}` : ''}. ${can}`].filter(Boolean).join(' ');
}

/** Asks before turning a plugin on, listing what it may do. */
function confirmEnable(p: PluginInfo): void {
  const m = p.manifest!;
  const asks = m.permissions.length ? m.permissions.map((x) => `• ${PERMISSION_TEXT[x]}`).join('\n') : '• Nothing beyond adding commands and status text';
  setState({
    prompt: {
      title: `Turn on ${m.name}?`,
      message: `${m.name} will run in a sandbox with no internet access. It asks to:\n${asks}\n\nOnly turn on plugins you trust.`,
      label: '',
      value: '',
      confirm: 'Turn on',
      onSubmit: async () => {
        try {
          await setPluginEnabled(p, true);
          toast({ tone: 'success', title: `${m.name} is on` });
        } catch (err) {
          errorToast("Couldn't turn it on", err);
        }
      },
    },
  });
}

export function PluginSettings() {
  const plugins = useStore((s) => s.plugins);
  const enabled = useStore((s) => s.pluginsEnabled);
  return (
    <>
      <SettingsGroup
        title="Plugins"
        description="Plugins add commands, status text and panels. They live in this hive's .basalt/plugins folder, run in a sandbox without internet access, and can only touch your notes if you allow it."
      >
        {plugins.length ? (
          plugins.map((p) =>
            p.manifest ? (
              <SettingRow
                key={p.folder}
                label={p.manifest.name}
                description={
                  enabled[p.manifest.id] && missingPermissions(p.manifest, enabled[p.manifest.id]).length
                    ? `Paused: this version also asks to ${missingPermissions(p.manifest, enabled[p.manifest.id]).map((x) => PERMISSION_TEXT[x].toLowerCase()).join(' and ')}. Turn it off and on to allow that.`
                    : describe(p)
                }
              >
                <span className="hotkey-cell">
                  <Toggle
                    label={`Turn ${p.manifest.name} on or off`}
                    checked={!!enabled[p.manifest.id]}
                    onChange={(on) => (on ? confirmEnable(p) : void setPluginEnabled(p, false))}
                  />
                  <Button size="sm" variant="quiet" aria-label={`Remove ${p.manifest.name}`} onClick={() => void removePlugin(p)}>
                    Remove
                  </Button>
                </span>
              </SettingRow>
            ) : (
              <SettingRow key={p.folder} label={p.folder} description={`Can't load: ${p.error}`}>
                <Button size="sm" variant="quiet" onClick={() => void removePlugin(p)}>
                  Remove
                </Button>
              </SettingRow>
            ),
          )
        ) : (
          <SettingRow label="No plugins yet" description="Install one from a folder, or ask your AI agent to write one (see docs/plugins.md)." />
        )}
      </SettingsGroup>
      <SettingsGroup title="Manage">
        <SettingRow label="Install from a folder" description="Copies a plugin folder (with its manifest.json) into this hive. It starts off.">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                const id = await api().plugins.install();
                if (id) {
                  await loadPlugins();
                  toast({ tone: 'success', title: 'Plugin installed', body: 'Turn it on below.' });
                }
              } catch (err) {
                errorToast("Couldn't install that plugin", err);
              }
            }}
          >
            Choose folder…
          </Button>
        </SettingRow>
        <SettingRow label="Plugins folder" description="Reload after adding or changing plugin files.">
          <span className="hotkey-cell">
            <Button size="sm" variant="quiet" onClick={() => void api().plugins.reveal()}>
              Open folder
            </Button>
            <Button size="sm" variant="quiet" onClick={() => void loadPlugins().then(() => toast({ tone: 'neutral', title: 'Plugins reloaded' }))}>
              Reload
            </Button>
          </span>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
