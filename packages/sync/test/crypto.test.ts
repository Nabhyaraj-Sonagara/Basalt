import { describe, expect, it } from 'vitest';
import { deriveKeys, hiveKeys, open, openMeta, pathId, randomKey, seal, sealMeta } from '../src/crypto';
import { isSynced, syncsFile } from '../src/fs';

const FAST = { N: 2 ** 10, r: 8, p: 1 };

describe('sync crypto', () => {
  it('derives stable, separate keys from a password', async () => {
    const salt = Buffer.alloc(16, 7);
    const a = await deriveKeys('correct horse battery', salt, FAST);
    const b = await deriveKeys('correct horse battery', salt, FAST);
    const c = await deriveKeys('correct horse battery!', salt, FAST);
    expect(a.authKey.equals(b.authKey)).toBe(true);
    expect(a.authKey.equals(a.kek)).toBe(false);
    expect(a.authKey.equals(c.authKey)).toBe(false);
  });

  it('seals and opens, and rejects tampering or the wrong context', () => {
    const key = randomKey();
    const sealed = seal(key, Buffer.from('hello notes'), 'ctx');
    expect(open(key, sealed, 'ctx').toString()).toBe('hello notes');
    expect(() => open(key, sealed, 'other')).toThrow();
    const bad = Buffer.from(sealed);
    bad[bad.length - 20] ^= 1;
    expect(() => open(key, bad, 'ctx')).toThrow();
    expect(() => open(randomKey(), sealed, 'ctx')).toThrow();
    expect(seal(key, Buffer.from('x')).equals(seal(key, Buffer.from('x')))).toBe(false);
  });

  it('hides paths behind a keyed id that normalises Unicode', () => {
    const keys = hiveKeys(randomKey());
    const nfc = pathId(keys, 'Café.md');
    expect(pathId(keys, 'Café.md')).toBe(nfc);
    expect(nfc).toMatch(/^[a-f0-9]{64}$/);
    expect(pathId(hiveKeys(randomKey()), 'Café.md')).not.toBe(nfc);
  });

  it('binds metadata to its file id', () => {
    const keys = hiveKeys(randomKey());
    const meta = { path: 'Projects/Plan.md', hash: 'ab', size: 2, mtime: 1 };
    const s = sealMeta(keys, 'id-1', meta);
    expect(openMeta(keys, 'id-1', s)).toEqual(meta);
    expect(() => openMeta(keys, 'id-2', s)).toThrow();
  });

  it('skips per-device and temporary files', () => {
    for (const p of ['Note.md', '.basalt/settings.json', '.basalt/agents.md', 'Attachments/a.png']) expect(isSynced(p)).toBe(true);
    for (const p of ['.basalt/index/x.json', '.basalt/workspace.json', '.basalt/snapshots/a', '.git/HEAD', 'a/.DS_Store', 'Note.md.123.456.tmp', 'Note.md.basalt-sync.tmp', '.obsidian/app.json']) {
      expect(isSynced(p)).toBe(false);
    }
  });

  it('syncs notes and their text files, not attachments', () => {
    for (const p of ['Note.md', 'Maps/Plan.MD', 'Board.canvas', 'Pages/home.html', 'Pages/style.css', '.basalt/settings.json', '.basalt/plugins/goal/main.js', 'diagram.svg']) {
      expect(syncsFile(p)).toBe(true);
    }
    for (const p of ['Attachments/a.png', 'scan.pdf', 'clip.mp4', 'song.mp3', 'archive.zip', 'README', '.env', 'notes.md.basalt-sync.tmp', '.basalt/workspace.json']) {
      expect(syncsFile(p)).toBe(false);
    }
  });
});
