import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { CONFIG_DIR, parseMindmap, serializeMindmap, type Hive } from '@basalt/core';
import { newNotePath, resolveNote, semanticIndex } from './notes';

const VERSION = '0.1.0';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

async function guard(fn: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
  }
}

/**
 * MCP server exposing a hive to agents. Every path is confined to the hive root; there is no
 * delete tool, and overwriting a note requires `overwrite: true`.
 */
export function createMcpServer(hive: Hive): McpServer {
  const server = new McpServer(
    { name: 'basalt', version: VERSION },
    {
      instructions: `Basalt hive "${hive.name}": a folder of linked Markdown notes. Read the hive_guide tool first for this hive's conventions. Link notes with [[Note name]]. Prefer append_to_note and set_properties over rewriting whole notes. To draw something, add a \`\`\`mermaid code block (flowchart, sequenceDiagram, pie, xychart-beta…) to a note, or make a mind map with create_mind_map; Basalt renders both.`,
    },
  );
  const ro = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool('hive_guide', { title: 'Hive conventions', description: `Returns ${CONFIG_DIR}/agents.md: how this hive is organised and the rules for editing it. Read before writing.`, annotations: ro }, () =>
    guard(async () => ({ hive: hive.name, notes: hive.notes.size, guide: await hive.agentsGuide(), settings: { dailyNotes: hive.settings.dailyNotes, templates: hive.settings.templates.folder } })),
  );

  server.registerTool(
    'list_notes',
    { title: 'List notes', description: 'Lists notes in the hive, optionally under a folder.', inputSchema: { folder: z.string().optional().describe('Folder path, e.g. "Projects"'), limit: z.number().int().positive().max(5000).optional() }, annotations: ro },
    ({ folder, limit }) =>
      guard(() =>
        [...hive.notes.values()]
          .filter((n) => !folder || n.path.startsWith(folder.replace(/\/+$/, '') + '/'))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, limit ?? 500)
          .map((n) => ({ path: n.path, title: n.title, tags: n.tags, modified: new Date(n.mtime).toISOString() })),
      ),
  );

  server.registerTool(
    'read_note',
    { title: 'Read note', description: 'Reads a note by path or link text. Optionally just one heading ("#Heading") or block ("#^id").', inputSchema: { note: z.string().describe('Path or link text, e.g. "Projects/Plan" or "Plan"'), subpath: z.string().optional() }, annotations: ro },
    ({ note, subpath }) =>
      guard(async () => {
        const path = resolveNote(hive, note);
        const rec = hive.note(path);
        return { path, title: rec?.title, properties: rec?.frontmatter, tags: rec?.tags, content: subpath ? await hive.readSubpath(path, subpath) : await hive.read(path) };
      }),
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description:
        'Full-text search. Supports "phrases", -exclude, OR, /regex/, file:, path:, tag:#t, line:(…), section:(…), task-todo:, task-done:, [property:value], [rating:>3].',
      inputSchema: { query: z.string(), limit: z.number().int().positive().max(200).optional() },
      annotations: ro,
    },
    ({ query, limit }) => guard(() => hive.search(query, { limit: limit ?? 20, matchesPerFile: 5 }).map((r) => ({ path: r.path, title: r.title, matches: r.matches.map((m) => ({ line: m.line + 1, text: m.text })) }))),
  );

  server.registerTool(
    'semantic_search',
    { title: 'Semantic search', description: 'Finds notes by meaning rather than exact words.', inputSchema: { query: z.string(), limit: z.number().int().positive().max(50).optional() }, annotations: ro },
    ({ query, limit }) => guard(async () => (await semanticIndex(hive)).search(query, limit ?? 10)),
  );

  server.registerTool(
    'related_notes',
    { title: 'Related notes', description: 'Notes similar to a given note. With unlinked_only, suggests notes worth linking.', inputSchema: { note: z.string(), unlinked_only: z.boolean().optional(), limit: z.number().int().positive().max(50).optional() }, annotations: ro },
    ({ note, unlinked_only, limit }) => guard(async () => (await semanticIndex(hive)).related(resolveNote(hive, note), limit ?? 8, !!unlinked_only)),
  );

  server.registerTool('get_backlinks', { title: 'Backlinks', description: 'Notes that link to a note, with the linking line.', inputSchema: { note: z.string() }, annotations: ro }, ({ note }) =>
    guard(() => hive.backlinks(resolveNote(hive, note)).map((b) => ({ source: b.source, line: b.link.line + 1, context: b.context }))),
  );

  server.registerTool('get_outgoing_links', { title: 'Outgoing links', description: 'Links in a note and where they resolve (null = not written yet).', inputSchema: { note: z.string() }, annotations: ro }, ({ note }) =>
    guard(() => hive.outgoing(resolveNote(hive, note))),
  );

  server.registerTool('list_tags', { title: 'Tags', description: 'All tags with note counts (nested tags count toward parents).', annotations: ro }, () => guard(() => hive.tags()));

  server.registerTool(
    'query_notes',
    {
      title: 'Query notes as a table',
      description: 'Filters notes with the search language and returns their properties as rows. Example: where "[status:active] tag:#project", sort "due".',
      inputSchema: { where: z.string().optional(), sort: z.string().optional(), desc: z.boolean().optional(), select: z.array(z.string()).optional(), limit: z.number().int().positive().max(1000).optional() },
      annotations: ro,
    },
    (q) => guard(() => hive.query(q)),
  );

  server.registerTool(
    'create_note',
    { title: 'Create note', description: 'Creates a note. Picks a free name if the path is taken. Optionally starts from a template note.', inputSchema: { path: z.string().describe('e.g. "Projects/New idea"'), content: z.string().optional(), template: z.string().optional() }, annotations: { destructiveHint: false, openWorldHint: false } },
    ({ path, content, template }) => guard(async () => ({ path: await hive.create(newNotePath(path), content ?? '', template ? { template: resolveNote(hive, template) } : {}) })),
  );

  server.registerTool(
    'create_mind_map',
    {
      title: 'Create mind map',
      description:
        'Creates a mind-map note, which Basalt shows as an editable map. It is plain Markdown: frontmatter "view: mindmap", a "# Central idea" heading and a nested bulleted list (two spaces per level). Branches can contain [[links]].',
      inputSchema: {
        path: z.string().describe('e.g. "Projects/Launch map"'),
        central: z.string().describe('The central idea'),
        branches: z.string().describe('Nested Markdown list, e.g. "- Design\\n  - Sketches\\n- Build"'),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ path, central, branches }) =>
      guard(async () => {
        const root = parseMindmap(`# ${central}\n\n${branches}`, central);
        if (!root.children.length) throw new Error('branches must be a bulleted list, one "- " item per line.');
        return { path: await hive.create(newNotePath(path), serializeMindmap(root)), branches: root.children.length };
      }),
  );

  server.registerTool(
    'write_note',
    { title: 'Replace note', description: 'Replaces the full content of an existing note. Requires overwrite: true. A snapshot of the old version is kept.', inputSchema: { note: z.string(), content: z.string(), overwrite: z.literal(true) }, annotations: { destructiveHint: true, openWorldHint: false } },
    ({ note, content }) =>
      guard(async () => {
        const path = resolveNote(hive, note);
        await hive.write(path, content);
        return { path, written: content.length };
      }),
  );

  server.registerTool(
    'append_to_note',
    { title: 'Append to note', description: 'Appends Markdown to the end of a note (creating it if missing).', inputSchema: { note: z.string(), content: z.string() }, annotations: { destructiveHint: false, openWorldHint: false } },
    ({ note, content }) =>
      guard(async () => {
        let path: string;
        try {
          path = resolveNote(hive, note);
        } catch {
          path = newNotePath(note);
        }
        await hive.append(path, content);
        return { path };
      }),
  );

  server.registerTool(
    'set_properties',
    { title: 'Set properties', description: 'Sets frontmatter properties on a note. Use null to remove a property.', inputSchema: { note: z.string(), properties: z.record(z.string(), z.any()) }, annotations: { destructiveHint: false, openWorldHint: false } },
    ({ note, properties }) =>
      guard(async () => {
        const path = resolveNote(hive, note);
        const changes = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, v === null ? undefined : v]));
        await hive.setProperties(path, changes);
        return { path, properties: hive.note(path)?.frontmatter };
      }),
  );

  server.registerTool(
    'rename_note',
    { title: 'Rename or move', description: 'Renames or moves a note or folder and updates every link to it.', inputSchema: { from: z.string(), to: z.string() }, annotations: { destructiveHint: false, openWorldHint: false } },
    ({ from, to }) => guard(async () => hive.rename(hive.exists(from) ? from : resolveNote(hive, from), to)),
  );

  server.registerTool(
    'daily_note',
    { title: 'Daily note', description: "Returns (and creates if needed) the daily note for a date (default today), with its content.", inputSchema: { date: z.string().optional().describe('YYYY-MM-DD') } },
    ({ date }) =>
      guard(async () => {
        const d = date ? new Date(`${date}T12:00:00`) : new Date();
        if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${date}`);
        const res = await hive.dailyNote(d);
        return { ...res, content: await hive.read(res.path) };
      }),
  );

  server.registerResource('hive-guide', 'basalt://guide', { title: 'Hive conventions', mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, text: await hive.agentsGuide(), mimeType: 'text/markdown' }] }));

  return server;
}

/** Serves the hive over stdio. `io` swaps in other streams (the desktop app needs this on Windows). */
export async function runMcp(hive: Hive, io: { stdin?: Readable; stdout?: Writable } = {}): Promise<void> {
  await hive.watch();
  const server = createMcpServer(hive);
  await server.connect(new StdioServerTransport(io.stdin, io.stdout));
}
