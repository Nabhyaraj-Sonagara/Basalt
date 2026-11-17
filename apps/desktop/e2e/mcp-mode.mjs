// Checks `Basalt --mcp --hive=<folder>`: an MCP client (as Claude Desktop, Claude Code or Codex
// would) starts the app as a stdio server, lists its tools and searches the sample hive.
// Usage: node apps/desktop/e2e/mcp-mode.mjs [path-to-packaged-executable]
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const root = resolve(import.meta.dirname, '../../..');
const hive = join(mkdtempSync(join(tmpdir(), 'basalt-mcp-mode-')), 'Sample');
cpSync(join(root, 'fixtures/sample-hive'), hive, { recursive: true });

const packaged = process.argv[2];
const command = packaged ?? require('electron');
const args = [...(packaged ? [] : [join(root, 'apps/desktop')]), '--mcp', `--hive=${hive}`];
if (process.platform === 'linux') args.push('--no-sandbox', '--ozone-platform=headless');

const client = new Client({ name: 'basalt-e2e', version: '1.0.0' });
const transport = new StdioClientTransport({ command, args, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', (d) => (stderr += d));
// Show what the app said if it stops early, so a CI failure says why.
const fail = (err) => {
  console.error(`FAIL  Basalt --mcp (${command}): ${err?.message ?? err}\n--- app stderr ---\n${stderr || '(nothing)'}\n---`);
  process.exit(1);
};
process.on('unhandledRejection', fail);
await client.connect(transport).catch(fail);
const tools = (await client.listTools().catch(fail)).tools.map((t) => t.name);
assert.ok(tools.includes('search_notes') && tools.includes('create_note'), `tools: ${tools.join(', ')}`);
const res = await client.callTool({ name: 'search_notes', arguments: { query: 'tag:#start' } });
assert.match(JSON.stringify(res.content), /Welcome/);
await client.close();
console.log(`ok  Basalt --mcp served ${tools.length} tools and searched the hive`);
process.exit(0);
