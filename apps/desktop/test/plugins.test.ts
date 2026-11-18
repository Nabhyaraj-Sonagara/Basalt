import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_CSP, SDK_JS, listPlugins, parseManifest, pluginResponse } from '../src/main/plugins';

const dir = mkdtempSync(join(tmpdir(), 'basalt-plugins-'));
const add = (folder: string, manifest: unknown, files: Record<string, string> = { 'main.js': 'basalt.ui.status("hi")' }) => {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, folder, f), t);
};
add('word-goal', { id: 'word-goal', name: 'Word goal', version: '1.0.0', permissions: ['read'], panel: 'panel.html' }, { 'main.js': 'x', 'panel.html': '<p>Goal</p>', 'data.json': '{}' });
add('broken', '{ not json');
add('wrong-id', { id: 'other', name: 'X', version: '1' });
add('no-main', { id: 'no-main', name: 'X', version: '1' }, {});

describe('plugins', () => {
  it('validates manifests', () => {
    expect(parseManifest({ id: 'ok-1', name: 'OK', version: '1' }, 'ok-1')).toEqual({ id: 'ok-1', name: 'OK', version: '1', permissions: [], main: 'main.js', description: undefined, author: undefined });
    expect(() => parseManifest({ id: 'Bad Id', name: 'x', version: '1' }, 'Bad Id')).toThrow(/lowercase/);
    expect(() => parseManifest({ id: 'sdk', name: 'x', version: '1' }, 'sdk')).toThrow(/not "sdk"/);
    expect(() => parseManifest({ id: 'a1', name: 'x', version: '1', permissions: ['network'] }, 'a1')).toThrow(/"read" and "write"/);
    expect(() => parseManifest({ id: 'a1', name: 'x', version: '1', main: '../../evil.js' }, 'a1')).toThrow();
    expect(() => parseManifest({ id: 'a1', name: 'x', version: '1', panel: 'p.js' }, 'a1')).toThrow(/\.html/);
  });

  it('lists plugins with clear errors', async () => {
    const list = await listPlugins(dir);
    const by = Object.fromEntries(list.map((p) => [p.folder, p]));
    expect(by['word-goal'].manifest?.permissions).toEqual(['read']);
    expect(by.broken.error).toMatch(/isn't valid JSON/);
    expect(by['wrong-id'].error).toMatch(/must match the folder/);
    expect(by['no-main'].error).toBe('Missing main.js');
    expect(await listPlugins(join(dir, 'nope'))).toEqual([]);
  });

  it('serves the SDK, a background page, and assets under a no-network CSP', async () => {
    const sdk = await pluginResponse(dir, 'basalt-plugin://sdk/basalt.js');
    expect(await sdk.text()).toBe(SDK_JS);
    expect(PLUGIN_CSP).toContain("connect-src 'none'");
    expect(PLUGIN_CSP).toContain('script-src basalt-plugin:');
    const bg = await pluginResponse(dir, 'basalt-plugin://word-goal/');
    expect(bg.headers.get('content-security-policy')).toBe(PLUGIN_CSP);
    expect(await bg.text()).toContain('<script src="basalt-plugin://word-goal/main.js"></script>');
    expect(await (await pluginResponse(dir, 'basalt-plugin://word-goal/panel.html')).text()).toMatch(/^<script src="basalt-plugin:\/\/sdk\/basalt.js"><\/script>\n<p>Goal<\/p>$/);
    expect((await pluginResponse(dir, 'basalt-plugin://word-goal/manifest.json')).status).toBe(403);
    expect((await pluginResponse(dir, 'basalt-plugin://word-goal/data.json')).status).toBe(403);
    expect((await pluginResponse(dir, 'basalt-plugin://broken/')).status).toBe(404);
    expect((await pluginResponse(dir, 'basalt-plugin://word-goal/..%2F..%2Fsecret.js')).status).toBe(404);
  });
});
