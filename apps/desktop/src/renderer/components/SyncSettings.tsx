import { useEffect, useState } from 'react';
import { Button, Select, SettingRow, SettingsGroup, Toggle } from '@basalt/ui';
import type { SyncStatus } from '../../shared/api';
import { api, errorToast, openPath } from '../lib/actions';
import { noteTitle, setState, toast } from '../lib/store';

const mb = (n: number) => `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;

export function useSyncStatus(): SyncStatus | null {
  const [s, setS] = useState<SyncStatus | null>(null);
  useEffect(() => {
    void api().sync.status().then(setS);
    return api().sync.onStatus(setS);
  }, []);
  return s;
}

export const SYNC_TEXT: Record<SyncStatus['state'], string> = {
  off: 'Not syncing',
  idle: 'Synced',
  syncing: 'Syncing…',
  paused: 'Sync paused',
  offline: 'Offline, will sync when the server is reachable',
  error: 'Sync error',
};

function SignIn({ status }: { status: SyncStatus }) {
  const [server, setServer] = useState(status.server);
  const [email, setEmail] = useState(status.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (mode: 'signIn' | 'signUp') => {
    setBusy(true);
    try {
      if (server.trim() !== status.server) await api().sync.setServer(server);
      await api().sync[mode](email, password);
      setPassword('');
      toast({ tone: 'success', title: mode === 'signUp' ? 'Account created' : 'Signed in to sync' });
    } catch (err) {
      errorToast(mode === 'signUp' ? "Couldn't create the account" : "Couldn't sign in", err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup
      title="Sync"
      description="Keep this hive the same on all your devices. Notes are encrypted on this computer before they're uploaded; the server can't read them, so your password can't be reset. If you forget it, your notes stay on your devices but the synced copy is lost."
    >
      <form
        className="sync-form"
        onSubmit={(e) => {
          e.preventDefault();
          void go('signIn');
        }}
      >
        <label>
          <span>Sync server</span>
          <input className="setting-input" type="url" placeholder="https://sync.example.com" value={server} onChange={(e) => setServer(e.target.value)} autoComplete="url" />
        </label>
        <label>
          <span>Email</span>
          <input className="setting-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label>
          <span>Password</span>
          <input className="setting-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" minLength={10} />
        </label>
        <div className="sync-actions">
          <Button type="submit" variant="primary" disabled={busy || !server.trim() || !email.trim() || !password}>
            Sign in
          </Button>
          <Button type="button" variant="secondary" disabled={busy || !server.trim() || !email.trim() || password.length < 10} onClick={() => void go('signUp')}>
            Create account
          </Button>
        </div>
        {!status.keychain ? <p className="muted">This computer has no system keychain, so you'll need to sign in again after restarting Basalt.</p> : null}
      </form>
    </SettingsGroup>
  );
}

function Connect() {
  const [remotes, setRemotes] = useState<{ id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState('new');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api()
      .sync.remoteHives()
      .then(setRemotes)
      .catch((e) => {
        setRemotes([]);
        errorToast("Couldn't list your synced hives", e);
      });
  }, []);
  return (
    <SettingRow label="Sync this hive" description="Start a new synced hive from this folder, or join one you already sync from another device. Joining merges both: files on either side end up on both.">
      <div className="sync-actions">
        <Select
          aria-label="Remote hive"
          value={pick}
          options={[{ value: 'new', label: 'New synced hive' }, ...(remotes ?? []).map((r) => ({ value: r.id, label: r.name }))]}
          onChange={(e: { target: { value: string } }) => setPick(e.target.value)}
        />
        <Button
          variant="primary"
          disabled={busy || !remotes}
          onClick={async () => {
            setBusy(true);
            try {
              await api().sync.connect(pick === 'new' ? null : pick);
            } catch (err) {
              errorToast("Couldn't start syncing", err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Start syncing
        </Button>
      </div>
    </SettingRow>
  );
}

export function SyncSection() {
  const status = useSyncStatus();
  const [usage, setUsage] = useState<{ usageBytes: number; quotaBytes: number; maxFileBytes?: number } | null>(null);
  useEffect(() => {
    if (status?.signedIn) void api().sync.usage().then(setUsage);
  }, [status?.signedIn, status?.lastSync]);
  if (!status) return null;
  if (!status.signedIn) return <SignIn status={status} />;
  const when = status.lastSync ? new Date(status.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <>
      <SettingsGroup title="Sync" description={`Signed in as ${status.email} on ${status.server.replace(/^https?:\/\//, '')}. Notes are encrypted on this computer before upload. Sync carries notes, canvases and pages; images, PDFs and other attachments stay on each device.`}>
        {status.linked ? (
          <>
            <SettingRow
              label={`Syncing with “${status.linked.name}”`}
              description={status.error ?? (status.state === 'idle' && when ? `Synced at ${when}.` : SYNC_TEXT[status.state])}
            >
              <Button size="sm" variant="secondary" disabled={status.state === 'syncing' || status.linked.paused} onClick={() => void api().sync.now()}>
                Sync now
              </Button>
            </SettingRow>
            <SettingRow label="Pause sync" description="Stop uploading and downloading until you turn it back on.">
              <Toggle checked={status.linked.paused} onChange={(v) => void api().sync.setPaused(v)} />
            </SettingRow>
            {status.conflicts.length ? (
              <SettingRow label="Conflicts" description="These notes changed on two devices at once. Each copy holds the version from this computer; compare and delete the one you don't need.">
                <div className="sync-conflicts">
                  {status.conflicts.map((p) => (
                    <button
                      key={p}
                      className="plain"
                      onClick={() => {
                        setState({ settingsOpen: null });
                        openPath(p);
                      }}
                    >
                      {noteTitle(p)}
                    </button>
                  ))}
                </div>
              </SettingRow>
            ) : null}
            {status.skipped?.length ? (
              <SettingRow
                label="Not synced"
                description={`These files are over the server's ${usage?.maxFileBytes ? `${mb(usage.maxFileBytes)} ` : ''}limit for one note, so they stay on this computer.`}
              >
                <div className="sync-conflicts">
                  {status.skipped.map((p) => (
                    <button
                      key={p}
                      className="plain"
                      onClick={() => {
                        setState({ settingsOpen: null });
                        openPath(p);
                      }}
                    >
                      {noteTitle(p)}
                    </button>
                  ))}
                </div>
              </SettingRow>
            ) : null}
            <SettingRow label="Stop syncing this hive" description="Your files stay here and in the synced copy; this computer just stops syncing them.">
              <Button size="sm" variant="quiet" onClick={() => void api().sync.disconnect()}>
                Stop syncing
              </Button>
            </SettingRow>
          </>
        ) : (
          <Connect />
        )}
        {usage ? (
          <SettingRow label="Storage" description={`${mb(usage.usageBytes)} of ${mb(usage.quotaBytes)} used.`}>
            <span />
          </SettingRow>
        ) : null}
        <SettingRow label="Account">
          <Button size="sm" variant="quiet" onClick={() => void api().sync.signOut()}>
            Sign out
          </Button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
