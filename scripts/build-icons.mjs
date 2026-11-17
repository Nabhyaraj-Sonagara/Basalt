// Renders the Basalt app icon (design-system SVG) to apps/desktop/build/icon.png at 1024 px.
// electron-builder derives the macOS .icns and Windows .ico from that PNG.
// Run after changing the logo: node scripts/build-icons.mjs  (uses Playwright's Chromium)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'design-system/project/assets/Logos/basalt-app-icon.svg'), 'utf8');
const out = join(root, 'apps/desktop/build/icon.png');
mkdirSync(dirname(out), { recursive: true });

const { chromium } = createRequire(import.meta.url)('playwright');
// Set CHROMIUM_PATH to use an existing Chromium instead of Playwright's download.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
// About 9% padding so the hexagon sits inside the safe area macOS and Windows expect.
await page.setContent(
  `<html><body style="margin:0;background:transparent"><div style="width:1024px;height:1024px;display:grid;place-items:center">${svg.replace(
    /width="512" height="512"/,
    'width="840" height="840"',
  )}</div></body></html>`,
);
await page.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(`Wrote ${out}`);
