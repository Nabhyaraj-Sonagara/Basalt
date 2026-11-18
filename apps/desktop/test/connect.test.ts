import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { isPackaged: true, getAppPath: () => '/app' } }));

const { connectClient, connectStatus, disconnectClient, mcpLaunchCommand, __test } = await import('../src/main/connect');
const { signInWithOpenRouter, detectLocalModels } = await import('../src/main/openrouter');

let home: string;
// Never replace process.env itself: os.homedir() reads the real environment.
const KEYS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'PATH', 'CODEX_HOME', 'BASALT_OPENROUTER_URL', 'BASALT_OLLAMA_URL', 'BASALT_LMSTUDIO_URL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'basalt-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.XDG_CONFIG_HOME = join(home, '.config');
  process.env.APPDATA = join(home, 'AppData');
  process.env.PATH = '/nonexistent';
  delete process.env.CODEX_HOME;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function claudeDesktopFile() {
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'win32') return join(home, 'AppData', 'Claude', 'claude_desktop_config.json');
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

describe('connect AI apps', () => {
  it('names servers per hive and builds the launch command', () => {
    expect(__test.serverName('My Notes!')).toBe('basalt-my-notes');
    const l = mcpLaunchCommand('/notes');
    expect(l.args).toContain('--mcp');
    expect(l.args).toContain('--hive=/notes');
  });

  it('reports what is installed, connects and disconnects Claude Desktop, keeping other servers', async () => {
    let s = await connectStatus('Work');
    expect(s.find((c) => c.id === 'claude-desktop')!.installed).toBe(false);
    const file = claudeDesktopFile();
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } }, theme: 'dark' }));
    s = await connectStatus('Work');
    expect(s.find((c) => c.id === 'claude-desktop')).toMatchObject({ installed: true, connected: false });

    await connectClient('claude-desktop', 'Work', '/notes/work');
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    expect(cfg.theme).toBe('dark');
    expect(cfg.mcpServers.other).toEqual({ command: 'x' });
    expect(cfg.mcpServers['basalt-work'].args).toContain('--hive=/notes/work');
    expect(existsSync(`${file}.basalt-backup`)).toBe(true);
    expect((await connectStatus('Work')).find((c) => c.id === 'claude-desktop')!.connected).toBe(true);

    await disconnectClient('claude-desktop', 'Work');
    const after = JSON.parse(readFileSync(file, 'utf8'));
    expect(after.mcpServers['basalt-work']).toBeUndefined();
    expect(after.mcpServers.other).toEqual({ command: 'x' });
  });

  it('refuses to overwrite a config file it cannot parse', async () => {
    const file = claudeDesktopFile();
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{ not json');
    await expect(connectClient('claude-desktop', 'Work', '/w')).rejects.toThrow(/isn't valid JSON/);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('adds and removes a Codex TOML table without touching the rest', async () => {
    const dir = join(home, '.codex');
    mkdirSync(dir);
    writeFileSync(join(dir, 'config.toml'), 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n');
    await connectClient('codex', 'Work', 'C:\\Notes\\work');
    let text = readFileSync(join(dir, 'config.toml'), 'utf8');
    expect(text).toContain('model = "gpt-5"');
    expect(text).toContain('[mcp_servers.other]');
    expect(text).toContain('[mcp_servers.basalt-work]');
    expect(text).toContain('"--hive=C:\\\\Notes\\\\work"');
    // Connecting again replaces the table instead of duplicating it.
    await connectClient('codex', 'Work', '/notes/work');
    text = readFileSync(join(dir, 'config.toml'), 'utf8');
    expect(text.match(/\[mcp_servers\.basalt-work\]/g)).toHaveLength(1);
    expect((await connectStatus('Work')).find((c) => c.id === 'codex')!.connected).toBe(true);
    await disconnectClient('codex', 'Work');
    text = readFileSync(join(dir, 'config.toml'), 'utf8');
    expect(text).not.toContain('basalt-work');
    expect(text).toContain('[mcp_servers.other]');
  });

  it('writes Claude Code user servers to ~/.claude.json when the CLI is not on PATH', async () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ numStartups: 3 }));
    await connectClient('claude-code', 'Work', '/w');
    const cfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    expect(cfg.numStartups).toBe(3);
    expect(cfg.mcpServers['basalt-work']).toMatchObject({ type: 'stdio' });
  });
});

describe('OpenRouter sign-in and local models', () => {
  let server: Server;
  let base: string;
  const seen: { verifier?: string; challenge?: string } = {};
  beforeEach(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/api/v1/auth/keys' && req.method === 'POST') {
          const data = JSON.parse(body);
          seen.verifier = data.code_verifier;
          res.writeHead(data.code === 'good-code' ? 200 : 403, { 'content-type': 'application/json' }).end(JSON.stringify({ key: 'sk-or-test' }));
        } else if (req.url === '/api/tags') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'llama3.3' }, { name: 'nomic-embed-text' }] }));
        } else res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.BASALT_OPENROUTER_URL = base;
  });
  afterEach(() => server.close());

  it('runs the PKCE flow and returns the key', async () => {
    const key = await signInWithOpenRouter(async (url) => {
      const u = new URL(url);
      expect(u.pathname).toBe('/auth');
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      seen.challenge = u.searchParams.get('code_challenge')!;
      // The "browser": OpenRouter redirects to the callback with a code.
      const cb = new URL(u.searchParams.get('callback_url')!);
      cb.searchParams.set('code', 'good-code');
      cb.searchParams.set('state', u.searchParams.get('state')!);
      void fetch(cb);
    });
    expect(key).toBe('sk-or-test');
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(seen.verifier!).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(seen.challenge).toBe(expected);
  });

  it('fails clearly when the exchange is refused', async () => {
    await expect(
      signInWithOpenRouter(async (url) => {
        const u = new URL(url);
        const cb = new URL(u.searchParams.get('callback_url')!);
        cb.searchParams.set('code', 'bad-code');
        void fetch(cb);
      }),
    ).rejects.toThrow(/didn't accept/);
  });

  it('finds Ollama and separates embedding models', async () => {
    process.env.BASALT_OLLAMA_URL = base;
    process.env.BASALT_LMSTUDIO_URL = 'http://127.0.0.1:9';
    const found = await detectLocalModels();
    expect(found).toEqual([{ id: 'ollama', label: 'Ollama', baseUrl: `${base}/v1`, models: ['llama3.3'], embeddingModels: ['nomic-embed-text'] }]);
  });
});
