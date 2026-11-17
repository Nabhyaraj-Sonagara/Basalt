// Auto-update from GitHub Releases (electron-updater).
// Windows and Linux (AppImage/deb) install updates in place. macOS can only install
// updates into a Developer ID-signed app, so unsigned builds offer a download link instead.
import { app, shell } from 'electron';
import { execFile } from 'node:child_process';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '../shared/api';

const { autoUpdater } = electronUpdater;
const RELEASES = 'https://github.com/Nabhyaraj-Sonagara/Basalt/releases/latest';
const SIX_HOURS = 6 * 60 * 60 * 1000;

let send: (s: UpdateStatus) => void = () => {};
let status: UpdateStatus = { state: 'idle', version: app.getVersion() };
let canInstall = true;
let manualCheck = false;

const enabled = () => app.isPackaged && !process.env.BASALT_NO_UPDATES;

function set(s: Partial<UpdateStatus>) {
  status = { ...status, ...s };
  send(status);
}

/** True when the running macOS app carries a Developer ID signature (ad-hoc builds can't self-update). */
function macSigned(): Promise<boolean> {
  return new Promise((resolve) => {
    const bundle = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '');
    execFile('codesign', ['-dv', '--verbose=2', bundle], (_err, _out, stderr) => resolve(/Authority=Developer ID Application/.test(String(stderr))));
  });
}

export async function initUpdater(notify: (s: UpdateStatus) => void): Promise<void> {
  send = notify;
  if (!enabled()) return;
  if (process.platform === 'darwin') canInstall = await macSigned();
  autoUpdater.autoDownload = canInstall;
  autoUpdater.autoInstallOnAppQuit = canInstall;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => {
    set({ state: manualCheck ? 'current' : 'idle' });
    manualCheck = false;
  });
  autoUpdater.on('update-available', (info) => set({ state: canInstall ? 'downloading' : 'available', latest: info.version, downloadUrl: canInstall ? undefined : RELEASES }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', latest: info.version }));
  autoUpdater.on('error', (err) => {
    set({ state: manualCheck ? 'error' : 'idle', error: manualCheck ? err.message : undefined });
    manualCheck = false;
  });
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 10_000);
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), SIX_HOURS);
}

export function checkForUpdates(): UpdateStatus {
  if (!enabled()) {
    set({ state: 'unsupported' });
    return status;
  }
  manualCheck = true;
  void autoUpdater.checkForUpdates().catch(() => {});
  return status;
}

export function installUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall();
  else if (status.downloadUrl) void shell.openExternal(status.downloadUrl);
}

export const updateStatus = () => status;
