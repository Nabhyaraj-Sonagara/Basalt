import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
let dir: string;
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = res.content[0].text;
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { data: data as any, isError: !!res.isError };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'basalt-mcp-'));
  cpSync(join(ROOT, 'fixtures/sample-hive'), dir, { recursive: true });
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', join(ROOT, 'packages/cli/src/cli.ts'), '-H', dir, 'mcp'], cwd: ROOT, stderr: 'pipe' }),
  );
}, 30000);

afterAll(async () => {
  await client?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('basalt mcp', () => {
  it('lists its tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['append_to_note', 'create_note', 'daily_note', 'get_backlinks', 'get_outgoing_links', 'hive_guide', 'list_notes', 'list_tags', 'query_notes', 'read_note', 'related_notes', 'rename_note', 'search_notes', 'semantic_search', 'set_properties', 'write_note'].sort(),
    );
    expect(tools.find((t) => t.name === 'read_note')?.annotations?.readOnlyHint).toBe(true);
  });

  it('reads, searches and follows links', async () => {
    expect((await call('read_note', { note: 'Ada' })).data.path).toBe('People/Ada.md');
    expect((await call('read_note', { note: 'Welcome', subpath: '#What to try' })).data.content).toMatch(/^## What to try/);
    expect((await call('search_notes', { query: 'task-todo:engine' })).data.map((r: any) => r.path)).toEqual(['Projects/Basalt launch.md']);
    expect((await call('get_backlinks', { note: 'Linking notes' })).data.length).toBe(3);
    expect((await call('semantic_search', { query: 'embeds pull content in place', limit: 1 })).data[0].path).toBe('Linking notes.md');
    expect((await call('hive_guide')).data.guide).toContain('Hive conventions');
  });

  it('creates, appends, sets properties and renames with link updates', async () => {
    const created = await call('create_note', { path: 'Ideas', content: '# Ideas\n' });
    expect(created.data.path).toBe('Ideas.md');
    await call('append_to_note', { note: 'Ideas', content: '- Link [[Welcome]]' });
    await call('set_properties', { note: 'Ideas', properties: { status: 'seedling' } });
    expect(readFileSync(join(dir, 'Ideas.md'), 'utf8')).toBe('---\nstatus: seedling\n---\n# Ideas\n- Link [[Welcome]]');
    const ren = await call('rename_note', { from: 'Ideas', to: 'Inbox/Ideas' });
    expect(ren.data.path).toBe('Inbox/Ideas.md');
    // [[Ideas]] in Welcome still resolves by name after the move, so nothing needs rewriting.
    expect(ren.data.updated).toEqual([]);
    expect((await call('get_backlinks', { note: 'Inbox/Ideas' })).data.map((b: any) => b.source)).toContain('Welcome.md');
  });

  it('refuses to escape the hive and needs overwrite to replace', async () => {
    expect((await call('create_note', { path: '../outside' })).isError).toBe(true);
    const res = await client.callTool({ name: 'write_note', arguments: { note: 'Welcome', content: 'x' } });
    expect(res.isError).toBe(true);
    expect(readFileSync(join(dir, 'Welcome.md'), 'utf8')).toContain('# Welcome');
  });
});
