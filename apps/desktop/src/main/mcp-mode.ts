// `Basalt --mcp --hive=<folder>`: run Basalt's MCP server on stdio instead of opening a window.
// Claude Desktop, Claude Code and Codex launch this, so connecting them needs no Node install
// and they use the person's own subscription in their own apps.
import { app } from 'electron';
import { join, resolve } from 'node:path';
import { Hive } from '@basalt/core';
import { runMcp } from '@basalt/cli/mcp';

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
      await runMcp(hive);
      process.stderr.write(`basalt --mcp: serving ${hive.name} on stdio\n`);
      process.stdin.on('end', () => {
        process.stderr.write('basalt --mcp: stdin ended\n');
        app.quit();
      });
      process.stdin.on('close', () => app.quit());
    } catch (err) {
      process.stderr.write(`basalt --mcp: ${(err as Error).message}\n`);
      app.exit(1);
    }
  });
}
