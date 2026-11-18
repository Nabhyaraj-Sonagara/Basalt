import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hive, parseBasaltUri, safeRelPath, type HiveEvent } from '@basalt/core';
import {
  PROVIDER_PRESETS,
  SemanticIndex,
  buildSystemPrompt,
  createEmbedder,
  createProvider,
  extractIllustration,
  illustrationPrompt,
  type ProviderConfig,
  type SemanticHit,
} from '@basalt/ai';
import type { AiSettings, AppInfo, ChatStart, IllustrateRequest, ConnectClientId, HiveChange, HiveSnapshot, NoteSummary, ProviderSettings, UriRequest } from '../shared/api';
import { editableContextMenu, installMenu } from './menu';
import { checkForUpdates, initUpdater, installUpdate, updateStatus } from './updater';
import { SyncController } from './sync';
import { startMcpMode } from './mcp-mode';
import { connectClient, connectStatus, disconnectClient, mcpLaunchCommand } from './connect';
import { detectLocalModels, signInWithOpenRouter } from './openrouter';

const isDev = !!process.env.ELECTRON_RENDERER_URL;
const here = import.meta.dirname;

const MCP_MODE = process.argv.includes('--mcp');

if (!MCP_MODE) protocol.registerSchemesAsPrivileged([
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
/** The main window. */
let win: BrowserWindow | null = null;
/** Pop-out windows, each showing one note. */
const popouts = new Set<BrowserWindow>();

function broadcast(channel: string, payload: unknown) {
  for (const w of [win, ...popouts]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function closePopouts() {
  for (const w of popouts) w.close();
  popouts.clear();
}
let semantic: SemanticIndex | null = null;
const sync = new SyncController((s) => broadcast('sync:status', s));
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
    view: typeof n.frontmatter.view === 'string' ? n.frontmatter.view : undefined,
  }));
}

function snapshot(h: Hive): HiveSnapshot {
  return { info: { root: h.root, name: h.name, settings: h.settings }, tree: h.tree(), files: h.list(), notes: summaries(h) };
}

async function openHive(path: string, create = false): Promise<HiveSnapshot> {
  const root = resolve(path);
  if (hive?.root === root) return snapshot(hive);
  closePopouts();
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
        broadcast('hive:change', batch);
      }, 80);
    }
  });
  appState.recent = [{ path: root, name: hive.name, opened: Date.now() }, ...appState.recent.filter((r) => r.path !== root)].slice(0, 12);
  appState.lastHive = root;
  await saveState();
  win?.setTitle(`${hive.name} — Basalt`);
  void sync.attach(hive);
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
    await semantic.update((done, total) => broadcast('ai:index-progress', { done, total }));
  }
  return semantic;
}

const chats = new Map<string, AbortController>();

async function runChat(req: ChatStart, to: Electron.WebContents) {
  const ctrl = new AbortController();
  chats.set(req.id, ctrl);
  const send = (e: object) => {
    if (!to.isDestroyed()) to.send('ai:chat', { id: req.id, ...e });
  };
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

const illustrations = new Map<string, AbortController>();

/** One answer from the chat model: a mind-map outline or Mermaid source for a note or a picture. */
async function illustrate(req: IllustrateRequest): Promise<{ text: string }> {
  const h = requireHive();
  const id = req.providerId ?? ai.chatProvider;
  if (!id) throw new Error('Set up a model in Settings → Assistant first.');
  const cfg = providerConfig(id);
  if (!cfg.model) throw new Error(`Pick a model for ${cfg.label} in Settings → Assistant.`);
  const note = req.notePath && h.exists(req.notePath) ? await h.read(req.notePath) : undefined;
  const title = req.notePath ? h.notes.get(req.notePath)?.title : undefined;
  const { system, user } = illustrationPrompt({ kind: req.kind, title, text: note, hasImage: !!req.image, instructions: req.instructions });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);
  if (req.id) illustrations.set(req.id, ctrl);
  try {
    let out = '';
    const messages = [{ role: 'user' as const, content: user, ...(req.image ? { images: [req.image] } : {}) }];
    for await (const t of createProvider(cfg).stream({ system, messages, maxTokens: 8000, signal: ctrl.signal })) out += t;
    return { text: extractIllustration(req.kind, out) };
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error(req.id && !illustrations.has(req.id) ? 'Cancelled.' : 'The model took too long to answer.');
    const msg = (err as Error).message;
    if (req.image && /image|vision|multimodal|modalit/i.test(msg)) throw new Error(`${cfg.label} (${cfg.model}) can't read pictures. Pick a model that can see images in Settings → Assistant. ${msg}`);
    throw err;
  } finally {
    clearTimeout(timer);
    if (req.id) illustrations.delete(req.id);
  }
}

async function saveProvider(p: ProviderSettings, apiKey?: string | null): Promise<AiSettings> {
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
}

// ---------- IPC ----------

/** Only Basalt's own renderer may call into the main process. */
function trustedSender(e: Electron.IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || (w !== win && !popouts.has(w))) return false;
  if (e.senderFrame !== e.sender.mainFrame) return false;
  if (isDev) return url.startsWith(process.env.ELECTRON_RENDERER_URL!);
  return url.startsWith(pathToFileURL(join(here, '../renderer/')).toString());
}

function handle(channel: string, fn: (this: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trustedSender(e)) throw new Error(`Blocked ${channel} from an untrusted frame`);
    return fn.apply(e, args);
  });
}

// ---------- basalt:// links ----------

let pendingUri: UriRequest | null = null;

/** Resolves a link's hive to one the user has opened before; links can't open arbitrary folders. */
function resolveUri(url: string): UriRequest | null {
  const u = parseBasaltUri(url);
  if (!u) return null;
  const { hive: wanted, ...rest } = u;
  if (!wanted) {
    const path = hive?.root ?? (appState.lastHive && existsSync(appState.lastHive) ? appState.lastHive : null);
    return path ? { ...rest, hivePath: path } : { ...rest, hivePath: null, error: 'Open a hive in Basalt first, then try the link again.' };
  }
  const match =
    appState.recent.find((r) => r.path === resolve(wanted)) ??
    appState.recent.find((r) => r.name.toLowerCase() === wanted.toLowerCase());
  if (!match || !existsSync(match.path)) return { ...rest, hivePath: null, error: `Basalt hasn't opened a hive called “${wanted}” on this computer. Open it once, then try the link again.` };
  return { ...rest, hivePath: match.path };
}

function handleUrl(url: string) {
  const req = resolveUri(url);
  if (!req) return;
  if (win && !win.isDestroyed() && win.webContents.getURL()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('app:uri', req);
  } else pendingUri = req;
}

const uriArg = (argv: string[]) => argv.find((a) => /^basalt:/i.test(a));

function sendCommand(id: string) {
  const w = BrowserWindow.getFocusedWindow() ?? win;
  w?.webContents.send('app:command', id);
}

function registerIpc() {
  handle('app:recent', () => appState.recent.filter((r) => existsSync(r.path)));
  handle('app:pickFolder', async function () {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(this.sender)!, { properties: ['openDirectory', 'createDirectory'], title: 'Open a folder as a hive' });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('app:openHive', (path: string, opts?: { create?: boolean }) => openHive(String(path), !!opts?.create));
  handle('app:closeHive', async () => {
    closePopouts();
    await sync.attach(null);
    await hive?.close();
    hive = null;
    appState.lastHive = null;
    await saveState();
  });
  handle('app:sampleHivePath', async () => {
    const bundled = app.isPackaged ? join(process.resourcesPath, 'sample-hive') : resolve(here, '../../../../fixtures/sample-hive');
    if (!existsSync(bundled)) return null;
    // Copy so the original stays pristine.
    // BASALT_DOCUMENTS_DIR lets tests keep the copy out of the real Documents folder.
    const dest = join(process.env.BASALT_DOCUMENTS_DIR || app.getPath('documents'), 'Basalt sample hive');
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

  handle('app:saveTextFile', async function (name: string, text: string) {
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(this.sender)!, { defaultPath: basename(String(name)) });
    if (res.canceled || !res.filePath) return null;
    await fs.writeFile(res.filePath, String(text));
    return res.filePath;
  });
  handle('app:openTextFile', async function (extensions: string[]) {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(this.sender)!, {
      properties: ['openFile'],
      filters: [{ name: 'Basalt files', extensions: (extensions ?? []).map((e) => String(e).replace(/^\./, '')) }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const st = await fs.stat(res.filePaths[0]);
    if (st.size > 2_000_000) throw new Error('That file is too large.');
    return fs.readFile(res.filePaths[0], 'utf8');
  });
  handle('app:info', function (): AppInfo {
    const hash = decodeURIComponent(new URL(this.sender.getURL()).hash.slice(1));
    return { version: app.getVersion(), platform: process.platform, popout: hash.startsWith('popout=') ? hash.slice(7) : null };
  });
  handle('app:popout', (p: string) => {
    const path = safeRelPath(String(p));
    if (!requireHive().exists(path)) throw new Error(`No such note: ${path}`);
    createWindow(path);
  });
  handle('app:setSpellcheck', (on: boolean) => session.defaultSession.setSpellCheckerEnabled(!!on));
  handle('app:takePendingUri', () => {
    const u = pendingUri;
    pendingUri = null;
    return u;
  });
  handle('app:checkForUpdates', () => checkForUpdates());
  handle('app:installUpdate', () => installUpdate());
  handle('app:updateStatus', () => updateStatus());

  handle('sync:status', () => sync.getStatus());
  handle('sync:setServer', (url: string) => sync.setServer(String(url)));
  handle('sync:signUp', (email: string, password: string) => sync.signUp(String(email), String(password)));
  handle('sync:signIn', (email: string, password: string) => sync.signIn(String(email), String(password)));
  handle('sync:signOut', () => sync.signOut());
  handle('sync:usage', () => sync.usage());
  handle('sync:remoteHives', () => sync.remoteHives());
  handle('sync:connect', (remoteId: string | null) => sync.connect(remoteId ? String(remoteId) : null));
  handle('sync:disconnect', () => sync.disconnect());
  handle('sync:setPaused', (paused: boolean) => sync.setPaused(!!paused));
  handle('sync:now', () => sync.runNow());

  handle('hive:snapshot', () => snapshot(requireHive()));
  handle('hive:merge', (a: string, b: string) => requireHive().merge(String(a), String(b)));
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
  handle('ai:saveProvider', (p: ProviderSettings, apiKey?: string | null) => saveProvider(p, apiKey));
  handle('ai:signInOpenRouter', async () => {
    const key = await signInWithOpenRouter((url) => shell.openExternal(url));
    const preset = PROVIDER_PRESETS.find((x) => x.id === 'openrouter')!;
    const existing = ai.providers.find((x) => x.id === 'openrouter');
    const settings = await saveProvider({ id: 'openrouter', kind: preset.kind, label: 'OpenRouter', baseUrl: preset.baseUrl, model: existing?.model || 'openrouter/auto', hasKey: true }, key);
    ai.chatProvider = 'openrouter';
    await saveAi();
    return { ...settings, chatProvider: 'openrouter' };
  });
  handle('ai:detectLocal', () => detectLocalModels());
  handle('ai:useLocal', async (id: 'ollama' | 'lmstudio', model: string, embeddingModel?: string) => {
    const found = (await detectLocalModels()).find((x) => x.id === id);
    if (!found) throw new Error('That model server isn\'t running any more.');
    const preset = PROVIDER_PRESETS.find((x) => x.id === id)!;
    await saveProvider({ id, kind: preset.kind, label: preset.label, baseUrl: found.baseUrl, model: String(model), embeddingModel: embeddingModel ? String(embeddingModel) : undefined, hasKey: false });
    ai.chatProvider = id;
    if (embeddingModel) {
      ai.embeddings = id;
      semantic = null;
    }
    await saveAi();
    return aiSettings();
  });
  handle('connect:status', () => connectStatus(requireHive().name));
  handle('connect:add', (id: ConnectClientId) => connectClient(id, requireHive().name, requireHive().root));
  handle('connect:remove', (id: ConnectClientId) => disconnectClient(id, requireHive().name));
  handle('connect:launchCommand', () => mcpLaunchCommand(requireHive().root));
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
  handle('ai:chat', function (req: ChatStart) {
    void runChat(req, this.sender);
  });
  handle('ai:cancel', (id: string) => chats.get(id)?.abort());
  handle('ai:illustrate', (req: IllustrateRequest) => illustrate(req));
  handle('ai:cancelIllustrate', (id: string) => {
    const c = illustrations.get(id);
    illustrations.delete(id);
    c?.abort();
  });
  handle('ai:semanticSearch', async (q: string) => (await semanticIndex()).search(String(q), 20));
  handle('ai:related', async (p: string, unlinkedOnly?: boolean) => (await semanticIndex()).related(p, 8, !!unlinkedOnly));
  handle('ai:reindex', async () => {
    semantic = null;
    const idx = await semanticIndex();
    return { chunks: idx.size };
  });
}

// ---------- window ----------

function createWindow(popout?: string) {
  const w = new BrowserWindow({
    width: popout ? 760 : 1360,
    height: popout ? 820 : 860,
    minWidth: popout ? 420 : 720,
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
      // Turned on and off by the editor's spellcheck setting (session.setSpellCheckerEnabled).
      spellcheck: true,
    },
  });
  if (popout) {
    popouts.add(w);
    w.on('closed', () => popouts.delete(w));
  } else {
    win = w;
    w.on('closed', () => {
      if (win === w) win = null;
      closePopouts();
    });
  }
  w.once('ready-to-show', () => w.show());
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  w.webContents.on('context-menu', (_e, params) => editableContextMenu(w.webContents, params, (id) => w.webContents.send('app:command', id)));
  const hash = popout ? `popout=${encodeURIComponent(popout)}` : undefined;
  if (isDev) void w.loadURL(process.env.ELECTRON_RENDERER_URL! + (hash ? `#${hash}` : ''));
  else void w.loadFile(join(here, '../renderer/index.html'), hash ? { hash } : undefined);
  if (popout) w.setTitle(`${basename(popout).replace(/\.md$/i, '')} — Basalt`);
  return w;
}

// `--mcp`: run as an MCP server for Claude Desktop, Claude Code or Codex instead of the app.
if (MCP_MODE) {
  startMcpMode();
} else {
  let stateLoaded = false;
  const earlyUrls: string[] = [];

  // One running copy: a second launch (or a basalt:// link) hands its arguments to this one.
  const primary = app.requestSingleInstanceLock();
  if (!primary) app.quit();
  app.on('second-instance', (_e, argv) => {
    const url = uriArg(argv);
    if (url) handleUrl(url);
    else if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // macOS delivers links here, including the one that launched the app.
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (stateLoaded) handleUrl(url);
    else earlyUrls.push(url);
  });
  if (app.isPackaged) app.setAsDefaultProtocolClient('basalt');

  app.whenReady().then(async () => {
    if (!primary) return;
    await Promise.all([loadState(), loadAi(), sync.load()]);
    app.setAboutPanelOptions({ applicationName: 'Basalt', applicationVersion: app.getVersion(), website: 'https://nabhyaraj-sonagara.github.io/Basalt/' });
    session.defaultSession.setSpellCheckerEnabled(false);

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
    installMenu({ command: sendCommand, checkForUpdates: () => {
      checkForUpdates();
      sendCommand('show-updates');
    }, isDev });
    stateLoaded = true;
    const launchUrl = uriArg(process.argv);
    for (const url of [...earlyUrls, ...(launchUrl ? [launchUrl] : [])]) handleUrl(url);
    createWindow();
    void initUpdater((s) => broadcast('app:update', s));
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', async () => {
    await hive?.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
