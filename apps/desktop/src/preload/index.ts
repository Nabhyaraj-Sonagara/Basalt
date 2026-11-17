import { contextBridge, ipcRenderer } from 'electron';
import type { BasaltApi } from '../shared/api';

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const group = (prefix: string, names: string[]) => Object.fromEntries(names.map((n) => [n, invoke(`${prefix}:${n}`)]));

// Only these named, promise-returning calls cross the bridge; the renderer gets no Node or Electron access.
const api: BasaltApi = {
  app: {
    ...(group('app', [
      'recent', 'pickFolder', 'openHive', 'closeHive', 'sampleHivePath', 'openExternal', 'showInFolder', 'cliCommand', 'initialHive', 'info', 'popout',
      'setSpellcheck', 'takePendingUri', 'checkForUpdates', 'installUpdate', 'updateStatus',
    ]) as unknown as Omit<BasaltApi['app'], 'onUri' | 'onCommand' | 'onUpdate'>),
    onUri: (cb) => subscribe('app:uri', cb),
    onCommand: (cb) => subscribe('app:command', cb),
    onUpdate: (cb) => subscribe('app:update', cb),
  },
  hive: {
    ...(group('hive', [
      'snapshot', 'read', 'readSubpath', 'write', 'create', 'createFolder', 'rename', 'merge', 'trash', 'toggleTask', 'setProperties', 'backlinks', 'unlinked',
      'search', 'tags', 'graph', 'query', 'properties', 'dailyNote', 'uniqueNote', 'templates', 'saveSettings', 'readConfig', 'writeConfig',
      'readConfigText', 'writeConfigText', 'snippets', 'snapshots', 'readSnapshot', 'saveAttachment',
    ]) as unknown as Omit<BasaltApi['hive'], 'fileUrl' | 'onChange'>),
    fileUrl: (path: string) => `basalt-file://hive/${path.split('/').map(encodeURIComponent).join('/')}`,
    onChange: (cb) => subscribe('hive:change', cb),
  },
  sync: {
    ...(group('sync', ['status', 'setServer', 'signUp', 'signIn', 'signOut', 'usage', 'remoteHives', 'connect', 'disconnect', 'setPaused', 'now']) as unknown as Omit<BasaltApi['sync'], 'onStatus'>),
    onStatus: (cb) => subscribe('sync:status', cb),
  },
  ai: {
    ...(group('ai', ['presets', 'settings', 'saveProvider', 'removeProvider', 'setChatProvider', 'setEmbeddings', 'listModels', 'chat', 'cancel', 'semanticSearch', 'related', 'reindex']) as unknown as Omit<
      BasaltApi['ai'],
      'onChat' | 'onIndexProgress'
    >),
    onChat: (cb) => subscribe('ai:chat', cb),
    onIndexProgress: (cb) => subscribe('ai:index-progress', cb),
  },
};

contextBridge.exposeInMainWorld('basalt', api);
