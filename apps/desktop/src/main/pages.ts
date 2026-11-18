// HTML pages: `.html` files in a hive that Basalt shows as live pages, and that notes can embed
// with ![[page.html]]. People and agents write them, so they run fenced in:
//   - served from their own scheme (basalt-page:), in iframes with sandbox="allow-scripts" and no
//     allow-same-origin, so a page can't reach Basalt, the window or other frames;
//   - with a CSP that blocks all network access, so a page can't send anything anywhere;
//   - only as the asset types a page needs (no Markdown or other hive data).
import { promises as fs } from 'node:fs';
import { extOf, safeRelPath } from '@basalt/core';

export const PAGE_SCHEME = 'basalt-page';

export const PAGE_CSP = [
  "default-src 'none'",
  "script-src basalt-page: 'unsafe-inline' 'unsafe-eval'",
  "style-src basalt-page: 'unsafe-inline'",
  'img-src basalt-page: data: blob:',
  'font-src basalt-page: data:',
  'media-src basalt-page: data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export const isPage = (path: string) => ['html', 'htm'].includes(extOf(path));

/** The content type a page asset is served as, or null if pages may not load it. */
export function pageContentType(path: string): string | null {
  return TYPES[extOf(path)] ?? null;
}

const MAX_BYTES = 25 * 1024 * 1024;

/** Answers a basalt-page://hive/<path> request from the open hive's folder. */
export async function pageResponse(abs: (rel: string) => string, url: string): Promise<Response> {
  const headers = { 'Content-Security-Policy': PAGE_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
  try {
    const rel = safeRelPath(decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')));
    const type = pageContentType(rel);
    if (!type) return new Response('Pages can only load web assets (HTML, CSS, scripts, images, fonts, audio, video).', { status: 403, headers: { ...headers, 'Content-Type': 'text/plain' } });
    const file = abs(rel);
    const st = await fs.stat(file);
    if (!st.isFile() || st.size > MAX_BYTES) return new Response('Not found', { status: 404, headers });
    return new Response(new Uint8Array(await fs.readFile(file)), { status: 200, headers: { ...headers, 'Content-Type': type } });
  } catch {
    return new Response('Not found', { status: 404, headers });
  }
}
