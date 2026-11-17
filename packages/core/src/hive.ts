// The hive engine: a folder of Markdown notes, indexed in memory. Node only.
import { EventEmitter } from 'node:events';
import { promises as fs, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseCanvas, serializeCanvas, canvasFileRefs } from './canvas';
import { maskNonContent, parseNote, splitFrontmatter, subpathText } from './parse';
import { safeRelPath } from './path';
import { propertyCatalog, queryNotes, setFrontmatter, type NoteQuery, type PropertyInfo, type QueryRow } from './properties';
import { rewriteLinks } from './rename';
import { LinkResolver, basenameOf, dirOf, extOf, isNote, CANVAS_EXT } from './resolve';
import { search, type SearchDoc, type SearchOptions } from './search';
import { DEFAULT_AGENTS_MD, DEFAULT_SETTINGS, mergeDeep, type HiveSettings } from './settings';
import { applyTemplate, dailyNotePath, uniqueNoteName } from './templates';
import type { Backlink, FileEntry, Graph, NoteRecord, SearchResult, TreeNode, UnlinkedMention } from './types';

export const CONFIG_DIR = '.basalt';
const IGNORED_DIRS = new Set([CONFIG_DIR, '.obsidian', '.git', '.trash', 'node_modules', '.DS_Store']);

export type HiveEvent =
  | { type: 'create' | 'modify' | 'delete'; path: string }
  | { type: 'rename'; path: string; oldPath: string };

export interface RenameResult {
  path: string;
  oldPath: string;
  /** Notes whose links were rewritten. */
  updated: string[];
}

export interface Snapshot {
  path: string;
  time: number;
  file: string;
}

function isIgnored(rel: string): boolean {
  return rel.split('/').some((seg) => IGNORED_DIRS.has(seg) || (seg.startsWith('.') && seg !== '.'));
}

export class Hive extends EventEmitter {
  readonly root: string;
  settings: HiveSettings = structuredClone(DEFAULT_SETTINGS);
  readonly files = new Map<string, FileEntry>();
  readonly notes = new Map<string, NoteRecord>();
  private texts = new Map<string, string>();
  /** Files referenced by each canvas, for backlinks and the graph. */
  private canvasRefs = new Map<string, string[]>();
  resolver = new LinkResolver();
  private watcher: { close(): Promise<void> } | null = null;
  private selfWrites = new Map<string, number>();
  private lastSnapshot = new Map<string, number>();

  private constructor(root: string) {
    super();
    this.root = root;
  }

  static async open(root: string, opts: { watch?: boolean; create?: boolean } = {}): Promise<Hive> {
    if (opts.create) await fs.mkdir(root, { recursive: true });
    const st = await fs.stat(root).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`Not a folder: ${root}`);
    const hive = new Hive(root);
    await hive.loadSettings();
    await hive.scan();
    if (opts.watch) await hive.watch();
    return hive;
  }

  get name(): string {
    return this.root.split(/[\\/]/).filter(Boolean).pop() ?? 'hive';
  }

  abs(rel: string): string {
    return join(this.root, safeRelPath(rel));
  }

  // ---------- settings and app state ----------

  async loadSettings(): Promise<void> {
    const saved = await this.readConfig<Partial<HiveSettings>>('settings.json');
    this.settings = mergeDeep(structuredClone(DEFAULT_SETTINGS), saved ?? {});
  }

  async saveSettings(patch: Partial<HiveSettings>): Promise<HiveSettings> {
    this.settings = mergeDeep(this.settings, patch);
    await this.writeConfig('settings.json', this.settings);
    return this.settings;
  }

  async readConfig<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(join(this.root, CONFIG_DIR, safeRelPath(name)), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  async writeConfig(name: string, data: unknown): Promise<void> {
    const file = join(this.root, CONFIG_DIR, safeRelPath(name));
    await fs.mkdir(dirname(file), { recursive: true });
    await atomicWrite(file, JSON.stringify(data, null, 2));
  }

  async readConfigText(name: string): Promise<string | null> {
    try {
      return await fs.readFile(join(this.root, CONFIG_DIR, safeRelPath(name)), 'utf8');
    } catch {
      return null;
    }
  }

  async writeConfigText(name: string, text: string): Promise<void> {
    const file = join(this.root, CONFIG_DIR, safeRelPath(name));
    await fs.mkdir(dirname(file), { recursive: true });
    await atomicWrite(file, text);
  }

  /** The hive's conventions for agents (`.basalt/agents.md`), created with defaults on first read. */
  async agentsGuide(): Promise<string> {
    const text = await this.readConfigText('agents.md');
    if (text != null) return text;
    await this.writeConfigText('agents.md', DEFAULT_AGENTS_MD);
    return DEFAULT_AGENTS_MD;
  }

  // ---------- indexing ----------

  async scan(): Promise<void> {
    this.files.clear();
    this.notes.clear();
    this.texts.clear();
    this.canvasRefs.clear();
    this.resolver = new LinkResolver();
    const walk = async (rel: string): Promise<void> => {
      const entries = await fs.readdir(rel ? join(this.root, rel) : this.root, { withFileTypes: true });
      await Promise.all(
        entries.map(async (e) => {
          const p = rel ? `${rel}/${e.name}` : e.name;
          if (isIgnored(p)) return;
          if (e.isDirectory()) {
            this.files.set(p, { path: p, kind: 'folder', ext: '', mtime: 0, size: 0 });
            await walk(p);
          } else if (e.isFile()) {
            await this.indexFile(p, false);
          }
        }),
      );
    };
    await walk('');
  }

  private async indexFile(path: string, emit = true): Promise<void> {
    const st = await fs.stat(this.abs(path)).catch(() => null);
    if (!st) return;
    const existed = this.files.has(path);
    const entry: FileEntry = { path, kind: 'file', ext: extOf(path), mtime: st.mtimeMs, size: st.size };
    this.files.set(path, entry);
    this.resolver.add(path);
    this.ensureParents(path);
    if (isNote(path)) {
      const text = await fs.readFile(this.abs(path), 'utf8');
      this.indexText(path, text, st.mtimeMs, st.size);
    } else if (entry.ext === CANVAS_EXT) {
      try {
        const text = await fs.readFile(this.abs(path), 'utf8');
        this.texts.set(path, text);
        this.canvasRefs.set(path, canvasFileRefs(parseCanvas(text)));
      } catch {
        this.canvasRefs.set(path, []);
      }
    }
    if (emit) this.emit('change', { type: existed ? 'modify' : 'create', path } satisfies HiveEvent);
  }

  private indexText(path: string, text: string, mtime: number, size: number): NoteRecord {
    const meta = parseNote(text);
    const fmTitle = typeof meta.frontmatter.title === 'string' ? meta.frontmatter.title : null;
    const rec: NoteRecord = { ...meta, path, basename: basenameOf(path), title: fmTitle || basenameOf(path), mtime, size };
    this.notes.set(path, rec);
    this.texts.set(path, text);
    this.resolver.setAliases(path, meta.aliases);
    return rec;
  }

  private ensureParents(path: string): void {
    let d = dirOf(path);
    while (d) {
      if (!this.files.has(d)) this.files.set(d, { path: d, kind: 'folder', ext: '', mtime: 0, size: 0 });
      d = dirOf(d);
    }
  }

  private unindex(path: string): void {
    this.files.delete(path);
    this.notes.delete(path);
    this.texts.delete(path);
    this.canvasRefs.delete(path);
    this.resolver.remove(path);
  }

  // ---------- reading ----------

  list(): FileEntry[] {
    return [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  tree(): TreeNode {
    const root: TreeNode = { name: this.name, path: '', kind: 'folder', ext: '', children: [] };
    const folders = new Map<string, TreeNode>([['', root]]);
    const sorted = this.list().sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
    for (const f of sorted) {
      const parent = folders.get(dirOf(f.path)) ?? root;
      const node: TreeNode = { name: f.path.slice(f.path.lastIndexOf('/') + 1), path: f.path, kind: f.kind, ext: f.ext };
      if (f.kind === 'folder') {
        node.children = [];
        folders.set(f.path, node);
      }
      parent.children!.push(node);
    }
    const sortRec = (n: TreeNode) => {
      n.children?.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'folder' ? -1 : 1));
      n.children?.forEach(sortRec);
    };
    sortRec(root);
    return root;
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const p = safeRelPath(path);
    const cached = this.texts.get(p);
    if (cached != null) return cached;
    return fs.readFile(this.abs(p), 'utf8');
  }

  async readBinary(path: string): Promise<Buffer> {
    return fs.readFile(this.abs(path));
  }

  /** Reads the part of a note a link points at (`#Heading`, `#^block`). */
  async readSubpath(path: string, subpath?: string): Promise<string> {
    return subpathText(await this.read(path), subpath);
  }

  note(path: string): NoteRecord | undefined {
    return this.notes.get(path);
  }

  resolve(target: string, source = ''): string | null {
    return this.resolver.resolve(target, source);
  }

  // ---------- writing ----------

  async write(path: string, text: string): Promise<NoteRecord | undefined> {
    const p = safeRelPath(path);
    const file = this.abs(p);
    const existed = this.files.has(p);
    if (existed && isNote(p)) await this.maybeSnapshot(p);
    await fs.mkdir(dirname(file), { recursive: true });
    this.selfWrites.set(p, Date.now());
    await atomicWrite(file, text);
    const st = await fs.stat(file);
    this.files.set(p, { path: p, kind: 'file', ext: extOf(p), mtime: st.mtimeMs, size: st.size });
    this.resolver.add(p);
    this.ensureParents(p);
    let rec: NoteRecord | undefined;
    if (isNote(p)) rec = this.indexText(p, text, st.mtimeMs, st.size);
    else if (extOf(p) === CANVAS_EXT) {
      this.texts.set(p, text);
      try {
        this.canvasRefs.set(p, canvasFileRefs(parseCanvas(text)));
      } catch {
        this.canvasRefs.set(p, []);
      }
    }
    this.emit('change', { type: existed ? 'modify' : 'create', path: p } satisfies HiveEvent);
    return rec;
  }

  async writeBinary(path: string, data: Uint8Array): Promise<string> {
    const p = this.availablePath(safeRelPath(path));
    await fs.mkdir(dirname(this.abs(p)), { recursive: true });
    this.selfWrites.set(p, Date.now());
    await fs.writeFile(this.abs(p), data);
    await this.indexFile(p);
    return p;
  }

  /** `name.md` → `name 1.md` → `name 2.md` … until free. */
  availablePath(path: string): string {
    if (!this.files.has(path) && !existsSync(this.abs(path))) return path;
    const ext = extOf(path);
    const stem = ext ? path.slice(0, -(ext.length + 1)) : path;
    for (let i = 1; ; i++) {
      const cand = ext ? `${stem} ${i}.${ext}` : `${stem} ${i}`;
      if (!this.files.has(cand) && !existsSync(this.abs(cand))) return cand;
    }
  }

  /** Creates a note (or canvas). Picks a free name if taken. */
  async create(path: string, text = '', opts: { template?: string } = {}): Promise<string> {
    let p = safeRelPath(path);
    if (!extOf(p)) p += '.md';
    p = this.availablePath(p);
    let body = text;
    if (opts.template) {
      const tpl = await this.read(opts.template);
      body = applyTemplate(tpl, { title: basenameOf(p) }, { date: this.settings.templates.dateFormat, time: this.settings.templates.timeFormat }) + text;
    }
    if (extOf(p) === CANVAS_EXT && !body) body = serializeCanvas({ nodes: [], edges: [] });
    await this.write(p, body);
    return p;
  }

  async createFolder(path: string): Promise<string> {
    const p = this.availablePath(safeRelPath(path));
    await fs.mkdir(this.abs(p), { recursive: true });
    this.files.set(p, { path: p, kind: 'folder', ext: '', mtime: Date.now(), size: 0 });
    this.ensureParents(p);
    this.emit('change', { type: 'create', path: p } satisfies HiveEvent);
    return p;
  }

  async append(path: string, text: string): Promise<void> {
    const current = this.exists(path) ? await this.read(path) : '';
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    await this.write(path, current + sep + text);
  }

  async setProperties(path: string, changes: Record<string, unknown>): Promise<void> {
    await this.write(path, setFrontmatter(await this.read(path), changes));
  }

  /** Toggles the task on `line` (0-based) between `[ ]` and `[x]`. */
  async toggleTask(path: string, line: number): Promise<boolean | null> {
    const lines = (await this.read(path)).split('\n');
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\].*)$/.exec(lines[line] ?? '');
    if (!m) return null;
    const done = !(m[2] === 'x' || m[2] === 'X');
    lines[line] = `${m[1]}${done ? 'x' : ' '}${m[3]}`;
    await this.write(path, lines.join('\n'));
    return done;
  }

  /**
   * Renames or moves a file or folder and rewrites every link that pointed into it.
   */
  async rename(oldPath: string, newPath: string): Promise<RenameResult> {
    const from = safeRelPath(oldPath);
    let to = safeRelPath(newPath);
    if (from === to) return { path: to, oldPath: from, updated: [] };
    const entry = this.files.get(from);
    if (!entry) throw new Error(`No such file: ${from}`);
    if (entry.kind === 'file' && isNote(from) && !extOf(to)) to += '.md';
    if (this.files.has(to) && to.toLowerCase() !== from.toLowerCase()) throw new Error(`Already exists: ${to}`);

    const moves = new Map<string, string>();
    if (entry.kind === 'folder') {
      for (const p of this.files.keys()) if (p === from || p.startsWith(from + '/')) moves.set(p, to + p.slice(from.length));
    } else moves.set(from, to);

    const before = new LinkResolver(this.resolver.paths(), [...this.notes.values()].map((n) => [n.path, n.aliases] as [string, string[]]));
    await fs.mkdir(dirname(this.abs(to)), { recursive: true });
    for (const p of moves.keys()) this.selfWrites.set(p, Date.now());
    for (const p of moves.values()) this.selfWrites.set(p, Date.now());
    await fs.rename(this.abs(from), this.abs(to));

    // Re-key the index.
    const oldTexts = new Map(this.texts);
    for (const [o, n] of moves) {
      const f = this.files.get(o)!;
      this.unindex(o);
      this.files.set(n, { ...f, path: n });
      if (f.kind === 'file') {
        this.resolver.add(n);
        const text = oldTexts.get(o);
        if (text != null && isNote(n)) this.indexText(n, text, f.mtime, f.size);
        else if (text != null) {
          this.texts.set(n, text);
          try {
            this.canvasRefs.set(n, canvasFileRefs(parseCanvas(text)));
          } catch {
            /* ignore */
          }
        }
      }
    }
    this.ensureParents(to);
    const after = this.resolver;

    const updated: string[] = [];
    if (this.settings.links.updateOnRename) {
      const reverse = new Map([...moves].map(([o, n]) => [n, o]));
      for (const [path, rec] of [...this.notes]) {
        const sourceOld = reverse.get(path) ?? path;
        if (!rec.links.length && !rec.embeds.length) continue;
        const text = this.texts.get(path)!;
        const res = rewriteLinks(text, sourceOld, path, moves, before, after);
        if (res.changed) {
          await this.write(path, res.text);
          updated.push(path);
        }
      }
      for (const [path, text] of [...this.texts]) {
        if (extOf(path) !== CANVAS_EXT) continue;
        try {
          const c = parseCanvas(text);
          let changed = false;
          for (const n of c.nodes) if (n.type === 'file' && moves.has(n.file)) { n.file = moves.get(n.file)!; changed = true; }
          if (changed) {
            await this.write(path, serializeCanvas(c));
            updated.push(path);
          }
        } catch {
          /* leave invalid canvases alone */
        }
      }
    }
    this.emit('change', { type: 'rename', path: to, oldPath: from } satisfies HiveEvent);
    return { path: to, oldPath: from, updated };
  }

  /**
   * Merges note `source` into note `target`: appends its body under a heading named after it,
   * points every link at `target` instead, then moves `source` to the trash.
   */
  async merge(source: string, target: string): Promise<{ path: string; updated: string[] }> {
    const from = safeRelPath(source);
    const to = safeRelPath(target);
    if (from === to) throw new Error('Pick a different note to merge into.');
    if (!isNote(from) || !this.notes.has(from)) throw new Error(`No such note: ${from}`);
    if (!isNote(to) || !this.notes.has(to)) throw new Error(`No such note: ${to}`);
    const title = this.notes.get(from)!.title;
    const body = (() => {
      const text = this.texts.get(from) ?? '';
      return text.slice(splitFrontmatter(text).bodyStart).trim();
    })();
    const current = (await this.read(to)).replace(/\s*$/, '');
    await this.write(to, `${current}${current ? '\n\n' : ''}## ${title}\n\n${body}\n`);

    const aliases = (skip?: string) => [...this.notes.values()].filter((n) => n.path !== skip).map((n) => [n.path, n.aliases] as [string, string[]]);
    const before = new LinkResolver(this.resolver.paths(), aliases());
    const after = new LinkResolver(this.resolver.paths().filter((p) => p !== from), aliases(from));
    const moves = new Map([[from, to]]);
    const updated: string[] = [];
    for (const [path, rec] of [...this.notes]) {
      if (path === from || (!rec.links.length && !rec.embeds.length)) continue;
      const res = rewriteLinks(this.texts.get(path)!, path, path, moves, before, after);
      if (res.changed) {
        await this.write(path, res.text);
        updated.push(path);
      }
    }
    for (const [path, text] of [...this.texts]) {
      if (extOf(path) !== CANVAS_EXT) continue;
      try {
        const c = parseCanvas(text);
        let changed = false;
        for (const n of c.nodes) if (n.type === 'file' && n.file === from) { n.file = to; changed = true; }
        if (changed) {
          await this.write(path, serializeCanvas(c));
          updated.push(path);
        }
      } catch {
        /* leave invalid canvases alone */
      }
    }
    await this.trash(from);
    return { path: to, updated };
  }

  /** Moves a file or folder to `.basalt/trash/` (recoverable). */
  async trash(path: string): Promise<void> {
    const p = safeRelPath(path);
    const entry = this.files.get(p);
    if (!entry) throw new Error(`No such file: ${p}`);
    const dest = join(this.root, CONFIG_DIR, 'trash', `${Date.now()}-${p.replace(/\//g, '__')}`);
    await fs.mkdir(dirname(dest), { recursive: true });
    this.selfWrites.set(p, Date.now());
    await fs.rename(this.abs(p), dest);
    for (const k of [...this.files.keys()]) if (k === p || k.startsWith(p + '/')) this.unindex(k);
    this.emit('change', { type: 'delete', path: p } satisfies HiveEvent);
  }

  // ---------- snapshots (file recovery) ----------

  private snapshotDir(path: string): string {
    return join(this.root, CONFIG_DIR, 'snapshots', path.replace(/\//g, '__'));
  }

  private async maybeSnapshot(path: string): Promise<void> {
    const interval = this.settings.snapshots.intervalMinutes * 60_000;
    const last = this.lastSnapshot.get(path) ?? 0;
    if (Date.now() - last < interval) return;
    const prev = this.texts.get(path);
    if (prev == null) return;
    this.lastSnapshot.set(path, Date.now());
    const dir = this.snapshotDir(path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, `${Date.now()}.md`), prev);
    const all = (await fs.readdir(dir)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - this.settings.snapshots.keep))) await fs.rm(join(dir, old));
  }

  async snapshots(path: string): Promise<Snapshot[]> {
    const dir = this.snapshotDir(safeRelPath(path));
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    return names
      .map((n) => ({ path, time: Number(n.replace(/\.md$/, '')), file: n }))
      .filter((s) => Number.isFinite(s.time))
      .sort((a, b) => b.time - a.time);
  }

  async readSnapshot(path: string, file: string): Promise<string> {
    return fs.readFile(join(this.snapshotDir(safeRelPath(path)), safeRelPath(file)), 'utf8');
  }

  // ---------- links, tags, graph ----------

  outgoing(path: string): { link: string; target: string | null; embed: boolean; line: number }[] {
    const rec = this.notes.get(path);
    if (!rec) return [];
    return [...rec.links, ...rec.embeds].map((l) => ({ link: l.raw, target: l.target ? this.resolve(l.target, path) : path, embed: l.embed, line: l.line }));
  }

  backlinks(path: string): Backlink[] {
    const out: Backlink[] = [];
    for (const [src, rec] of this.notes) {
      if (src === path) continue;
      const lines = this.texts.get(src)!.split('\n');
      for (const l of [...rec.links, ...rec.embeds]) {
        if (!l.target) continue;
        if (this.resolve(l.target, src) === path) out.push({ source: src, link: l, context: (lines[l.line] ?? '').trim() });
      }
    }
    for (const [canvas, refs] of this.canvasRefs) {
      if (refs.includes(path)) out.push({ source: canvas, link: { raw: path, target: path, embed: true, kind: 'wiki', start: 0, end: 0, line: 0 }, context: 'Card on canvas' });
    }
    return out.sort((a, b) => a.source.localeCompare(b.source) || a.link.start - b.link.start);
  }

  /** Plain-text mentions of a note's title or aliases that aren't links yet. */
  unlinkedMentions(path: string): UnlinkedMention[] {
    const rec = this.notes.get(path);
    if (!rec) return [];
    const names = [rec.basename, ...rec.aliases].filter((n) => n.length >= 3);
    if (!names.length) return [];
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    const out: UnlinkedMention[] = [];
    for (const [src, other] of this.notes) {
      if (src === path) continue;
      const raw = this.texts.get(src)!;
      const text = maskNonContent(raw, other.bodyStart);
      const rawLines = raw.split('\n');
      const blocked = [...other.links, ...other.embeds].map((l) => [l.start, l.end]);
      let offset = 0;
      text.split('\n').forEach((line, i) => {
        if (offset < other.bodyStart) {
          offset += line.length + 1;
          return;
        }
        for (const m of line.matchAll(re)) {
          const start = offset + m.index!;
          if (blocked.some(([a, b]) => start >= a && start < b)) continue;
          out.push({ source: src, line: i, context: rawLines[i].trim(), start, end: start + m[0].length });
        }
        offset += line.length + 1;
      });
    }
    return out;
  }

  tags(): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const rec of this.notes.values()) {
      const seen = new Set<string>();
      for (const t of rec.tags) {
        // Count parents too, so #a/b contributes to #a.
        const parts = t.split('/');
        for (let i = 1; i <= parts.length; i++) seen.add(parts.slice(0, i).join('/'));
      }
      for (const t of seen) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
  }

  graph(opts: { includeUnresolved?: boolean; includeAttachments?: boolean } = {}): Graph {
    const nodes = new Map<string, Graph['nodes'][number]>();
    const edges: Graph['edges'] = [];
    const node = (id: string, resolved: boolean) => {
      if (!nodes.has(id)) {
        const rec = this.notes.get(id);
        nodes.set(id, { id, title: rec?.title ?? basenameOf(id), resolved, degree: 0, tags: rec?.tags ?? [] });
      }
      return nodes.get(id)!;
    };
    for (const [p] of this.notes) node(p, true);
    for (const [c] of this.canvasRefs) node(c, true);
    const seenEdge = new Set<string>();
    const addEdge = (from: string, to: string) => {
      const k = `${from}\u0000${to}`;
      if (from === to || seenEdge.has(k)) return;
      seenEdge.add(k);
      edges.push({ from, to });
      node(from, true).degree++;
      nodes.get(to)!.degree++;
    };
    for (const [src, rec] of this.notes) {
      for (const l of [...rec.links, ...rec.embeds]) {
        if (!l.target) continue;
        const t = this.resolve(l.target, src);
        if (t) {
          if (!isNote(t) && extOf(t) !== CANVAS_EXT && !opts.includeAttachments) continue;
          node(t, true);
          addEdge(src, t);
        } else if (opts.includeUnresolved) {
          node(`unresolved:${l.target}`, false).title = l.target;
          addEdge(src, `unresolved:${l.target}`);
        }
      }
    }
    for (const [c, refs] of this.canvasRefs) for (const r of refs) if (this.notes.has(r)) addEdge(c, r);
    return { nodes: [...nodes.values()], edges };
  }

  // ---------- search and queries ----------

  docs(): SearchDoc[] {
    return [...this.notes.values()].map((n) => ({ path: n.path, title: n.title, text: this.texts.get(n.path) ?? '', meta: n }));
  }

  search(query: string, opts: SearchOptions = {}): SearchResult[] {
    return search(this.docs(), query, opts);
  }

  query(q: NoteQuery): QueryRow[] {
    return queryNotes(this.docs(), q);
  }

  properties(): PropertyInfo[] {
    return propertyCatalog(this.notes.values());
  }

  text(path: string): string | undefined {
    return this.texts.get(path);
  }

  // ---------- daily and unique notes ----------

  async dailyNote(date = new Date(), create = true): Promise<{ path: string; created: boolean }> {
    const s = this.settings.dailyNotes;
    const path = dailyNotePath(date, s.format, s.folder);
    if (this.exists(path) || !create) return { path, created: false };
    let body = '';
    if (s.template) {
      const tpl = this.resolve(s.template) ?? s.template;
      if (this.exists(tpl)) body = applyTemplate(await this.read(tpl), { title: basenameOf(path), date }, { date: this.settings.templates.dateFormat, time: this.settings.templates.timeFormat });
    }
    await this.write(path, body);
    return { path, created: true };
  }

  async uniqueNote(date = new Date()): Promise<string> {
    const s = this.settings.uniqueNote;
    return this.create(`${s.folder ? s.folder + '/' : ''}${uniqueNoteName(date, s.format)}.md`);
  }

  templates(): string[] {
    const folder = this.settings.templates.folder;
    return [...this.notes.keys()].filter((p) => folder && p.startsWith(folder + '/')).sort();
  }

  // ---------- watching ----------

  async watch(): Promise<void> {
    if (this.watcher) return;
    const { watch } = await import('chokidar');
    const w = watch(this.root, {
      ignoreInitial: true,
      ignored: (p: string) => {
        const rel = p.slice(this.root.length).replace(/\\/g, '/').replace(/^\/+/, '');
        return !!rel && isIgnored(rel);
      },
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    const rel = (p: string) => p.slice(this.root.length).replace(/\\/g, '/').replace(/^\/+/, '');
    const recentlyWritten = (p: string) => Date.now() - (this.selfWrites.get(p) ?? 0) < 1500;
    w.on('add', (p) => !recentlyWritten(rel(p)) && void this.indexFile(rel(p)));
    w.on('change', (p) => !recentlyWritten(rel(p)) && void this.indexFile(rel(p)));
    w.on('addDir', (p) => {
      const r = rel(p);
      if (r && !this.files.has(r)) {
        this.files.set(r, { path: r, kind: 'folder', ext: '', mtime: Date.now(), size: 0 });
        this.emit('change', { type: 'create', path: r } satisfies HiveEvent);
      }
    });
    const onRemove = (p: string) => {
      const r = rel(p);
      if (recentlyWritten(r) || !this.files.has(r)) return;
      for (const k of [...this.files.keys()]) if (k === r || k.startsWith(r + '/')) this.unindex(k);
      this.emit('change', { type: 'delete', path: r } satisfies HiveEvent);
    };
    w.on('unlink', onRemove);
    w.on('unlinkDir', onRemove);
    this.watcher = w;
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
    this.removeAllListeners();
  }
}

async function atomicWrite(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, file);
}
