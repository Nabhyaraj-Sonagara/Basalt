import { useEffect, useState } from 'react';
import { Button, Select, SettingRow, SettingsGroup } from '@basalt/ui';
import type { AiSettings, ConnectStatus, LocalModels } from '../../shared/api';
import { api, errorToast } from '../lib/actions';
import { setState, toast } from '../lib/store';

/** Ways to get a model running without pasting an API key. Shown at the top of Settings → Assistant. */
export function QuickStart({ onChange }: { onChange: (s: AiSettings) => void }) {
  const [local, setLocal] = useState<LocalModels[] | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const scan = () => void api().ai.detectLocal().then(setLocal);
  useEffect(scan, []);
  const signIn = async () => {
    setBusy(true);
    try {
      onChange(await api().ai.signInOpenRouter());
      toast({ tone: 'success', title: 'Signed in with OpenRouter', body: 'The assistant now uses OpenRouter. Pick a model below.' });
    } catch (e) {
      errorToast("Couldn't sign in with OpenRouter", e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup title="Get started without an API key" description="Pick whichever suits you. You can still add API keys for any provider below.">
      <SettingRow label="Use your Claude or ChatGPT plan" description="Connect Claude Desktop, Claude Code or Codex to this hive. They work on your notes with your own subscription.">
        <Button size="sm" variant="secondary" onClick={() => setState({ settingsOpen: 'agents' })}>
          Connect apps
        </Button>
      </SettingRow>
      <SettingRow label="Sign in with OpenRouter" description="Approve Basalt in your browser; no key to copy. One balance for Claude, GPT, Gemini, Llama and more.">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void signIn()}>
          {busy ? 'Waiting for the browser…' : 'Sign in'}
        </Button>
      </SettingRow>
      {local === null ? null : local.length ? (
        local.map((l) => {
          const model = picks[l.id] ?? l.models[0] ?? '';
          return (
            <SettingRow key={l.id} label={`${l.label} on this computer`} description={`${l.models.length} model${l.models.length === 1 ? '' : 's'}${l.embeddingModels.length ? `, plus ${l.embeddingModels[0]} for search by meaning` : ''}. Runs locally; nothing leaves your computer.`}>
              <span className="hotkey-cell">
                {l.models.length ? <Select aria-label={`${l.label} model`} value={model} options={l.models.map((m) => ({ value: m, label: m }))} onChange={(e) => setPicks({ ...picks, [l.id]: e.target.value })} /> : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!model}
                  onClick={() =>
                    void api()
                      .ai.useLocal(l.id, model, l.embeddingModels[0])
                      .then((s) => {
                        onChange(s);
                        toast({ tone: 'success', title: `Using ${model} in ${l.label}` });
                      })
                      .catch((e) => errorToast(`Couldn't use ${l.label}`, e))
                  }
                >
                  Use
                </Button>
              </span>
            </SettingRow>
          );
        })
      ) : (
        <SettingRow label="Local models" description="Run Ollama or LM Studio on this computer and Basalt finds them. Free and private.">
          <Button size="sm" variant="quiet" onClick={scan}>
            Look again
          </Button>
        </SettingRow>
      )}
    </SettingsGroup>
  );
}

/** One-click setup for AI apps the person already pays for. Shown in Settings → Agents and CLI. */
export function ConnectApps() {
  const [clients, setClients] = useState<ConnectStatus[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => void api().connect.status().then(setClients);
  useEffect(refresh, []);
  if (!clients) return null;
  const act = async (c: ConnectStatus) => {
    setBusy(c.id);
    try {
      if (c.connected) {
        await api().connect.remove(c.id);
        toast({ tone: 'neutral', title: `Removed this hive from ${c.label}` });
      } else {
        const next = await api().connect.add(c.id);
        toast({ tone: 'success', title: `Connected to ${c.label}`, body: next }, 9000);
      }
    } catch (e) {
      errorToast(`Couldn't update ${c.label}`, e);
    } finally {
      setBusy(null);
      refresh();
    }
  };
  return (
    <SettingsGroup
      title="Use your AI plan"
      description="Connect the apps you already use, so Claude or ChatGPT can search, read and write this hive with your own subscription. Basalt starts in the background when they need it; nothing to install."
    >
      {clients.map((c) => (
        <SettingRow key={c.id} label={c.label} description={c.connected ? `Connected · uses your ${c.plan} plan` : c.installed ? `Uses your ${c.plan} plan` : `Not found on this computer. Install it, then come back.`}>
          <Button size="sm" variant={c.connected ? 'quiet' : 'primary'} disabled={busy === c.id || (!c.installed && !c.connected)} onClick={() => void act(c)}>
            {c.connected ? 'Disconnect' : 'Connect'}
          </Button>
        </SettingRow>
      ))}
      <SettingRow label="ChatGPT desktop" description="ChatGPT's app only connects to online servers. Use Codex, which signs in with your ChatGPT plan.">
        <span />
      </SettingRow>
    </SettingsGroup>
  );
}
