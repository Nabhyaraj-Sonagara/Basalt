// End-to-end check of the built desktop app on a copy of the sample hive.
// Usage: xvfb-run -a node apps/desktop/e2e/run.mjs [screenshot-dir]
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const { _electron: electron } = createRequire(import.meta.url)('playwright');
const root = resolve(import.meta.dirname, '../../..');
const base = mkdtempSync(join(tmpdir(), 'basalt-e2e-'));
const hive = join(base, 'Sample');
cpSync(join(root, 'fixtures/sample-hive'), hive, { recursive: true });
const out = process.argv[2] ?? join(root, 'apps/desktop/e2e/screenshots');
mkdirSync(out, { recursive: true });
const read = (p) => readFileSync(join(hive, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/electron'),
  args: [join(root, 'apps/desktop'), '--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'basalt-ud-'))}`, `--hive=${hive}`],
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewportSize({ width: 1360, height: 860 });
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
}

await page.waitForSelector('.workspace', { timeout: 20000 });
await page.waitForSelector('.cm-content');
await sleep(800);

await step('opens the hive on Welcome in live preview', async () => {
  assert.equal(await page.inputValue('.note-title'), 'Welcome');
  assert.ok(await page.locator('.cm-properties').isVisible(), 'frontmatter collapses into a properties chip');
  assert.ok((await page.locator('.cm-wikilink').count()) >= 3);
  assert.ok((await page.locator('.cm-task').count()) >= 2);
  await shot('01-live-preview-comb-theme');
});

await step('reading view renders callouts, tasks, tags and highlights', async () => {
  await page.keyboard.press('Control+E');
  await page.waitForSelector('.reading');
  assert.ok(await page.locator('.reading .bs-callout-tip').isVisible());
  assert.equal(await page.locator('.reading li.task-item').count(), 3);
  assert.ok(await page.locator('.reading mark').count());
  assert.ok(!(await page.locator('.reading').innerText()).includes('comments stay hidden'));
  await shot('02-reading-view');
  await page.keyboard.press('Control+E');
  await page.waitForSelector('.cm-content');
});

await step('toggles a task from live preview and saves to disk', async () => {
  await page.locator('.cm-task button').first().click();
  await sleep(700);
  assert.match(read('Welcome.md'), /- \[x\] Open the comb view/);
});

await step('quick switcher opens a note by fuzzy name', async () => {
  await page.keyboard.press('Control+O');
  await page.keyboard.type('lnk nts');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === 'Linking notes');
  await page.waitForSelector('.cm-embed .bs-embed-body p, .cm-embed .bs-embed-body ul', { timeout: 5000 });
  await shot('03-embed-and-backlinks');
});

await step('creates a note, links with autocomplete, and the backlink appears', async () => {
  await page.keyboard.press('Control+N');
  await page.waitForFunction(() => document.activeElement?.classList.contains('note-title'));
  await page.keyboard.type('Field notes');
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.type('Met the team. See [[Basa');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  await shot('04-link-autocomplete');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' and #idea/new');
  await sleep(900);
  assert.ok(existsSync(join(hive, 'Field notes.md')), 'renamed from Untitled to Field notes');
  assert.match(read('Field notes.md'), /See \[\[Basalt launch\]\] and #idea\/new/);
  await page.keyboard.press('Control+O');
  await page.keyboard.type('Basalt launch');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.back-card b:text("Field notes")', { timeout: 5000 });
});

await step('renaming a note rewrites links to it', async () => {
  await page.fill('.note-title', 'Launch plan');
  await page.keyboard.press('Enter');
  await sleep(1000);
  assert.ok(existsSync(join(hive, 'Projects/Launch plan.md')));
  assert.match(read('Field notes.md'), /\[\[Launch plan\]\]/);
  assert.match(read('Welcome.md'), /\[\[Launch plan\|launch plan\]\]/);
});

await step('search with operators', async () => {
  await page.keyboard.press('Control+Shift+F');
  await page.keyboard.type('task-todo:engine');
  await page.waitForSelector('.result-title:text("Launch plan")', { timeout: 5000 });
  await shot('05-search');
});

await step('semantic search finds by meaning', async () => {
  await page.locator(".search-options [role=switch]").first().click();
  await page.fill('.side-search input', 'transclusion of content from other notes');
  await page.waitForSelector('.search-results .result', { timeout: 8000 });
});

await step('command palette runs commands; comb view lays out the hive', async () => {
  await page.keyboard.press('Control+P');
  await page.keyboard.type('comb view');
  await shot('06-command-palette');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.global-comb .bs-comb-cell');
  assert.ok((await page.locator('.global-comb .bs-comb-cell').count()) >= 7);
  await shot('07-comb-view');
});

await step('canvas renders cards and edges', async () => {
  await page.keyboard.press('Control+O');
  await page.keyboard.type('Canvas map');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.canvas-node');
  assert.equal(await page.locator('.canvas-node').count(), 3);
  assert.equal(await page.locator(".canvas-edges g > path").count(), 2);
  await sleep(500);
  await shot('08-canvas');
});

await step('daily note from the command palette', async () => {
  await page.keyboard.press('Control+Shift+D');
  await page.waitForFunction(() => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector('.note-title')?.value ?? ''));
});

await step('dark Basalt theme', async () => {
  await page.keyboard.press('Control+O');
  await page.keyboard.type('Welcome');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+P');
  await page.keyboard.type('switch light and dark');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'basalt');
  await page.locator('.right-panel [title="Comb"]').click();
  await sleep(600);
  await shot('09-basalt-dark-theme');
});

await step('settings and assistant setup', async () => {
  await page.keyboard.press('Control+,');
  await page.waitForSelector('.settings');
  await page.locator('.settings-nav button:text("Assistant")').click();
  await page.waitForSelector('.settings-body .bs-settings');
  await shot('10-settings-assistant');
  await page.locator('.settings-nav button:text("Agents and CLI")').click();
  await page.waitForSelector('.copy-block');
  assert.match(await page.locator('.copy-block pre').first().innerText(), /claude mcp add basalt/);
  await shot('11-settings-agents');
  await page.keyboard.press('Escape');
});

await step('no renderer errors', async () => {
  assert.deepEqual(errors, []);
});

await app.close();
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
