// Plugins: folders in <hive>/.basalt/plugins/<id>/ with a manifest.json and a main.js.
//
// They run like HTML pages (see pages.ts): in sandboxed iframes on their own scheme
// (basalt-plugin://<id>/…) with no network access, so a plugin can't reach Basalt, the web or the
// disk directly. All it can do is message the window through the SDK below; the renderer answers
// only the requests its manifest declared and the person approved when turning it on.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { safeRelPath } from '@basalt/core';
import { PAGE_CSP, pageContentType } from './pages';

export const PLUGIN_SCHEME = 'basalt-plugin';
export const PLUGIN_CSP = PAGE_CSP.replaceAll('basalt-page:', `${PLUGIN_SCHEME}:`);
export const PERMISSIONS = ['read', 'write'] as const;
export type PluginPermission = (typeof PERMISSIONS)[number];

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** What the plugin may ask for: read notes, change notes. Commands, toasts and the status bar need none. */
  permissions: PluginPermission[];
  /** Script that runs in the background while the plugin is on (default main.js). */
  main: string;
  /** Optional HTML page shown in the right sidebar's Plugins panel. */
  panel?: string;
}

export interface PluginInfo {
  folder: string;
  manifest?: PluginManifest;
  error?: string;
}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const RESERVED = new Set(['sdk', 'basalt']);
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);
const file = (v: unknown, fallback?: string) => {
  const s = str(v) ?? fallback;
  if (!s) return undefined;
  const p = safeRelPath(s);
  return p;
};

/** Checks a manifest; throws with a message a person can act on. */
export function parseManifest(raw: unknown, folder: string): PluginManifest {
  if (!raw || typeof raw !== 'object') throw new Error('manifest.json must be a JSON object');
  const o = raw as Record<string, unknown>;
  const id = str(o.id, 41);
  if (!id || !ID.test(id) || RESERVED.has(id)) throw new Error('"id" must be 2–41 lowercase letters, digits or dashes (not "sdk" or "basalt")');
  if (id !== folder) throw new Error(`"id" (${id}) must match the folder name (${folder})`);
  const name = str(o.name, 60);
  if (!name) throw new Error('"name" is required');
  const version = str(o.version, 30);
  if (!version) throw new Error('"version" is required');
  const perms = o.permissions ?? [];
  if (!Array.isArray(perms) || perms.some((p) => !PERMISSIONS.includes(p as PluginPermission))) throw new Error(`"permissions" may only list ${PERMISSIONS.map((p) => `"${p}"`).join(' and ')}`);
  const main = file(o.main, 'main.js')!;
  if (!/\.m?js$/.test(main)) throw new Error('"main" must be a .js file');
  const panel = file(o.panel);
  if (panel && !/\.html?$/.test(panel)) throw new Error('"panel" must be an .html file');
  return { id, name, version, description: str(o.description, 300), author: str(o.author, 100), permissions: [...new Set(perms as PluginPermission[])], main, ...(panel ? { panel } : {}) };
}

/** Every folder in .basalt/plugins, with its manifest or the reason it can't load. */
export async function listPlugins(dir: string): Promise<PluginInfo[]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  } catch {
    return [];
  }
  return Promise.all(
    names.sort().map(async (folder): Promise<PluginInfo> => {
      try {
        const manifest = parseManifest(JSON.parse(await fs.readFile(join(dir, folder, 'manifest.json'), 'utf8')), folder);
        await fs.access(join(dir, folder, manifest.main));
        return { folder, manifest };
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        return { folder, error: e.code === 'ENOENT' ? `Missing ${e.path?.split(/[\\/]/).pop() ?? 'file'}` : e instanceof SyntaxError ? `manifest.json isn't valid JSON: ${e.message}` : e.message };
      }
    }),
  );
}

/** The SDK every plugin frame gets as `window.basalt`. Kept small and dependency-free. */
export const SDK_JS = `(() => {
  let seq = 0;
  const pending = new Map();
  const commands = new Map();
  const listeners = {};
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      parent.postMessage({ basalt: 1, id, method, params }, '*');
    });
  addEventListener('message', (e) => {
    if (e.source !== parent) return; // only Basalt itself, never another frame
    const m = e.data;
    if (!m || m.basalt !== 1) return;
    if (m.re) {
      const p = pending.get(m.re);
      if (!p) return;
      pending.delete(m.re);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.result);
    } else if (m.event === 'command') {
      const run = commands.get(m.command);
      if (run) Promise.resolve().then(run).catch((err) => call('ui.toast', { message: String(err && err.message || err), tone: 'danger' }));
    } else if (m.event) {
      for (const f of listeners[m.event] || []) f(m.data);
    }
  });
  window.basalt = Object.freeze({
    commands: {
      add(cmd, run) {
        commands.set(cmd.id, run);
        return call('commands.add', { id: cmd.id, name: cmd.name });
      },
      remove(id) {
        commands.delete(id);
        return call('commands.remove', { id });
      },
    },
    notes: {
      active: () => call('notes.active'),
      list: () => call('notes.list'),
      read: (path) => call('notes.read', { path }),
      search: (query) => call('notes.search', { query }),
      create: (path, text) => call('notes.create', { path, text }),
      write: (path, text) => call('notes.write', { path, text }),
      append: (path, text) => call('notes.append', { path, text }),
      open: (path) => call('notes.open', { path }),
    },
    editor: { insert: (text) => call('editor.insert', { text }) },
    ui: {
      toast: (message, tone) => call('ui.toast', { message, tone }),
      status: (text) => call('ui.status', { text }),
    },
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
  });
})();
`;

const headers = (type: string) => ({ 'Content-Type': type, 'Content-Security-Policy': PLUGIN_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });

/**
 * Answers basalt-plugin://<id>/<file>. basalt-plugin://<id>/ is the background page that loads the
 * SDK and the plugin's main script; HTML files (the panel) get the SDK added in front.
 */
export async function pluginResponse(pluginsDir: string, url: string): Promise<Response> {
  try {
    const u = new URL(url);
    const id = u.hostname;
    if (id === 'sdk') return new Response(SDK_JS, { headers: headers('text/javascript; charset=utf-8') });
    if (!ID.test(id)) return new Response('Not found', { status: 404 });
    const manifest = parseManifest(JSON.parse(await fs.readFile(join(pluginsDir, id, 'manifest.json'), 'utf8')), id);
    const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    if (!rel) {
      const doc = `<!doctype html><meta charset="utf-8"><script src="${PLUGIN_SCHEME}://sdk/basalt.js"></script><script src="${PLUGIN_SCHEME}://${id}/${manifest.main.split('/').map(encodeURIComponent).join('/')}"></script>`;
      return new Response(doc, { headers: headers('text/html; charset=utf-8') });
    }
    const path = safeRelPath(rel);
    const type = pageContentType(path);
    if (!type || path === 'manifest.json') return new Response('Not allowed', { status: 403 });
    const body = await fs.readFile(join(pluginsDir, id, path));
    if (type.startsWith('text/html')) return new Response(`<script src="${PLUGIN_SCHEME}://sdk/basalt.js"></script>\n${body.toString('utf8')}`, { headers: headers(type) });
    return new Response(new Uint8Array(body), { headers: headers(type) });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
