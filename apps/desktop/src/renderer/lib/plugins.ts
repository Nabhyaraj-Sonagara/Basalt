// The plugin host. Each enabled plugin runs in a hidden, sandboxed iframe (basalt-plugin://<id>/)
// with no network and no access to this window; it talks to Basalt only through postMessage, via
// the SDK in main/plugins.ts. Every request is checked here against the permissions the person
// approved for that plugin, and plugin commands join the command palette.
import type { PluginInfo, PluginManifest, PluginPermission } from '../../shared/api';
import { api, createNote, errorToast, openPath } from './actions';
import { COMMANDS } from './commands';
import { activeTab, getState, setState, subscribe, toast } from './store';
import { editorFor } from '../components/Editor';

export const PLUGIN_SANDBOX = 'allow-scripts';
export const pluginUrl = (id: string, file = '') => `basalt-plugin://${id}/${file.split('/').map(encodeURIComponent).join('/')}`;

export const PERMISSION_TEXT: Record<PluginPermission, string> = {
  read: 'Read your notes',
  write: 'Create and change notes',
};

interface Running {
  manifest: PluginManifest;
  frame: HTMLIFrameElement;
  commands: Set<string>;
}

const running = new Map<string, Running>();
/** Every plugin window that may message us (background frames and panels), and whose it is. */
const windows = new Map<Window, string>();
let host: HTMLDivElement | null = null;

const CONFIG = 'plugins.json';
type Config = { enabled?: Record<string, { permissions: PluginPermission[] }> };

function hostEl(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    host.className = 'plugin-host';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
  }
  return host;
}

/** Lets a plugin's panel iframe talk to the host too. Returns an unregister function. */
export function registerPluginWindow(win: Window | null | undefined, id: string): () => void {
  if (!win) return () => {};
  windows.set(win, id);
  return () => windows.delete(win);
}

/** Permissions the plugin asks for that it hasn't been given yet. */
export function missingPermissions(m: PluginManifest, granted: PluginPermission[] | undefined): PluginPermission[] {
  return m.permissions.filter((p) => !granted?.includes(p));
}

function stop(id: string): void {
  const r = running.get(id);
  if (!r) return;
  for (const c of r.commands) {
    const i = COMMANDS.findIndex((x) => x.id === c);
    if (i >= 0) COMMANDS.splice(i, 1);
  }
  if (r.frame.contentWindow) windows.delete(r.frame.contentWindow);
  r.frame.remove();
  running.delete(id);
  setState((s) => {
    const { [id]: _gone, ...rest } = s.pluginStatus;
    return { pluginStatus: rest };
  });
}

function start(manifest: PluginManifest): void {
  stop(manifest.id);
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', PLUGIN_SANDBOX);
  frame.title = `Plugin: ${manifest.name}`;
  frame.dataset.plugin = manifest.id;
  hostEl().appendChild(frame);
  // Register before the script can send anything.
  if (frame.contentWindow) windows.set(frame.contentWindow, manifest.id);
  frame.src = pluginUrl(manifest.id);
  running.set(manifest.id, { manifest, frame, commands: new Set() });
}

/** Reads .basalt/plugins and starts the enabled ones (again). Call when a hive opens. */
export async function loadPlugins(): Promise<void> {
  for (const id of [...running.keys()]) stop(id);
  if (!getState().hive) return setState({ plugins: [], pluginsEnabled: {} });
  const [list, cfg] = await Promise.all([api().plugins.list(), api().hive.readConfig<Config>(CONFIG)]);
  const enabled = Object.fromEntries(Object.entries(cfg?.enabled ?? {}).map(([id, v]) => [id, v.permissions ?? []]));
  setState({ plugins: list, pluginsEnabled: enabled });
  for (const p of list) {
    if (!p.manifest || !enabled[p.manifest.id]) continue;
    // A plugin that now asks for more than was approved stays off until it's approved again.
    if (missingPermissions(p.manifest, enabled[p.manifest.id]).length) continue;
    start(p.manifest);
  }
}

async function saveEnabled(enabled: Record<string, PluginPermission[]>): Promise<void> {
  setState({ pluginsEnabled: enabled });
  await api().hive.writeConfig(CONFIG, { enabled: Object.fromEntries(Object.entries(enabled).map(([id, permissions]) => [id, { permissions }])) } satisfies Config);
}

/** Turns a plugin on (after the person approved its permissions) or off. */
export async function setPluginEnabled(p: PluginInfo, on: boolean): Promise<void> {
  const m = p.manifest;
  if (!m) return;
  const enabled = { ...getState().pluginsEnabled };
  if (on) {
    enabled[m.id] = [...m.permissions];
    await saveEnabled(enabled);
    start(m);
  } else {
    delete enabled[m.id];
    await saveEnabled(enabled);
    stop(m.id);
  }
}

export const isRunning = (id: string) => running.has(id);

// ---------- requests from plugins ----------

type Handler = (id: string, params: Record<string, unknown>) => unknown;

const need = (id: string, perm: PluginPermission) => {
  if (!getState().pluginsEnabled[id]?.includes(perm)) throw new Error(`This plugin wasn't allowed to ${PERMISSION_TEXT[perm].toLowerCase()}.`);
};
const text = (v: unknown, name: string, max = 5_000_000): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error(`"${name}" must be text`);
  return v;
};
const notePath = (v: unknown): string => {
  const p = text(v, 'path', 1000).replace(/^\/+/, '');
  if (!p || p.split('/').some((s) => s === '..' || s === '' || s.startsWith('.'))) throw new Error('That path is outside the hive’s notes');
  return /\.[a-z0-9]+$/i.test(p) ? p : `${p}.md`;
};

const HANDLERS: Record<string, Handler> = {
  'commands.add': (id, p) => {
    const r = running.get(id);
    if (!r) throw new Error('Commands can only be added from a plugin’s main script');
    const local = text(p.id, 'id', 80);
    const cmdId = `plugin:${id}:${local}`;
    const name = `${r.manifest.name}: ${text(p.name, 'name', 80)}`;
    const existing = COMMANDS.find((c) => c.id === cmdId);
    if (existing) existing.name = name;
    else
      COMMANDS.push({
        id: cmdId,
        name,
        icon: 'command',
        run: () => r.frame.contentWindow?.postMessage({ basalt: 1, event: 'command', command: local }, '*'),
      });
    r.commands.add(cmdId);
    return true;
  },
  'commands.remove': (id, p) => {
    const cmdId = `plugin:${id}:${text(p.id, 'id', 80)}`;
    const i = COMMANDS.findIndex((c) => c.id === cmdId);
    if (i >= 0) COMMANDS.splice(i, 1);
    running.get(id)?.commands.delete(cmdId);
    return true;
  },
  'ui.toast': (id, p) => {
    const name = getState().plugins.find((x) => x.manifest?.id === id)?.manifest?.name ?? id;
    toast({ tone: p.tone === 'danger' ? 'danger' : p.tone === 'success' ? 'success' : 'neutral', title: text(p.message, 'message', 300), body: `From ${name}` });
    return true;
  },
  'ui.status': (id, p) => {
    const t = p.text == null ? '' : text(p.text, 'text', 80);
    setState((s) => ({ pluginStatus: { ...s.pluginStatus, [id]: t } }));
    return true;
  },
  'notes.active': (id) => {
    need(id, 'read');
    const tab = activeTab();
    if (tab?.kind !== 'note' || !tab.path) return null;
    const view = editorFor(tab.id);
    const doc = view?.state.doc.toString();
    const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : '';
    return Promise.resolve(doc ?? api().hive.read(tab.path)).then((t) => ({ path: tab.path, title: getState().notesByPath.get(tab.path!)?.title, text: t, selection: sel }));
  },
  'notes.list': (id) => {
    need(id, 'read');
    return [...getState().notesByPath.values()].map((n) => ({ path: n.path, title: n.title, tags: n.tags, mtime: n.mtime, words: n.wordCount }));
  },
  'notes.read': (id, p) => {
    need(id, 'read');
    return api().hive.read(notePath(p.path));
  },
  'notes.search': async (id, p) => {
    need(id, 'read');
    return (await api().hive.search(text(p.query, 'query', 500))).slice(0, 50);
  },
  'notes.create': async (id, p) => {
    need(id, 'write');
    const path = notePath(p.path);
    return createNote(path.replace(/\.md$/i, ''), { exactPath: true, text: p.text == null ? '' : text(p.text, 'text') });
  },
  'notes.write': async (id, p) => {
    need(id, 'write');
    const path = notePath(p.path);
    if (!getState().notesByPath.has(path)) throw new Error(`No note at ${path}; use notes.create`);
    await api().hive.write(path, text(p.text, 'text'));
    return true;
  },
  'notes.append': async (id, p) => {
    need(id, 'write');
    const path = notePath(p.path);
    const cur = getState().notesByPath.has(path) ? await api().hive.read(path) : '';
    await api().hive.write(path, `${cur.replace(/\s*$/, '')}${cur.trim() ? '\n\n' : ''}${text(p.text, 'text')}\n`);
    return true;
  },
  'notes.open': (id, p) => {
    need(id, 'read');
    const path = notePath(p.path);
    if (!getState().notesByPath.has(path)) throw new Error(`No note at ${path}`);
    openPath(path);
    return true;
  },
  'editor.insert': (id, p) => {
    need(id, 'write');
    const tab = activeTab();
    const view = tab ? editorFor(tab.id) : undefined;
    if (!view) throw new Error('No note is open for editing');
    const t = text(p.text, 'text');
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: t }, selection: { anchor: from + t.length }, scrollIntoView: true });
    return true;
  },
};

window.addEventListener('message', (e) => {
  const id = e.source ? windows.get(e.source as Window) : undefined;
  if (!id) return; // not one of our plugin frames
  const m = e.data as { basalt?: number; id?: number; method?: string; params?: Record<string, unknown> } | null;
  if (!m || m.basalt !== 1 || typeof m.id !== 'number' || typeof m.method !== 'string') return;
  const reply = (body: object) => (e.source as Window).postMessage({ basalt: 1, re: m.id, ...body }, '*');
  const handler = Object.hasOwn(HANDLERS, m.method) ? HANDLERS[m.method] : undefined;
  if (!handler) return reply({ error: `Unknown method ${m.method}` });
  Promise.resolve()
    .then(() => handler(id, m.params && typeof m.params === 'object' ? m.params : {}))
    .then(
      (result) => reply({ result: result ?? null }),
      (err: Error) => reply({ error: err?.message ?? String(err) }),
    );
});

// Tell running plugins which note is open.
let lastPath: string | null | undefined;
subscribe(() => {
  const tab = activeTab();
  const path = tab?.kind === 'note' ? tab.path : null;
  if (path === lastPath) return;
  lastPath = path;
  for (const [pid, r] of running) {
    if (getState().pluginsEnabled[pid]?.includes('read')) r.frame.contentWindow?.postMessage({ basalt: 1, event: 'note-open', data: { path } }, '*');
  }
});

/** For Settings: remove a plugin's folder (to the system trash). */
export async function removePlugin(p: PluginInfo): Promise<void> {
  try {
    if (p.manifest) await setPluginEnabled(p, false);
    await api().plugins.remove(p.folder);
    await loadPlugins();
    toast({ tone: 'neutral', title: `Removed ${p.manifest?.name ?? p.folder}` });
  } catch (err) {
    errorToast("Couldn't remove the plugin", err);
  }
}
