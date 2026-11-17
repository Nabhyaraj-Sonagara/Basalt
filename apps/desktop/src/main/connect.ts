// One-click "Connect" for AI apps the person already pays for. Each app launches Basalt itself
// as an MCP server (`Basalt --mcp --hive=…`), so it works with their own subscription and needs
// no Node install or API key. We only edit the app's MCP config, after backing it up once.
import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { ConnectClientId, ConnectStatus } from '../shared/api';

interface Launch {
  command: string;
  args: string[];
}

/** How an MCP client should start Basalt for this hive. */
export function mcpLaunchCommand(hiveRoot: string): Launch {
  // An AppImage runs from a temporary mount; the stable path is in $APPIMAGE.
  const command = process.env.APPIMAGE || process.execPath;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  args.push('--mcp', `--hive=${hiveRoot}`);
  if (process.platform === 'linux') args.push('--ozone-platform=headless');
  return { command, args };
}

export function serverName(hiveName: string): string {
  const slug = hiveName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `basalt-${slug || 'hive'}`;
}

// BASALT_CONNECT_HOME lets tests point Connect at a scratch folder without changing HOME,
// which on macOS would also hide the login keychain from the app.
const home = () => process.env.BASALT_CONNECT_HOME || homedir();

function claudeDesktopConfig(): string {
  if (process.platform === 'darwin') return join(home(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return join(process.env.XDG_CONFIG_HOME || join(home(), '.config'), 'Claude', 'claude_desktop_config.json');
}
const claudeCodeConfig = () => join(home(), '.claude.json');
const codexConfig = () => join(process.env.CODEX_HOME || join(home(), '.codex'), 'config.toml');

/** Finds a CLI even when the app was started from the Dock or Start menu (with a minimal PATH). */
function findExecutable(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(home(), '.local', 'bin'),
    join(home(), '.claude', 'local'),
    join(home(), '.npm-global', 'bin'),
    join(home(), '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []),
  ].filter(Boolean);
  for (const d of dirs) for (const e of exts) if (existsSync(join(d, name + e))) return join(d, name + e);
  return null;
}

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20_000, shell: process.platform === 'win32' && cmd.endsWith('.cmd') }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }),
    );
  });
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`${file} isn't valid JSON, so Basalt left it alone. Fix or remove it, then try again.`);
  }
}

async function backupOnce(file: string) {
  if (existsSync(file) && !existsSync(`${file}.basalt-backup`)) await fs.copyFile(file, `${file}.basalt-backup`);
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(dirname(file), { recursive: true });
  await backupOnce(file);
  const tmp = `${file}.basalt-tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(tmp, file);
}

// ---------- TOML (Codex) ----------

const tomlString = (s: string) => JSON.stringify(s); // JSON escapes are valid TOML basic-string escapes

/** Removes a `[mcp_servers.<name>]` table (and its sub-tables) from TOML text. */
function removeTomlTable(text: string, name: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipping = false;
  const header = new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:${name.replace(/[-]/g, '\\-')}|"${name}")(\\.[^\\]]+)?\\s*\\]`);
  for (const line of lines) {
    if (/^\s*\[/.test(line)) skipping = header.test(line);
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function tomlHasTable(text: string, name: string): boolean {
  return new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:${name.replace(/[-]/g, '\\-')}|"${name}")\\s*\\]`, 'm').test(text);
}

// ---------- the clients ----------

interface Client {
  id: ConnectClientId;
  label: string;
  /** Plan the app is used with, shown in the UI. */
  plan: string;
  installed(): Promise<boolean>;
  connected(name: string): Promise<boolean>;
  connect(name: string, launch: Launch): Promise<string>;
  disconnect(name: string): Promise<void>;
}

const CLIENTS: Client[] = [
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    plan: 'Claude Pro or Max',
    installed: async () => existsSync(dirname(claudeDesktopConfig())),
    connected: async (name) => !!((await readJson(claudeDesktopConfig())).mcpServers as Record<string, unknown> | undefined)?.[name],
    async connect(name, launch) {
      const file = claudeDesktopConfig();
      const cfg = await readJson(file);
      cfg.mcpServers = { ...((cfg.mcpServers as object) ?? {}), [name]: { command: launch.command, args: launch.args } };
      await writeJson(file, cfg);
      return 'Quit and reopen Claude Desktop to load your hive.';
    },
    async disconnect(name) {
      const file = claudeDesktopConfig();
      const cfg = await readJson(file);
      const servers = { ...((cfg.mcpServers as Record<string, unknown>) ?? {}) };
      delete servers[name];
      cfg.mcpServers = servers;
      await writeJson(file, cfg);
    },
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    plan: 'Claude Pro or Max',
    installed: async () => !!findExecutable('claude') || existsSync(claudeCodeConfig()),
    async connected(name) {
      const cfg = await readJson(claudeCodeConfig());
      return !!(cfg.mcpServers as Record<string, unknown> | undefined)?.[name];
    },
    async connect(name, launch) {
      // On Windows, passing JSON through cmd.exe isn't reliable; edit the config file instead.
      const cli = process.platform === 'win32' ? null : findExecutable('claude');
      if (cli) {
        await run(cli, ['mcp', 'remove', '--scope', 'user', name]);
        const res = await run(cli, ['mcp', 'add-json', '--scope', 'user', name, JSON.stringify({ type: 'stdio', command: launch.command, args: launch.args })]);
        if (res.code === 0) return 'Basalt is available in every Claude Code session. Run /mcp in Claude Code to check.';
      }
      // No CLI on this PATH: user-scope servers live in ~/.claude.json.
      const file = claudeCodeConfig();
      const cfg = await readJson(file);
      cfg.mcpServers = { ...((cfg.mcpServers as object) ?? {}), [name]: { type: 'stdio', command: launch.command, args: launch.args, env: {} } };
      await writeJson(file, cfg);
      return 'Basalt is available in new Claude Code sessions.';
    },
    async disconnect(name) {
      const cli = process.platform === 'win32' ? null : findExecutable('claude');
      if (cli && (await run(cli, ['mcp', 'remove', '--scope', 'user', name])).code === 0) return;
      const file = claudeCodeConfig();
      const cfg = await readJson(file);
      const servers = { ...((cfg.mcpServers as Record<string, unknown>) ?? {}) };
      delete servers[name];
      cfg.mcpServers = servers;
      await writeJson(file, cfg);
    },
  },
  {
    id: 'codex',
    label: 'Codex (ChatGPT)',
    plan: 'ChatGPT Plus, Pro or Team',
    installed: async () => !!findExecutable('codex') || existsSync(dirname(codexConfig())),
    connected: async (name) => tomlHasTable(await fs.readFile(codexConfig(), 'utf8').catch(() => ''), name),
    async connect(name, launch) {
      const file = codexConfig();
      const text = removeTomlTable(await fs.readFile(file, 'utf8').catch(() => ''), name).replace(/\s*$/, '');
      const table = `[mcp_servers.${name}]\ncommand = ${tomlString(launch.command)}\nargs = [${launch.args.map(tomlString).join(', ')}]\n`;
      await fs.mkdir(dirname(file), { recursive: true });
      await backupOnce(file);
      await fs.writeFile(file, `${text ? text + '\n\n' : ''}${table}`);
      return 'Start a new Codex session to use your hive.';
    },
    async disconnect(name) {
      const file = codexConfig();
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      if (!text) return;
      await backupOnce(file);
      await fs.writeFile(file, removeTomlTable(text, name).replace(/\s*$/, '\n'));
    },
  },
];

export async function connectStatus(hiveName: string): Promise<ConnectStatus[]> {
  const name = serverName(hiveName);
  return Promise.all(
    CLIENTS.map(async (c) => ({
      id: c.id,
      label: c.label,
      plan: c.plan,
      installed: await c.installed().catch(() => false),
      connected: await c.connected(name).catch(() => false),
    })),
  );
}

export async function connectClient(id: ConnectClientId, hiveName: string, hiveRoot: string): Promise<string> {
  const c = CLIENTS.find((x) => x.id === id);
  if (!c) throw new Error('Unknown app.');
  return c.connect(serverName(hiveName), mcpLaunchCommand(hiveRoot));
}

export async function disconnectClient(id: ConnectClientId, hiveName: string): Promise<void> {
  const c = CLIENTS.find((x) => x.id === id);
  if (!c) throw new Error('Unknown app.');
  await c.disconnect(serverName(hiveName));
}

// Exposed for tests.
export const __test = { removeTomlTable, tomlHasTable, serverName };
