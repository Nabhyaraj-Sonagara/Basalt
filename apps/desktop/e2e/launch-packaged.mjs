// Launches the packaged app (release/*-unpacked or the macOS .app) on a copy of the sample hive,
// connects over the DevTools protocol (fuses block Playwright's usual --inspect attach), and
// checks the hive loads. Used by CI on macOS, Windows and Linux.
// Usage: node apps/desktop/e2e/launch-packaged.mjs [screenshot.png]
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const release = join(root, 'apps/desktop/release');
const { chromium } = createRequire(import.meta.url)('playwright');

function findBinaries() {
  const dirs = readdirSync(release).filter((d) => /-unpacked$|^mac/.test(d));
  const out = [];
  for (const d of dirs) {
    const base = join(release, d);
    if (process.platform === 'darwin') {
      const app = join(base, 'Basalt.app/Contents/MacOS');
      if (existsSync(app)) out.push(join(app, readdirSync(app)[0]));
    } else if (process.platform === 'win32') {
      if (existsSync(join(base, 'basalt.exe'))) out.push(join(base, 'basalt.exe'));
    } else if (existsSync(join(base, 'basalt'))) out.push(join(base, 'basalt'));
  }
  // Only builds for this machine's CPU can run here (Apple Silicon runners have no Rosetta).
  if (process.platform === 'darwin') return out.filter((p) => (process.arch === 'arm64' ? !p.includes('/mac/') : !p.includes('mac-arm64')));
  return out.filter((p) => (process.arch === 'arm64') === /arm64/.test(p));
}

async function check(bin, port) {
  const hive = join(mkdtempSync(join(tmpdir(), 'basalt-pkg-')), 'Sample');
  cpSync(join(root, 'fixtures/sample-hive'), hive, { recursive: true });
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'basalt-ud-'))}`, `--hive=${hive}`];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const env = { ...process.env, BASALT_NO_UPDATES: '1' };
  const detached = process.platform !== 'win32';
  const child = useXvfb ? spawn('xvfb-run', ['-a', bin, ...args], { stdio: 'ignore', env, detached }) : spawn(bin, args, { stdio: 'ignore', env, detached });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const page = browser.contexts()[0].pages().find((p) => !p.url().startsWith('devtools'));
        await page.waitForSelector('.workspace', { timeout: 30000 });
        const rows = await page.locator('.tree-row').count();
        if (rows < 5) throw new Error(`expected the sample hive's files, saw ${rows} rows`);
        if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
        console.log(`ok  ${bin} loaded the hive (${rows} rows, ${page.url().replace(/.*resources/, '…resources')})`);
        await browser.close();
        return;
      } catch (e) {
        if (i === 59) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } finally {
    // Kill the whole process group (xvfb-run, the app and its helpers).
    try {
      if (detached) process.kill(-child.pid, 'SIGTERM');
      else child.kill();
    } catch {
      /* already gone */
    }
  }
}

const bins = findBinaries();
if (!bins.length) throw new Error(`No packaged app found in ${release}`);
let port = 9400 + Math.floor(Math.random() * 400);
for (const bin of bins) await check(bin, port++);
process.exit(0);
