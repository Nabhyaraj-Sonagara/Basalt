// Runs the app the way contributors do (`npm run dev`: Vite dev server + Electron) on a fresh
// profile, and checks the first-launch path: start screen → sample hive → workspace, with no
// renderer errors. React's development build is stricter than production, so this catches
// problems the built-app tests miss.
// Usage: xvfb-run -a node apps/desktop/e2e/dev-smoke.mjs   (on macOS, no xvfb needed)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const desktop = resolve(import.meta.dirname, '..');
const port = 9500 + Math.floor(Math.random() * 400);
const userData = mkdtempSync(join(tmpdir(), 'basalt-dev-ud-'));
// Keep "Try the sample hive" from copying into the real Documents folder.
const home = mkdtempSync(join(tmpdir(), 'basalt-dev-home-'));

const args = ['electron-vite', 'dev', '--remoteDebuggingPort', String(port)];
if (process.platform === 'linux') args.push('--noSandbox');
args.push('--', `--user-data-dir=${userData}`);
const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  cwd: desktop,
  env: { ...process.env, BASALT_NO_UPDATES: '1', BASALT_DOCUMENTS_DIR: home },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

const stop = () => {
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill();
  } catch {
    /* gone */
  }
};

let failed = null;
try {
  let browser;
  for (let i = 0; i < 120 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!browser) throw new Error('The dev app never opened a window.');
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('http://localhost'));
    if (!page) await new Promise((r) => setTimeout(r, 500));
  }
  if (!page) throw new Error('No renderer page found.');
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  await page.reload();
  await page.getByText('Open a hive').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Try the sample hive' }).click();
  await page.waitForSelector('.workspace .cm-content', { timeout: 30000 });
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+P`);
  await page.waitForSelector('.palette-wrap li[role="option"]', { timeout: 10000 });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 1000));
  if (errors.length) throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  console.log('ok  npm run dev: start screen, sample hive and command palette work with no renderer errors');
  await browser.close();
} catch (err) {
  failed = err;
} finally {
  stop();
}
if (failed) {
  console.error(`FAIL  ${failed.message}\n\n--- dev server log ---\n${log.slice(-4000)}`);
  process.exit(1);
}
process.exit(0);
