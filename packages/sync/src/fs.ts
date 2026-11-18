// The local side of sync: a hive folder on disk, minus files that shouldn't travel.
import { promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export interface LocalFile {
  path: string;
  size: number;
  mtime: number;
}

export interface SyncFs {
  list(): Promise<LocalFile[]>;
  read(path: string): Promise<Buffer>;
  /** Writes atomically, creating folders, and returns the new size and mtime. */
  write(path: string, data: Uint8Array, mtime?: number): Promise<LocalFile>;
  remove(path: string): Promise<void>;
  stat(path: string): Promise<LocalFile | null>;
}

const SKIP_NAMES = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db', 'desktop.ini', '.trash', '.Trash', '.obsidian']);
/** App state that is per device, rebuilt locally, or already a copy. */
const SKIP_PATHS = ['.basalt/index', '.basalt/snapshots', '.basalt/trash', '.basalt/workspace.json', '.basalt/sync'];
const TEMP = /(\.\d+\.\d+\.tmp|\.basalt-sync\.tmp)$/;

/**
 * Sync carries notes, not attachments: Markdown (mind maps are Markdown too), canvases, HTML pages
 * and the small text files Basalt keeps beside them (settings, plugins, themes). Images, PDFs,
 * audio, video and other binaries stay on the device they were added on.
 */
export const NOTE_EXTENSIONS: ReadonlySet<string> = new Set([
  'md', 'markdown', 'txt', 'canvas', 'html', 'htm', 'css', 'js', 'mjs', 'json', 'csv', 'tsv', 'svg', 'yml', 'yaml',
]);

/** Whether a hive-relative path is synced. */
export function isSynced(path: string): boolean {
  if (TEMP.test(path)) return false;
  if (path.split('/').some((s) => SKIP_NAMES.has(s))) return false;
  return !SKIP_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}

/** Whether a file at this path is the kind sync carries (see NOTE_EXTENSIONS). Folders aren't checked. */
export function isNoteFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && NOTE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Whether sync carries the file at this path. */
export const syncsFile = (path: string) => isSynced(path) && isNoteFile(path);

function safe(root: string, rel: string): string {
  if (!rel || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '' || s === '.') || rel.includes('\\') || rel.includes('\0')) {
    throw new Error(`Refusing an unsafe path from the server: ${rel}`);
  }
  const abs = join(root, rel);
  if (relative(root, abs).startsWith('..')) throw new Error(`Refusing a path outside the hive: ${rel}`);
  return abs;
}

export class NodeSyncFs implements SyncFs {
  constructor(readonly root: string) {}

  async list(): Promise<LocalFile[]> {
    const out: LocalFile[] = [];
    const walk = async (dir: string) => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = join(dir, e.name);
        const rel = relative(this.root, abs).split(sep).join('/');
        if (!isSynced(rel)) continue;
        if (e.isDirectory()) await walk(abs);
        else if (e.isFile()) {
          if (!isNoteFile(rel)) continue;
          const st = await fs.stat(abs).catch(() => null);
          if (st) out.push({ path: rel, size: st.size, mtime: Math.floor(st.mtimeMs) });
        }
      }
    };
    await walk(this.root);
    return out;
  }

  read(path: string): Promise<Buffer> {
    return fs.readFile(safe(this.root, path));
  }

  async write(path: string, data: Uint8Array, mtime?: number): Promise<LocalFile> {
    const abs = safe(this.root, path);
    await fs.mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.basalt-sync.tmp`;
    await fs.writeFile(tmp, data);
    if (mtime) await fs.utimes(tmp, new Date(), new Date(mtime)).catch(() => {});
    await fs.rename(tmp, abs);
    const st = await fs.stat(abs);
    return { path, size: st.size, mtime: Math.floor(st.mtimeMs) };
  }

  async remove(path: string): Promise<void> {
    await fs.rm(safe(this.root, path), { force: true });
  }

  async stat(path: string): Promise<LocalFile | null> {
    const st = await fs.stat(safe(this.root, path)).catch(() => null);
    return st?.isFile() ? { path, size: st.size, mtime: Math.floor(st.mtimeMs) } : null;
  }
}
