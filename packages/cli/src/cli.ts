import { Command } from 'commander';
import { resolve } from 'node:path';
import { Hive } from '@basalt/core';
import { buildSystemPrompt, createProvider, providersFromEnv } from '@basalt/ai';
import { runMcp } from './mcp';
import { newNotePath, resolveNote, semanticIndex } from './notes';

const program = new Command();
program
  .name('basalt')
  .description('Work with a Basalt hive (a folder of linked Markdown notes) from the terminal or an agent.')
  .version('0.1.0')
  .option('-H, --hive <dir>', 'hive folder (default: $BASALT_HIVE or the current folder)')
  .option('--json', 'print JSON instead of text');

const opts = () => program.opts<{ hive?: string; json?: boolean }>();
let hivePromise: Promise<Hive> | null = null;
const getHive = () => (hivePromise ??= Hive.open(resolve(opts().hive ?? process.env.BASALT_HIVE ?? process.cwd())));

function out(data: unknown, text: () => string): void {
  if (opts().json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else {
    const t = text();
    if (t) process.stdout.write(t.endsWith('\n') ? t : t + '\n');
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

program
  .command('list')
  .description('List notes')
  .option('-f, --folder <folder>')
  .action(async (o: { folder?: string }) => {
    const hive = await getHive();
    const notes = [...hive.notes.values()].filter((n) => !o.folder || n.path.startsWith(o.folder.replace(/\/+$/, '') + '/')).sort((a, b) => a.path.localeCompare(b.path));
    out(notes.map((n) => ({ path: n.path, title: n.title, tags: n.tags })), () => notes.map((n) => n.path).join('\n'));
  });

program
  .command('read <note>')
  .description('Print a note (path or link text); add #Heading or #^block to print part of it')
  .action(async (ref: string) => {
    const hive = await getHive();
    const hash = ref.indexOf('#');
    const path = resolveNote(hive, hash >= 0 ? ref.slice(0, hash) : ref);
    const content = hash >= 0 ? await hive.readSubpath(path, ref.slice(hash)) : await hive.read(path);
    const rec = hive.note(path);
    out({ path, title: rec?.title, properties: rec?.frontmatter, tags: rec?.tags, content }, () => content);
  });

program
  .command('create <note>')
  .description('Create a note; content from --text or stdin')
  .option('-t, --text <text>')
  .option('--template <template>')
  .action(async (ref: string, o: { text?: string; template?: string }) => {
    const hive = await getHive();
    const text = o.text ?? (await readStdin());
    const path = await hive.create(newNotePath(ref), text, o.template ? { template: resolveNote(hive, o.template) } : {});
    out({ path }, () => path);
  });

program
  .command('write <note>')
  .description('Replace a note with stdin (a snapshot of the old version is kept)')
  .action(async (ref: string) => {
    const hive = await getHive();
    let path: string;
    try {
      path = resolveNote(hive, ref);
    } catch {
      path = newNotePath(ref);
    }
    await hive.write(path, await readStdin());
    out({ path }, () => path);
  });

program
  .command('append <note> [text...]')
  .description('Append text (or stdin) to a note')
  .action(async (ref: string, words: string[]) => {
    const hive = await getHive();
    let path: string;
    try {
      path = resolveNote(hive, ref);
    } catch {
      path = newNotePath(ref);
    }
    await hive.append(path, words.length ? words.join(' ') : await readStdin());
    out({ path }, () => path);
  });

program
  .command('search <query...>')
  .description('Full-text search (supports file: path: tag: line:() section:() task-todo: [prop:value] /regex/)')
  .option('-l, --limit <n>', 'max results', '20')
  .action(async (q: string[], o: { limit: string }) => {
    const hive = await getHive();
    const res = hive.search(q.join(' '), { limit: Number(o.limit), matchesPerFile: 3 });
    out(res, () => res.map((r) => [r.path, ...r.matches.map((m) => `  ${m.line + 1}: ${m.text.trim()}`)].join('\n')).join('\n'));
  });

program
  .command('semantic <query...>')
  .description('Search by meaning')
  .option('-l, --limit <n>', 'max results', '10')
  .action(async (q: string[], o: { limit: string }) => {
    const idx = await semanticIndex(await getHive());
    const res = await idx.search(q.join(' '), Number(o.limit));
    out(res, () => res.map((r) => `${r.score.toFixed(3)}  ${r.path}${r.heading ? ' › ' + r.heading : ''}`).join('\n'));
  });

program
  .command('related <note>')
  .description('Notes similar to a note; --unlinked suggests links')
  .option('--unlinked')
  .action(async (ref: string, o: { unlinked?: boolean }) => {
    const hive = await getHive();
    const res = await (await semanticIndex(hive)).related(resolveNote(hive, ref), 10, !!o.unlinked);
    out(res, () => res.map((r) => `${r.score.toFixed(3)}  ${r.path}`).join('\n'));
  });

program
  .command('backlinks <note>')
  .action(async (ref: string) => {
    const hive = await getHive();
    const res = hive.backlinks(resolveNote(hive, ref));
    out(res.map((b) => ({ source: b.source, line: b.link.line + 1, context: b.context })), () => res.map((b) => `${b.source}:${b.link.line + 1}  ${b.context}`).join('\n'));
  });

program
  .command('links <note>')
  .description('Outgoing links and where they resolve')
  .action(async (ref: string) => {
    const hive = await getHive();
    const res = hive.outgoing(resolveNote(hive, ref));
    out(res, () => res.map((l) => `${l.link}  →  ${l.target ?? '(not written yet)'}`).join('\n'));
  });

program
  .command('tags')
  .action(async () => {
    const hive = await getHive();
    const res = hive.tags();
    out(res, () => res.map((t) => `#${t.tag}  ${t.count}`).join('\n'));
  });

program
  .command('query')
  .description('Notes and their properties as a table')
  .option('-w, --where <query>')
  .option('-s, --sort <property>')
  .option('--desc')
  .option('--select <props>', 'comma-separated')
  .option('-l, --limit <n>')
  .action(async (o: { where?: string; sort?: string; desc?: boolean; select?: string; limit?: string }) => {
    const hive = await getHive();
    const rows = hive.query({ where: o.where, sort: o.sort, desc: o.desc, select: o.select?.split(',').map((s) => s.trim()), limit: o.limit ? Number(o.limit) : undefined });
    out(rows, () => {
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => k !== 'title'))];
      const fmt = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v));
      return [cols.join('\t'), ...rows.map((r) => cols.map((c) => fmt(r[c])).join('\t'))].join('\n');
    });
  });

program
  .command('props <note> [assignments...]')
  .description('Show properties, or set them: basalt props Plan status=done due=2026-12-01 old=')
  .action(async (ref: string, assigns: string[]) => {
    const hive = await getHive();
    const path = resolveNote(hive, ref);
    if (assigns.length) {
      const changes: Record<string, unknown> = {};
      for (const a of assigns) {
        const eq = a.indexOf('=');
        if (eq < 1) throw new Error(`Expected key=value, got "${a}"`);
        const v = a.slice(eq + 1);
        changes[a.slice(0, eq)] = v === '' ? undefined : v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.includes(',') ? v.split(',').map((s) => s.trim()) : v;
      }
      await hive.setProperties(path, changes);
    }
    const fm = hive.note(path)?.frontmatter ?? {};
    out(fm, () => Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n'));
  });

program
  .command('rename <from> <to>')
  .description('Rename or move a note or folder and update links')
  .action(async (from: string, to: string) => {
    const hive = await getHive();
    const res = await hive.rename(hive.exists(from) ? from : resolveNote(hive, from), to);
    out(res, () => `${res.oldPath} → ${res.path}\nUpdated links in ${res.updated.length} note${res.updated.length === 1 ? '' : 's'}`);
  });

program
  .command('daily')
  .description("Open (create) today's daily note, or --date YYYY-MM-DD")
  .option('-d, --date <date>')
  .action(async (o: { date?: string }) => {
    const hive = await getHive();
    const res = await hive.dailyNote(o.date ? new Date(`${o.date}T12:00:00`) : new Date());
    out(res, () => res.path);
  });

program
  .command('graph')
  .description('The link graph as nodes and edges')
  .action(async () => {
    const g = (await getHive()).graph();
    out(g, () => g.edges.map((e) => `${e.from} -> ${e.to}`).join('\n'));
  });

program
  .command('index')
  .description('Update the semantic index')
  .action(async () => {
    const hive = await getHive();
    const idx = await semanticIndex(hive);
    out({ chunks: idx.size }, () => `Indexed ${idx.size} passages from ${hive.notes.size} notes`);
  });

program
  .command('ask <question...>')
  .description('Ask a model about your hive (uses ANTHROPIC_API_KEY, OPENAI_API_KEY, … ; --provider to choose)')
  .option('-p, --provider <id>', 'claude, openai, gemini, openrouter, groq, mistral, custom')
  .option('-m, --model <model>')
  .action(async (q: string[], o: { provider?: string; model?: string }) => {
    const hive = await getHive();
    const providers = providersFromEnv();
    const cfg = o.provider ? providers.find((p) => p.id === o.provider) : providers.find((p) => p.model);
    if (!cfg) throw new Error('No model configured. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY, GEMINI_API_KEY, BASALT_OPENAI_COMPAT_URL) and try again.');
    if (o.model) cfg.model = o.model;
    if (!cfg.model) throw new Error(`Pick a model for ${cfg.label} with --model or BASALT_${cfg.id.toUpperCase()}_MODEL.`);
    const question = q.join(' ');
    const idx = await semanticIndex(hive);
    const retrieved = await idx.topChunks(question, 8);
    const system = buildSystemPrompt({ hiveName: hive.name, agentsGuide: await hive.agentsGuide(), retrieved });
    let answer = '';
    for await (const t of createProvider(cfg).stream({ system, messages: [{ role: 'user', content: question }] })) {
      answer += t;
      if (!opts().json) process.stdout.write(t);
    }
    if (opts().json) out({ provider: cfg.id, model: cfg.model, answer, sources: retrieved.map((r) => r.path) }, () => '');
    else process.stdout.write('\n');
  });

program
  .command('mcp')
  .description('Run the MCP server on stdio for agents (Claude Code, Claude Desktop, …)')
  .action(async () => {
    await runMcp(await getHive());
  });

program.parseAsync(process.argv).catch((err: Error) => {
  process.stderr.write(`basalt: ${err.message}\n`);
  process.exit(1);
});
