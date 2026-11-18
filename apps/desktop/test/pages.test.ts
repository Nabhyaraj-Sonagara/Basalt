import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_CSP, isPage, pageContentType, pageResponse } from '../src/main/pages';

const dir = mkdtempSync(join(tmpdir(), 'basalt-pages-'));
mkdirSync(join(dir, 'Pages'));
writeFileSync(join(dir, 'Pages/chart.html'), '<h1>Chart</h1>');
writeFileSync(join(dir, 'Pages/app.js'), 'console.log(1)');
writeFileSync(join(dir, 'Secret.md'), '# secret');
const abs = (rel: string) => join(dir, rel);

describe('HTML pages', () => {
  it('knows which files are pages and which assets they may load', () => {
    expect(isPage('Pages/chart.html')).toBe(true);
    expect(isPage('note.md')).toBe(false);
    expect(pageContentType('a/b.css')).toMatch(/text\/css/);
    expect(pageContentType('x.woff2')).toBe('font/woff2');
    expect(pageContentType('Secret.md')).toBeNull();
    expect(pageContentType('data.json')).toBeNull();
  });

  it('serves pages and assets with a no-network CSP', async () => {
    const res = await pageResponse(abs, 'basalt-page://hive/Pages/chart.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('content-security-policy')).toBe(PAGE_CSP);
    expect(PAGE_CSP).toContain("connect-src 'none'");
    expect(await res.text()).toBe('<h1>Chart</h1>');
    expect((await pageResponse(abs, 'basalt-page://hive/Pages/app.js')).headers.get('content-type')).toMatch(/javascript/);
  });

  it('refuses notes, missing files and paths outside the hive', async () => {
    expect((await pageResponse(abs, 'basalt-page://hive/Secret.md')).status).toBe(403);
    expect((await pageResponse(abs, 'basalt-page://hive/Pages/nope.html')).status).toBe(404);
    expect((await pageResponse(abs, 'basalt-page://hive/..%2F..%2Fetc%2Fpasswd.html')).status).toBe(404);
    expect((await pageResponse(abs, 'basalt-page://hive/Pages')).status).toBe(403);
  });
});
