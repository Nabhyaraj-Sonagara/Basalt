// Helpers for HTML pages in the renderer. The page server and its sandbox live in main/pages.ts.
import { extOf } from '@basalt/core/browser';

export const isPagePath = (path: string) => ['html', 'htm'].includes(extOf(path));

/** basalt-page:// URL for a page or asset in the open hive. */
export const pageUrl = (path: string) => `basalt-page://hive/${path.split('/').map(encodeURIComponent).join('/')}`;

/** What iframes showing pages may do: run scripts, nothing else (no same-origin, popups, forms or top navigation). */
export const PAGE_SANDBOX = 'allow-scripts';

/** Starter page for "New HTML page": self-contained, works offline, follows the app's light/dark. */
export const STARTER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>New page</title>
<style>
  :root { color-scheme: light dark; --accent: #e8a317; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid currentColor; background: none; cursor: pointer; }
  button:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); }
</style>
</head>
<body>
<h1>New page</h1>
<p>Write HTML, CSS and JavaScript here. Pages run offline in a sandbox; put images, scripts and styles in the hive next to the page and link to them by relative path.</p>
<button id="hello">Click me</button> <span id="out"></span>
<script>
  let n = 0;
  document.getElementById('hello').onclick = () => (document.getElementById('out').textContent = 'Clicked ' + ++n + ' time' + (n === 1 ? '' : 's'));
</script>
</body>
</html>
`;
