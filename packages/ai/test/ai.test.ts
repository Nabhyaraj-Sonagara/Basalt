import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Hive } from '@basalt/core';
import { HashedEmbedder, SemanticIndex, createProvider, buildSystemPrompt, chunkNote, providersFromEnv } from '../src';

let server: Server;
let base = '';
const seen: { url: string; headers: Record<string, unknown>; body: any }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ url: req.url!, headers: req.headers, body });
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const t of ['Hel', 'lo', ' hive']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else if (req.url === '/v1/embeddings') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: body.input.map((_: string, i: number) => ({ index: i, embedding: [1, i, 0] })) }));
      } else if (req.url === '/v1/messages?beta=true' || req.url === '/v1/messages') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } });
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Claude ' } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'here' } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
        ev('message_stop', {});
        res.end();
      } else if (req.url === '/v1/models') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad key' } }));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => server.close());

const collect = async (it: AsyncIterable<string>) => {
  let s = '';
  for await (const t of it) s += t;
  return s;
};

describe('providers', () => {
  it('streams from an OpenAI-compatible endpoint', async () => {
    const p = createProvider({ id: 'x', kind: 'openai-compatible', label: 'Local', baseUrl: `${base}/v1`, model: 'm' });
    expect(await collect(p.stream({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] }))).toBe('Hello hive');
    const req = seen.find((s) => s.url === '/v1/chat/completions')!;
    expect(req.body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(req.headers.authorization).toBeUndefined();
  });

  it('streams from Claude with the default model, effort and refusal fallbacks', async () => {
    const p = createProvider({ id: 'c', kind: 'anthropic', label: 'Claude', baseUrl: base, apiKey: 'test-key', model: 'claude-opus-5-5' });
    expect(await collect(p.stream({ messages: [{ role: 'user', content: 'hi' }] }))).toBe('Claude here');
    const req = seen.find((s) => s.url!.startsWith('/v1/messages'))!;
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium' }, stream: true });
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
  });

  it('turns HTTP errors into readable messages', async () => {
    const p = createProvider({ id: 'x', kind: 'openai', label: 'OpenAI', baseUrl: `${base}/v1`, apiKey: 'k', model: 'm' });
    await expect(p.listModels()).rejects.toThrow(/OpenAI returned 401: bad key\. Check the API key/);
  });

  it('reads providers from environment variables', () => {
    const ps = providersFromEnv({ ANTHROPIC_API_KEY: 'a', BASALT_OPENAI_COMPAT_URL: 'http://x/v1' });
    expect(ps.map((p) => p.id)).toEqual(['claude', 'custom']);
    expect(ps[0].model).toBe('claude-opus-5-5');
  });
});

describe('semantic search', () => {
  let dir: string;
  let hive: Hive;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'basalt-ai-'));
    cpSync(resolve(__dirname, '../../../fixtures/sample-hive'), dir, { recursive: true });
    hive = await Hive.open(dir);
  });
  afterAll(async () => {
    await hive.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('embeds similar text closer than unrelated text', async () => {
    const e = new HashedEmbedder();
    const [a, b, c] = await e.embed(['linking notes with backlinks', 'notes that link and backlink', 'quarterly tax filing deadline']);
    const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });

  it('chunks notes by section', () => {
    const chunks = chunkNote('a.md', 'A', '---\nx: 1\n---\nintro\n## One\nfirst\n## Two\nsecond');
    expect(chunks.map((c) => c.heading)).toEqual(['', 'One', 'Two']);
    expect(chunks[1].text).toBe('A › One\n## One\nfirst');
  });

  it('indexes incrementally, searches and suggests related notes', async () => {
    const idx = new SemanticIndex(hive, new HashedEmbedder());
    expect((await idx.update()).embedded).toBe(6);
    expect((await idx.update()).embedded).toBe(0);
    const hits = await idx.search('embeds pull content in place');
    expect(hits[0].path).toBe('Linking notes.md');
    expect(hits[0].score).toBeGreaterThan(hits[hits.length - 1].score);
    const reloaded = new SemanticIndex(hive, new HashedEmbedder());
    expect((await reloaded.search('engine tasks for the launch'))[0].path).toBe('Projects/Basalt launch.md');
    const rel = await idx.related('People/Ada.md', 3);
    expect(rel.length).toBe(3);
    await hive.write('People/Ada.md', '# Ada\nNow writes about taxes.');
    expect((await idx.update()).embedded).toBe(1);
  });

  it('builds a grounded system prompt', () => {
    const s = buildSystemPrompt({ hiveName: 'H', agentsGuide: 'Use Daily/', currentNote: { path: 'a.md', text: 'A' }, retrieved: [{ path: 'b.md', title: 'b', heading: 'X', line: 0, score: 1, snippet: 'B' }] });
    expect(s).toContain('<hive_conventions>\nUse Daily/');
    expect(s).toContain('<current_note path="a.md">');
    expect(s).toContain('<note path="b.md" section="X">');
  });
});
