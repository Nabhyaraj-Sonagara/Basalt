// End-to-end check of the built desktop app on a copy of the sample hive.
// Usage: xvfb-run -a node apps/desktop/e2e/run.mjs [screenshot-dir]
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { _electron: electron } = createRequire(import.meta.url)('playwright');
const root = resolve(import.meta.dirname, '../../..');
const base = mkdtempSync(join(tmpdir(), 'basalt-e2e-'));
const hive = join(base, 'Sample');
cpSync(join(root, 'fixtures/sample-hive'), hive, { recursive: true });
const out = process.argv[2] ?? join(root, 'apps/desktop/e2e/screenshots');
mkdirSync(out, { recursive: true });
const read = (p) => readFileSync(join(hive, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Basalt's Mod key is Cmd on macOS and Ctrl elsewhere.
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const userData = mkdtempSync(join(tmpdir(), 'basalt-ud-'));
// A fake home folder, so "Connect" writes AI app configs there and never to the real ones.
const fakeHome = mkdtempSync(join(tmpdir(), 'basalt-home-'));
mkdirSync(join(fakeHome, '.codex'));
// A stand-in for a local Ollama server with a model that can see pictures.
const modelRequests = [];
const fakeModel = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/api/tags') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'llava:13b' }] }));
    if (req.url === '/v1/chat/completions') {
      const body = JSON.parse(raw);
      modelRequests.push(body);
      const system = body.messages[0].content;
      const answer = /mind map/i.test(system) ? '# Welcome\n\n- Try things\n  - Comb view\n- Install' : 'Here it is:\n```mermaid\nflowchart TD\n  A["Idea"] --> B["Ship"]\n```';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => fakeModel.listen(0, '127.0.0.1', r));
const fakeModelUrl = `http://127.0.0.1:${fakeModel.address().port}`;

const launch = (extra) =>
  electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [join(root, 'apps/desktop'), '--no-sandbox', `--user-data-dir=${userData}`, ...extra],
    env: { ...process.env, BASALT_NO_UPDATES: '1', BASALT_CONNECT_HOME: fakeHome, XDG_CONFIG_HOME: join(fakeHome, '.config'), CODEX_HOME: join(fakeHome, '.codex'), BASALT_OLLAMA_URL: fakeModelUrl, BASALT_LMSTUDIO_URL: 'http://127.0.0.1:9' },
  });
let app = await launch([`--hive=${hive}`]);
let page = await app.firstWindow();
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
  await page.keyboard.press(`${mod}+E`);
  // The note's text arrives asynchronously after the reading pane mounts.
  await page.waitForSelector('.reading .bs-callout-tip');
  assert.equal(await page.locator('.reading li.task-item').count(), 3);
  assert.ok(await page.locator('.reading mark').count());
  assert.ok(!(await page.locator('.reading').innerText()).includes('comments stay hidden'));
  await shot('02-reading-view');
  await page.keyboard.press(`${mod}+E`);
  await page.waitForSelector('.cm-content');
});

await step('toggles a task from live preview and saves to disk', async () => {
  await page.locator('.cm-task button').first().click();
  await sleep(700);
  assert.match(read('Welcome.md'), /- \[x\] Open the comb view/);
});

await step('quick switcher opens a note by fuzzy name', async () => {
  await page.keyboard.press(`${mod}+O`);
  await page.keyboard.type('lnk nts');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === 'Linking notes');
  await page.waitForSelector('.cm-embed .bs-embed-body p, .cm-embed .bs-embed-body ul', { timeout: 5000 });
  await shot('03-embed-and-backlinks');
});

await step('creates a note, links with autocomplete, and the backlink appears', async () => {
  await page.keyboard.press(`${mod}+N`);
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
  await page.keyboard.press(`${mod}+O`);
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
  await page.keyboard.press(`${mod}+Shift+F`);
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
  await page.keyboard.press(`${mod}+P`);
  await page.keyboard.type('comb view');
  await shot('06-command-palette');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.global-comb .bs-comb-cell');
  assert.ok((await page.locator('.global-comb .bs-comb-cell').count()) >= 7);
  await shot('07-comb-view');
});

await step('canvas renders cards and edges', async () => {
  await page.keyboard.press(`${mod}+O`);
  await page.keyboard.type('Canvas map');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.canvas-node');
  assert.equal(await page.locator('.canvas-node').count(), 3);
  assert.equal(await page.locator(".canvas-edges g > path").count(), 2);
  await sleep(500);
  await shot('08-canvas');
});

await step('daily note from the command palette', async () => {
  await page.keyboard.press(`${mod}+Shift+D`);
  await page.waitForFunction(() => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector('.note-title')?.value ?? ''));
});

await step('dark Basalt theme', async () => {
  await page.keyboard.press(`${mod}+O`);
  await page.keyboard.type('Welcome');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`${mod}+P`);
  await page.keyboard.type('switch light and dark');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'basalt');
  await page.locator('.right-panel [title="Comb"]').click();
  await sleep(600);
  await shot('09-basalt-dark-theme');
});

await step('settings and assistant setup', async () => {
  await page.keyboard.press(`${mod}+,`);
  await page.waitForSelector('.settings');
  await page.locator('.settings-nav button:text("Assistant")').click();
  await page.waitForSelector('.settings-body .bs-settings');
  await shot('10-settings-assistant');
  await page.locator('.settings-nav button:text("AI apps and agents")').click();
  await page.waitForSelector('.copy-block');
  // The launch command arrives from the main process a moment after the page renders.
  await page.waitForFunction(() => /--mcp/.test(document.querySelector('.copy-block pre')?.textContent ?? ''), null, { timeout: 10000 });
  await shot('11-settings-agents');
  await page.keyboard.press('Escape');
});

const palette = async (command) => {
  await page.keyboard.press(`${mod}+P`);
  await page.keyboard.type(command);
  await page.waitForSelector('.palette-wrap li[role="option"]');
  await page.keyboard.press('Enter');
};

await step('slash commands insert a heading', async () => {
  await page.keyboard.press(`${mod}+N`);
  await page.waitForFunction(() => document.activeElement?.classList.contains('note-title'));
  await page.keyboard.type('Slash test');
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.type('/heading 2');
  await page.waitForSelector('.cm-tooltip-autocomplete li:has-text("Heading 2")');
  await shot('12-slash-commands');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type('This line moves out');
  await sleep(800);
  assert.match(read('Slash test.md'), /^## Plan\nThis line moves out/m);
});

await step('extract selection to a new note leaves a link', async () => {
  await page.keyboard.press('Shift+Home');
  await palette('extract selection');
  await page.waitForSelector('.dialog-field input');
  await page.fill('.dialog-field input', 'Moved idea');
  await page.keyboard.press('Enter');
  await sleep(900);
  assert.equal(read('Moved idea.md').trim(), 'This line moves out');
  assert.match(read('Slash test.md'), /^\[\[Moved idea\]\]$/m);
});

await step('copy a basalt:// link to the note', async () => {
  await palette('copy basalt link');
  await sleep(300);
  const text = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(text, 'basalt://open?hive=Sample&file=Slash%20test.md');
});

await step('open a note in a pop-out window', async () => {
  const popupPromise = app.waitForEvent('window', { timeout: 15000 });
  popupPromise.catch(() => {});
  await palette('open this note in a new window');
  const popup = await popupPromise;
  await popup.waitForSelector('.workspace.no-left.no-right .cm-content', { timeout: 10000 });
  assert.equal(await popup.inputValue('.note-title'), 'Slash test');
  await popup.screenshot({ path: join(out, '13-pop-out-window.png') });
  await popup.close();
});

await step('merge a note into another and repoint links', async () => {
  await page.keyboard.press(`${mod}+O`);
  await page.keyboard.type('Ada');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === 'Ada');
  await palette('merge this note');
  await page.keyboard.type('Linking notes');
  await sleep(200);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === 'Linking notes', null, { timeout: 5000 });
  await sleep(800);
  assert.ok(!existsSync(join(hive, 'People/Ada.md')), 'Ada moved to the trash');
  assert.match(read('Linking notes.md'), /^## Ada$/m);
  const daily = read('Daily/2026-11-15.md');
  assert.ok(!daily.includes('People/Ada'), daily);
  assert.match(daily, /\[\[Linking notes\]\]/);
});

await step('spellcheck setting turns on the spellchecker; about page shows the version', async () => {
  assert.equal(await app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled()), false);
  await page.keyboard.press(`${mod}+,`);
  await page.waitForSelector('.settings');
  await page.locator('.bs-setting', { hasText: 'Spellcheck' }).locator('[role=switch]').click();
  await sleep(500);
  assert.equal(await app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled()), true);
  await page.locator('.settings-nav button:text("About and updates")').click();
  const { version } = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
  await page.waitForSelector(`.bs-setting-label:text("Version ${version}")`);
  await page.keyboard.press('Escape');
});

await step('customize: bigger icons, an accent colour, toolbar buttons and the hive crest', async () => {
  const iconWidth = () => page.locator('.side-actions svg').first().evaluate((el) => el.getBoundingClientRect().width);
  assert.equal(Math.round(await iconWidth()), 20);
  assert.ok(await page.locator('.sidebar .hive-crest').isVisible());
  await page.keyboard.press(`${mod}+,`);
  await page.locator('.settings-nav button:text("Appearance")').click();
  await page.locator('button[aria-label="Sky accent"]').click();
  assert.equal((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--honey'))).trim(), '#3f7fb3');
  await page.locator('.bs-setting', { hasText: 'Icon size' }).locator('select').selectOption('24');
  await page.locator('input[aria-label="Show Open a random note in the toolbar"]').check();
  await page.fill('input[aria-label="Hive emoji"]', '📚');
  await page.locator('form:has(input[aria-label="Hive emoji"]) button[type=submit]').click();
  await sleep(300);
  await page.screenshot({ path: join(out, '15-appearance-settings.png') });
  await page.keyboard.press('Escape');
  assert.equal(Math.round(await iconWidth()), 24);
  assert.ok(await page.locator('.side-actions button[aria-label="Open a random note"]').isVisible());
  assert.match(await page.locator('.sidebar .hive-crest').innerHTML(), /📚/);
  assert.match(read('.basalt/appearance.json'), /📚/);
  await page.screenshot({ path: join(out, '16-customized-sidebar.png') });
  // Back to the defaults for the remaining checks.
  await page.evaluate(() => localStorage.removeItem('basalt.appearance'));
});

await step('connect Codex to the hive with one click', async () => {
  await page.keyboard.press(`${mod}+,`);
  await page.locator('.settings-nav button:text("AI apps and agents")').click();
  const row = page.locator('.bs-setting', { hasText: 'Codex (ChatGPT)' });
  await row.locator('button:has-text("Connect")').click();
  await row.locator('button:has-text("Disconnect")').waitFor({ timeout: 5000 });
  const toml = readFileSync(join(fakeHome, '.codex', 'config.toml'), 'utf8');
  assert.match(toml, /\[mcp_servers\.basalt-sample\]/);
  assert.match(toml, /--mcp/);
  await page.screenshot({ path: join(out, '17-connect-apps.png') });
  await page.keyboard.press('Escape');
});

await step('mind map: new map, branches by keyboard, saved as Markdown', async () => {
  await palette('New mind map');
  await page.waitForSelector('.mm-node.depth-0');
  assert.equal(await page.inputValue('.note-title'), 'Mind map');
  await page.locator('.mm-node.depth-0').click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('Sketches');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Welcome]]');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Read it');
  await page.keyboard.press('Enter');
  // Rename by typing over a selected branch.
  await page.locator('.mm-node', { hasText: 'Sketches' }).click();
  await page.keyboard.press('F2');
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.type('Drawings');
  await page.keyboard.press('Enter');
  await sleep(700);
  const md = read('Mind map.md');
  assert.match(md, /^view: mindmap$/m);
  assert.match(md, /^# Mind map$/m);
  assert.match(md, /^- First branch\n- Drawings\n- \[\[Welcome\]\]\n  - Read it$/m);
  assert.equal(await page.locator('.mm-link').count(), 1);
  await sleep(200);
  await shot('18-mind-map');
});

await step('mind map: folds, deletes and switches to the Markdown', async () => {
  await page.locator('.mm-node', { hasText: 'Drawings' }).click();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.mm-node.selected .mm-link').innerText(), 'Welcome');
  await page.keyboard.press(' ');
  assert.equal(await page.locator('.mm-node', { hasText: 'Read it' }).count(), 0);
  await page.locator('.mm-more').click({ timeout: 5001 });
  await page.locator('.mm-node', { hasText: 'First branch' }).click({ timeout: 5002 });
  await page.keyboard.press('Delete');
  await sleep(600);
  assert.doesNotMatch(read('Mind map.md'), /First branch/);
  await page.locator('.note-mode button:has-text("Text")').click({ timeout: 5003 });
  await page.waitForSelector('.cm-content');
  assert.match(await page.locator('.cm-content').innerText(), /Drawings/);
  await page.locator('.note-mode button:has-text("Map")').click();
  await page.waitForSelector('.mm-node.depth-0');
});

await step('create a mind map from a note', async () => {
  await page.keyboard.press(`${mod}+O`);
  await page.keyboard.type('Welcome');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cm-content');
  await palette('Create a mind map from this note');
  await page.waitForSelector('.mm-node.depth-0');
  assert.equal(await page.inputValue('.note-title'), 'Welcome map');
  assert.ok(await page.locator('.mm-node', { hasText: 'What to try' }).isVisible());
  const md = read('Welcome map.md');
  assert.match(md, /^# Welcome to your hive\n\n- What to try\n  - Open the comb view/m);
  assert.match(md, /- Open the comb view/);
  await shot('19-mind-map-from-note');
});

await step('illustrate a sketch into a flowchart with a local model', async () => {
  await page.keyboard.press(`${mod}+,`);
  await page.locator('.settings-nav button:text("Assistant")').click();
  const local = page.locator('.bs-setting', { hasText: 'Ollama' }).first();
  await local.locator('button:has-text("Use")').click();
  await page.getByText('Using llava:13b in Ollama').waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+O`);
  await page.keyboard.type('Welcome');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cm-content');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await palette('Illustrate a sketch or photo');
  const pad = page.locator('canvas.sketch-canvas');
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 60 + i * 25, box.y + 60 + i * 12);
  await page.mouse.up();
  await page.locator('.dialog-illustrate select').selectOption('flowchart');
  await shot('20-illustrate-sketch');
  await page.locator('.dialog-illustrate button:has-text("Illustrate")').last().click();
  await page.waitForSelector('.dialog-illustrate', { state: 'detached', timeout: 15000 });
  await sleep(800);
  const sent = modelRequests.at(-1);
  assert.equal(sent.model, 'llava:13b');
  assert.match(sent.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  const md = read('Welcome.md');
  assert.match(md, /```mermaid\nflowchart TD\n  A\["Idea"\] --> B\["Ship"\]\n```/);
  const pic = /!\[\[(Attachments\/Sketch [^\]]+\.png)\]\]/.exec(md);
  assert.ok(pic, 'the sketch is saved and embedded');
  assert.ok(existsSync(join(hive, pic[1])));
  await page.keyboard.press(`${mod}+E`);
  await page.waitForSelector('.reading .mermaid-block svg', { timeout: 15000 });
  await page.locator('.reading .mermaid-block').scrollIntoViewIfNeeded();
  await shot('21-illustrated-flowchart');
  await page.keyboard.press(`${mod}+E`);
});

await step('ask the assistant to map a note', async () => {
  await palette('Ask the assistant to illustrate this note');
  assert.equal(await page.locator('.dialog-illustrate select').inputValue(), 'mindmap');
  await page.locator('.dialog-illustrate button:has-text("Illustrate")').last().click();
  await page.waitForSelector('.mm-node.depth-0', { timeout: 15000 });
  assert.equal(await page.inputValue('.note-title'), 'Welcome map 1');
  const md = read('Welcome map 1.md');
  assert.match(md, /^source: "\[\[Welcome\]\]"$/m);
  assert.match(md, /^- Try things\n  - Comb view\n- Install$/m);
  assert.match(modelRequests.at(-1).messages[1].content, /Welcome to your hive/);
});

await step('no renderer errors', async () => {
  assert.deepEqual(errors, []);
});

await app.close();

// A basalt:// link at launch opens the note in the last hive (packaged builds get links this way on Windows and Linux).
await step('a basalt:// link opens a note', async () => {
  app = await launch(['basalt://open?hive=Sample&file=Linking%20notes']);
  page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === 'Linking notes', null, { timeout: 20000 });
  await app.close();
});

// First launch: a fresh profile with no hive shows the start screen, and the sample hive opens.
await step('first launch shows the start screen and opens the sample hive', async () => {
  const fresh = mkdtempSync(join(tmpdir(), 'basalt-ud-fresh-'));
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [join(root, 'apps/desktop'), '--no-sandbox', `--user-data-dir=${fresh}`],
    env: { ...process.env, BASALT_NO_UPDATES: '1', BASALT_DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'basalt-docs-')) },
  });
  page = await app.firstWindow();
  const firstErrors = [];
  page.on('pageerror', (e) => firstErrors.push(String(e)));
  await page.getByText('Open a hive').waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(out, '00-start-screen.png') });
  await page.getByRole('button', { name: 'Try the sample hive' }).click();
  await page.waitForSelector('.workspace .cm-content', { timeout: 20000 });
  assert.deepEqual(firstErrors, []);
  await app.close();
});

for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
