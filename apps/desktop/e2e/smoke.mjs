// Quick launch: opens the built app on a copy of the sample hive and saves a screenshot.
import { createRequire } from 'node:module';
const { _electron: electron } = createRequire(import.meta.url)('playwright');
import { cpSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const hive = mkdtempSync(join(tmpdir(), 'basalt-e2e-'));
cpSync(join(root, 'fixtures/sample-hive'), join(hive, 'Sample'), { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'basalt-ud-'));
const out = process.argv[2] ?? join(root, 'apps/desktop/e2e/screenshots');
mkdirSync(out, { recursive: true });

// BASALT_BIN runs an unfused packaged build. Fused builds ignore --inspect; use packaged-check.cjs.
const bin = process.env.BASALT_BIN;
const app = await electron.launch({
  executablePath: bin ?? createRequire(import.meta.url)('electron'),
  args: [...(bin ? [] : [join(root, 'apps/desktop')]), '--no-sandbox', `--user-data-dir=${userData}`, `--hive=${join(hive, 'Sample')}`],
});
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.setViewportSize({ width: 1360, height: 860 });
await page.waitForSelector('.workspace', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, 'smoke.png') });
console.log('title:', await page.title(), '| notes in tree:', await page.locator('.tree-row').count(), '| errors:', errors);
await app.close();
