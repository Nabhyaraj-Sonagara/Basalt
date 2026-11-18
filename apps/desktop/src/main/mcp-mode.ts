// `Basalt --mcp --hive=<folder>`: run Basalt's MCP server on stdio instead of opening a window.
// Claude Desktop, Claude Code and Codex launch this, so connecting them needs no Node install
// and they use the person's own subscription in their own apps.
import { app } from 'electron';
import { createReadStream, fstatSync } from 'node:fs';
import { Socket } from 'node:net';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { Hive } from '@basalt/core';
import { runMcp } from '@basalt/cli/mcp';

const log = (msg: string) => process.stderr.write(`basalt --mcp: ${msg}\n`);

/**
 * Electron's main process on Windows gives Node an empty stdin even when the parent passes a pipe,
 * so open the inherited handle (fd 0) directly.
 */
function windowsStdin(): Readable | undefined {
  try {
    const st = fstatSync(0);
    log(`fd 0: ${st.isFIFO() ? 'pipe' : st.isFile() ? 'file' : st.isCharacterDevice() ? 'char' : st.isSocket() ? 'socket' : 'other'}`);
  } catch (err) {
    log(`fd 0 unavailable: ${(err as Error).message}`);
  }
  const tries: [string, () => Readable][] = [
    ['pipe socket', () => new Socket({ fd: 0, readable: true, writable: false })],
    ['file stream', () => createReadStream('', { fd: 0, autoClose: false })],
  ];
  for (const [name, make] of tries) {
    try {
      const s = make();
      log(`reading stdin as a ${name}`);
      return s;
    } catch (err) {
      log(`stdin as a ${name} failed: ${(err as Error).message}`);
    }
  }
  return undefined;
}

export function startMcpMode(): void {
  // stdout carries the MCP protocol; keep everything else on stderr.
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = console.error;
  // No windows: separate profile (so it never touches the app's), no GPU, no display needed.
  app.setPath('userData', join(app.getPath('userData'), 'mcp'));
  app.disableHardwareAcceleration();
  // On Linux the launcher passes --ozone-platform=headless (it must be on the command line), so
  // no display server is needed; see mcpLaunchCommand() in connect.ts.
  app.dock?.hide();
  app.on('window-all-closed', () => {});

  const started = Date.now();
  process.on('uncaughtException', (err) => {
    process.stderr.write(`basalt --mcp: ${err.stack ?? err.message}\n`);
    app.exit(1);
  });
  app.on('will-quit', () => process.stderr.write(`basalt --mcp: stopping after ${Date.now() - started} ms\n`));

  const arg = process.argv.find((a) => a.startsWith('--hive='))?.slice(7) ?? process.env.BASALT_HIVE;
  void app.whenReady().then(async () => {
    if (!arg) {
      process.stderr.write('basalt --mcp needs --hive=<folder>\n');
      app.exit(2);
      return;
    }
    try {
      const hive = await Hive.open(resolve(arg));
      const stdin = (process.platform === 'win32' ? windowsStdin() : undefined) ?? process.stdin;
      await runMcp(hive, { stdin });
      log(`serving ${hive.name} on stdio`);
      stdin.on('end', () => {
        log('stdin ended');
        app.quit();
      });
      stdin.on('close', () => app.quit());
    } catch (err) {
      process.stderr.write(`basalt --mcp: ${(err as Error).message}\n`);
      app.exit(1);
    }
  });
}
