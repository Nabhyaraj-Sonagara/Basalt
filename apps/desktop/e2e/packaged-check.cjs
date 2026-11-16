// Checks a packaged, fused build. Fuses disable --inspect, so Playwright's Electron
// launcher can't attach; instead start the app with --remote-debugging-port=9333 and run:
//   node apps/desktop/e2e/packaged-check.cjs screenshot.png
const { chromium } = require('playwright');
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
      const page = b.contexts()[0].pages().find((p) => !p.url().startsWith('devtools')) ;
      await page.waitForSelector('.workspace', { timeout: 20000 });
      console.log('url:', page.url().replace(/.*resources/, '…resources'), '| title:', await page.title(), '| tree rows:', await page.locator('.tree-row').count());
      await page.screenshot({ path: process.argv[2] });
      await b.close();
      return;
    } catch (e) { await new Promise((r) => setTimeout(r, 500)); }
  }
  console.log('could not connect');
})();
