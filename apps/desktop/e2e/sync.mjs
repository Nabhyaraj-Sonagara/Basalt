// End-to-end sync check: two copies of the desktop app, each with its own hive folder and
// profile, sync through a running Basalt Sync server.
// Usage: SYNC_URL=http://127.0.0.1:18080 [SYNC_BLOB_DIR=<server DATA_DIR>] xvfb-run -a node apps/desktop/e2e/sync.mjs [screenshot-dir]
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const SYNC_URL = process.env.SYNC_URL;
if (!SYNC_URL) throw new Error('Set SYNC_URL to a running sync server.');
const root = resolve(import.meta.dirname, '../../..');
const out = process.argv[2] ?? join(root, 'apps/desktop/e2e/screenshots');
mkdirSync(out, { recursive: true });
const base = mkdtempSync(join(tmpdir(), 'basalt-sync-e2e-'));
const email = `e2e-${Date.now()}@example.com`;
const password = 'correct horse battery staple';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function launch(name, hive) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [join(root, 'apps/desktop'), '--no-sandbox', `--user-data-dir=${join(base, `profile-${name}`)}`, `--hive=${hive}`],
    env: { ...process.env, BASALT_NO_UPDATES: '1' },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.waitForSelector('.workspace', { timeout: 20000 });
  return { app, page };
}

async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(250);
  }
}

async function openSync(page) {
  await page.keyboard.press(`${mod}+,`);
  await page.waitForSelector('.settings');
  await page.locator('.settings-nav button:text("Sync")').click();
}

async function signIn(page, create) {
  await openSync(page);
  await page.fill('.sync-form input[type=url]', SYNC_URL);
  await page.fill('.sync-form input[type=email]', email);
  await page.fill('.sync-form input[type=password]', password);
  await page.locator(create ? '.sync-form button:has-text("Create account")' : '.sync-form button:has-text("Sign in")').click();
  await page.waitForSelector('.bs-setting-label:text("Sync this hive")', { timeout: 20000 });
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').slice(0, 3).join(' | ')]);
    for (const [n, d] of [['a', A], ['b', B]]) await d.page.screenshot({ path: join(out, `fail-sync-${n}-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
  }
}

const hiveA = join(base, 'Sample');
cpSync(join(root, 'fixtures/sample-hive'), hiveA, { recursive: true });
const hiveB = join(base, 'Laptop');
mkdirSync(hiveB);
writeFileSync(join(hiveB, 'From the laptop.md'), '# From the laptop\n\nWritten on device B.');

const A = await launch('a', hiveA);
const B = await launch('b', hiveB);

await step('create an account and start syncing a hive', async () => {
  await signIn(A.page, true);
  await A.page.locator('.bs-setting:has-text("Sync this hive") button:has-text("Start syncing")').click();
  await A.page.waitForSelector('.bs-setting-label:text("Syncing with “Sample”")', { timeout: 20000 });
  await A.page.screenshot({ path: join(out, '14-sync-settings.png') });
  await A.page.keyboard.press('Escape');
  await A.page.waitForSelector('.status-bar .sync-idle:text("Synced")', { timeout: 20000 });
});

await step('a second device signs in, joins the hive and both converge', async () => {
  await signIn(B.page, false);
  const select = B.page.locator('.bs-setting:has-text("Sync this hive") select');
  await select.selectOption({ label: 'Sample' });
  await B.page.locator('.bs-setting:has-text("Sync this hive") button:has-text("Start syncing")').click();
  await B.page.waitForSelector('.bs-setting-label:text("Syncing with “Sample”")', { timeout: 20000 });
  await B.page.keyboard.press('Escape');
  await waitFor(() => existsSync(join(hiveB, 'Welcome.md')) && existsSync(join(hiveB, 'People/Ada.md')), 'the hive to download to B');
  await waitFor(() => existsSync(join(hiveA, 'From the laptop.md')), "B's note to reach A");
  await B.page.waitForSelector('.tree-row:has-text("Welcome")', { timeout: 10000 });
});

await step('an edit on one device appears on the other', async () => {
  writeFileSync(join(hiveA, 'Linking notes.md'), readFileSync(join(hiveA, 'Linking notes.md'), 'utf8') + '\nEdited on device A.\n');
  await waitFor(() => readFileSync(join(hiveB, 'Linking notes.md'), 'utf8').includes('Edited on device A.'), 'the edit to reach B');
});

// With SYNC_BLOB_DIR (the server's DATA_DIR), check the stored files hold no plain text.
if (process.env.SYNC_BLOB_DIR) {
  await step('the server stores only ciphertext', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : files.push(join(d, n))));
    walk(process.env.SYNC_BLOB_DIR);
    assert.ok(files.length > 5, `expected stored files, found ${files.length}`);
    for (const f of files) {
      const data = readFileSync(f);
      for (const needle of ['Written on device B', 'Edited on device A', 'Welcome to your hive', 'From the laptop']) assert.ok(!data.includes(needle), `${f} contains "${needle}"`);
    }
  });
}

await A.app.close();
await B.app.close();
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} sync checks passed.`);
process.exit(failed ? 1 : 0);
