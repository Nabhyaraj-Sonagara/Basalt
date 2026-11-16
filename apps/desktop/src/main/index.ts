import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hive, safeRelPath, type HiveEvent } from '@basalt/core';
import {
  PROVIDER_PRESETS,
  SemanticIndex,
  buildSystemPrompt,
  createEmbedder,
  createProvider,
  type ProviderConfig,
  type SemanticHit,
} from '@basalt/ai';
import type { AiSettings, ChatStart, HiveChange, HiveSnapshot, NoteSummary, ProviderSettings } from '../shared/api';

const isDev = !!process.env.ELECTRON_RENDERER_URL;
const here = import.meta.dirname;

protocol.registerSchemesAsPrivileged([
  { scheme: 'basalt-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ---------- persisted app state ----------

interface AppState {
  recent: { path: string; name: string; opened: number }[];
  lastHive: string | null;
}

const statePath = () => join(app.getPath('userData'), 'state.json');
let appState: AppState = { recent: [], lastHive: null };

async function loadState() {
  try {
    appState = { ...appState, ...JSON.parse(await fs.readFile(statePath(), 'utf8')) };
  } catch {
    /* first run */
  }
}
async function saveState() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(appState, null, 2));
}

// ---------- hive ----------

let hive: Hive | null = null;
let win: BrowserWindow | null = null;
let semantic: SemanticIndex | null = null;
let semanticDirty = true;
let pending: HiveChange[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function requireHive(): Hive {
  if (!hive) throw new Error('No hive is open.');
  return hive;
}

function summaries(h: Hive): NoteSummary[] {
  return [...h.notes.values()].map((n) => ({
    path: n.path,
    title: n.title,
    aliases: n.aliases,
    tags: n.tags,
    headings: n.headings.map((x) => ({ level: x.level, text: x.text, line: x.line })),
    blocks: n.blocks.map((b) => b.id),
    mtime: n.mtime,
    wordCount: n.wordCount,
  }));
}

function snapshot(h: Hive): HiveSnapshot {
  return { info: { root: h.root, name: h.name, settings: h.settings }, tree: h.tree(), files: h.list(), notes: summaries(h) };
}

async function openHive(path: string, create = false): Promise<HiveSnapshot> {
  const root = resolve(path);
  if (hive?.root === root) return snapshot(hive);
  await hive?.close();
  hive = await Hive.open(root, { watch: true, create });
  semantic = null;
  semanticDirty = true;
  await hive.agentsGuide();
  hive.on('change', (e: HiveEvent) => {
    semanticDirty = true;
    pending.push(e);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const batch = pending;
        pending = [];
        win?.webContents.send('hive:change', batch);
      }, 80);
    }
  });
  appState.recent = [{ path: root, name: hive.name, opened: Date.now() }, ...appState.recent.filter((r) => r.path !== root)].slice(0, 12);
  appState.lastHive = root;
  await saveState();
  win?.setTitle(`${hive.name} — Basalt`);
  return snapshot(hive);
}

// ---------- AI settings and keys ----------

interface AiStore {
  providers: Omit<ProviderConfig, 'apiKey'>[];
  keys: Record<string, string>;
  chatProvider: string | null;
  embeddings: string;
}

const aiPath = () => join(app.getPath('userData'), 'ai.json');
let ai: AiStore = { providers: [], keys: {}, chatProvider: null, embeddings: 'builtin' };
/** Keys held only in memory when the OS keychain isn't available. */
const memoryKeys = new Map<string, string>();
const keychain = () => safeStorage.isEncryptionAvailable();

async function loadAi() {
  try {
    ai = { ...ai, ...JSON.parse(await fs.readFile(aiPath(), 'utf8')) };
  } catch {
    /* defaults */
  }
}
async function saveAi() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(aiPath(), JSON.stringify(ai, null, 2), { mode: 0o600 });
}

function keyFor(id: string): string | undefined {
  if (memoryKeys.has(id)) return memoryKeys.get(id);
  const enc = ai.keys[id];
  if (!enc || !keychain()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return undefined;
  }
}

function providerConfig(id: string): ProviderConfig {
  const p = ai.providers.find((x) => x.id === id);
  if (!p) throw new Error('That model provider is no longer set up. Pick another in Settings → Assistant.');
  return { ...p, apiKey: keyFor(id) };
}

function aiSettings(): AiSettings {
  return {
    providers: ai.providers.map((p) => ({ ...p, hasKey: !!keyFor(p.id) })),
    chatProvider: ai.chatProvider,
    embeddings: ai.embeddings,
    keychain: keychain(),
  };
}

async function semanticIndex(): Promise<SemanticIndex> {
  const h = requireHive();
  if (!semantic) {
    const cfg = ai.embeddings !== 'builtin' && ai.providers.some((p) => p.id === ai.embeddings) ? providerConfig(ai.embeddings) : null;
    semantic = new SemanticIndex(h, createEmbedder(cfg));
    semanticDirty = true;
  }
  if (semanticDirty) {
    semanticDirty = false;
    await semantic.update((done, total) => win?.webContents.send('ai:index-progress', { done, total }));
  }
  return semantic;
}

const chats = new Map<string, AbortController>();

async function runChat(req: ChatStart) {
  const ctrl = new AbortController();
  chats.set(req.id, ctrl);
  const send = (e: object) => win?.webContents.send('ai:chat', { id: req.id, ...e });
  try {
    const h = requireHive();
    const cfg = providerConfig(req.providerId);
    if (!cfg.model) throw new Error(`Pick a model for ${cfg.label} in Settings → Assistant.`);
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    let retrieved: (SemanticHit & { text?: string })[] = [];
    if (req.context.useHive && lastUser) {
      const hits = (await (await semanticIndex()).topChunks(lastUser, 6)).filter((x) => x.path !== req.context.notePath);
      retrieved = await Promise.all(
        hits.map(async (hit) => {
          const section = hit.heading ? await h.readSubpath(hit.path, '#' + hit.heading).catch(() => '') : '';
          return { ...hit, text: (section || (await h.readSubpath(hit.path))).slice(0, 2500) };
        }),
      );
    }
    const currentNote = req.context.notePath && h.exists(req.context.notePath) ? { path: req.context.notePath, text: (await h.read(req.context.notePath)).slice(0, 60000) } : undefined;
    const system = buildSystemPrompt({ hiveName: h.name, agentsGuide: await h.agentsGuide(), currentNote, selection: req.context.selection, retrieved });
    for await (const text of createProvider(cfg).stream({ system, messages: req.messages, signal: ctrl.signal })) send({ type: 'delta', text });
    send({ type: 'done', sources: [...new Set(retrieved.map((r) => r.path))] });
  } catch (err) {
    if (ctrl.signal.aborted) send({ type: 'done', sources: [] });
    else send({ type: 'error', message: (err as Error).message });
  } finally {
    chats.delete(req.id);
  }
}

// ---------- IPC ----------

/** Only Basalt's own renderer may call into the main process. */
function trustedSender(e: Electron.IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  if (!win || e.sender.id !== win.webContents.id) return false;
  if (isDev) return url.startsWith(process.env.ELECTRON_RENDERER_URL!);
  return url.startsWith(pathToFileURL(join(here, '../renderer/')).toString());
}

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trustedSender(e)) throw new Error(`Blocked ${channel} from an untrusted frame`);
    return fn(...args);
  });
}

function registerIpc() {
  handle('app:recent', () => appState.recent.filter((r) => existsSync(r.path)));
  handle('app:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Open a folder as a hive' });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('app:openHive', (path: string, opts?: { create?: boolean }) => openHive(String(path), !!opts?.create));
  handle('app:closeHive', async () => {
    await hive?.close();
    hive = null;
    appState.lastHive = null;
    await saveState();
  });
  handle('app:sampleHivePath', async () => {
    const bundled = app.isPackaged ? join(process.resourcesPath, 'sample-hive') : resolve(here, '../../../../fixtures/sample-hive');
    if (!existsSync(bundled)) return null;
    // Copy so the original stays pristine.
    const dest = join(app.getPath('documents'), 'Basalt sample hive');
    if (!existsSync(dest)) await fs.cp(bundled, dest, { recursive: true });
    return dest;
  });
  handle('app:openExternal', (url: string) => {
    if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url);
  });
  handle('app:showInFolder', (path: string) => shell.showItemInFolder(requireHive().abs(path)));
  handle('app:cliCommand', () => {
    const cli = app.isPackaged ? join(process.resourcesPath, 'cli', 'basalt.mjs') : resolve(here, '../../../../packages/cli/dist/basalt.mjs');
    return `node "${cli}"`;
  });
  handle('app:initialHive', () => {
    const arg = process.argv.find((a) => a.startsWith('--hive='))?.slice(7) ?? process.env.BASALT_HIVE;
    if (arg && existsSync(arg)) return resolve(arg);
    return appState.lastHive && existsSync(appState.lastHive) ? appState.lastHive : null;
  });

  handle('hive:snapshot', () => snapshot(requireHive()));
  handle('hive:read', (p: string) => requireHive().read(p));
  handle('hive:readSubpath', (p: string, s?: string) => requireHive().readSubpath(p, s));
  handle('hive:write', async (p: string, t: string) => void (await requireHive().write(p, String(t))));
  handle('hive:create', (p: string, t?: string, tpl?: string) => requireHive().create(p, t ?? '', tpl ? { template: tpl } : {}));
  handle('hive:createFolder', (p: string) => requireHive().createFolder(p));
  handle('hive:rename', (a: string, b: string) => requireHive().rename(a, b));
  handle('hive:trash', (p: string) => requireHive().trash(p));
  handle('hive:toggleTask', (p: string, l: number) => requireHive().toggleTask(p, Number(l)));
  handle('hive:setProperties', (p: string, c: Record<string, unknown>) => requireHive().setProperties(p, c));
  handle('hive:backlinks', (p: string) => requireHive().backlinks(p));
  handle('hive:unlinked', (p: string) => requireHive().unlinkedMentions(p));
  handle('hive:search', (q: string) => requireHive().search(String(q), { limit: 200, matchesPerFile: 6 }));
  handle('hive:tags', () => requireHive().tags());
  handle('hive:graph', () => requireHive().graph({ includeUnresolved: true }));
  handle('hive:query', (q) => requireHive().query(q));
  handle('hive:properties', () => requireHive().properties());
  handle('hive:dailyNote', async (iso?: string) => (await requireHive().dailyNote(iso ? new Date(iso) : new Date())).path);
  handle('hive:uniqueNote', () => requireHive().uniqueNote());
  handle('hive:templates', () => requireHive().templates());
  handle('hive:saveSettings', (patch) => requireHive().saveSettings(patch));
  handle('hive:readConfig', (n: string) => requireHive().readConfig(n));
  handle('hive:writeConfig', (n: string, d: unknown) => requireHive().writeConfig(n, d));
  handle('hive:readConfigText', (n: string) => requireHive().readConfigText(n));
  handle('hive:writeConfigText', (n: string, t: string) => requireHive().writeConfigText(n, String(t)));
  handle('hive:snippets', async () => {
    const dir = join(requireHive().root, '.basalt', 'snippets');
    const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.css')).sort();
    return Promise.all(names.map(async (name) => ({ name, css: await fs.readFile(join(dir, name), 'utf8') })));
  });
  handle('hive:snapshots', (p: string) => requireHive().snapshots(p));
  handle('hive:readSnapshot', (p: string, f: string) => requireHive().readSnapshot(p, f));
  handle('hive:saveAttachment', async (name: string, data: Uint8Array) => {
    const h = requireHive();
    const folder = h.settings.attachments.folder;
    return h.writeBinary(`${folder ? folder + '/' : ''}${basename(String(name)).replace(/[\\/:*?"<>|]/g, '-')}`, data);
  });

  handle('ai:presets', () => PROVIDER_PRESETS);
  handle('ai:settings', () => aiSettings());
  handle('ai:saveProvider', async (p: ProviderSettings, apiKey?: string | null) => {
    const { hasKey: _ignored, ...cfg } = p;
    const i = ai.providers.findIndex((x) => x.id === cfg.id);
    if (i >= 0) ai.providers[i] = cfg;
    else ai.providers.push(cfg);
    if (apiKey === null) {
      delete ai.keys[cfg.id];
      memoryKeys.delete(cfg.id);
    } else if (apiKey) {
      if (keychain()) {
        ai.keys[cfg.id] = safeStorage.encryptString(apiKey).toString('base64');
        memoryKeys.delete(cfg.id);
      } else memoryKeys.set(cfg.id, apiKey);
    }
    if (!ai.chatProvider) ai.chatProvider = cfg.id;
    if (ai.embeddings === cfg.id) semantic = null;
    await saveAi();
    return aiSettings();
  });
  handle('ai:removeProvider', async (id: string) => {
    ai.providers = ai.providers.filter((p) => p.id !== id);
    delete ai.keys[id];
    memoryKeys.delete(id);
    if (ai.chatProvider === id) ai.chatProvider = ai.providers[0]?.id ?? null;
    if (ai.embeddings === id) {
      ai.embeddings = 'builtin';
      semantic = null;
    }
    await saveAi();
    return aiSettings();
  });
  handle('ai:setChatProvider', async (id: string | null) => {
    ai.chatProvider = id;
    await saveAi();
    return aiSettings();
  });
  handle('ai:setEmbeddings', async (id: string) => {
    ai.embeddings = id;
    semantic = null;
    await saveAi();
    return aiSettings();
  });
  handle('ai:listModels', (id: string) => createProvider(providerConfig(id)).listModels());
  handle('ai:chat', (req: ChatStart) => void runChat(req));
  handle('ai:cancel', (id: string) => chats.get(id)?.abort());
  handle('ai:semanticSearch', async (q: string) => (await semanticIndex()).search(String(q), 20));
  handle('ai:related', async (p: string, unlinkedOnly?: boolean) => (await semanticIndex()).related(p, 8, !!unlinkedOnly));
  handle('ai:reindex', async () => {
    semantic = null;
    const idx = await semanticIndex();
    return { chunks: idx.size };
  });
}

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Basalt',
    backgroundColor: '#fbf6ea',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else void win.loadFile(join(here, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  await Promise.all([loadState(), loadAi()]);

  // Attachments are served from the open hive only, with path validation.
  protocol.handle('basalt-file', async (request) => {
    try {
      const h = requireHive();
      const url = new URL(request.url);
      const rel = safeRelPath(decodeURIComponent(url.pathname.replace(/^\/+/, '')));
      return net.fetch(pathToFileURL(h.abs(rel)).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: basalt-file: https:; font-src 'self' data:; connect-src 'self' basalt-file:; frame-src 'none'; object-src 'none'; base-uri 'none'",
          ],
        },
      });
    });
  }

  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await hive?.close();
  if (process.platform !== 'darwin') app.quit();
});
