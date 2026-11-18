import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import { escapeHtml, renderMarkdown, subpathText, extOf } from '@basalt/core/browser';
import { iconSvg } from './icons';
import { getState } from './store';
import { PAGE_SANDBOX, isPagePath, pageUrl } from './pages';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

export function renderNoteHtml(text: string, sourcePath: string): string {
  const s = getState();
  return renderMarkdown(text, {
    sourcePath,
    resolve: (t, src) => s.resolver.resolve(t, src),
    icon: (n) => iconSvg(n),
    fileUrl: (p) => window.basalt.hive.fileUrl(p),
    math: (tex, display) => katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' }),
    highlight: (code, lang) => (lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value),
    embed: (path, target, _subpath, display) => {
      if (!path) return `<span class="bs-embed-missing">${escapeHtml(target)} isn't written yet</span>`;
      const ext = extOf(path);
      if (isPagePath(path)) {
        // ![[page.html|420]] sets the height in pixels.
        const h = Math.max(120, Math.min(2000, Number.parseInt(display ?? '', 10) || 360));
        return `<iframe class="bs-embed-page" sandbox="${PAGE_SANDBOX}" src="${pageUrl(path)}" style="height:${h}px" title="${escapeHtml(path)}"></iframe>`;
      }
      if (ext === 'pdf') return `<iframe class="bs-embed-pdf" src="${window.basalt.hive.fileUrl(path)}" title="${escapeHtml(display ?? target)}"></iframe>`;
      if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return `<audio controls src="${window.basalt.hive.fileUrl(path)}"></audio>`;
      if (['mp4', 'webm', 'mov'].includes(ext)) return `<video controls src="${window.basalt.hive.fileUrl(path)}"></video>`;
      if (IMAGE.has(ext)) return null;
      return null;
    },
  });
}

let mermaidSeq = 0;

/**
 * Fills in what static HTML can't: note embeds (transclusion, up to 3 levels deep) and Mermaid diagrams.
 */
export async function hydrate(root: HTMLElement, sourcePath: string, depth = 0): Promise<void> {
  const embeds = [...root.querySelectorAll<HTMLElement>('.bs-embed:not([data-hydrated])')];
  await Promise.all(
    embeds.map(async (el) => {
      el.dataset.hydrated = '1';
      const path = el.dataset.path;
      if (!path) return;
      if (depth >= 3 || path === sourcePath && !el.dataset.subpath) {
        el.innerHTML = `<div class="bs-embed-missing">Embed skipped to avoid a loop</div>`;
        return;
      }
      try {
        const full = await window.basalt.hive.read(path);
        const part = subpathText(full, el.dataset.subpath || undefined);
        el.innerHTML = `<div class="bs-embed-head"><a href="#" class="bs-link bs-link-internal" data-path="${escapeHtml(path)}" data-target="${escapeHtml(path)}" data-subpath="${escapeHtml(el.dataset.subpath ?? '')}">${escapeHtml(getState().notesByPath.get(path)?.title ?? path)}${el.dataset.subpath ? ' › ' + escapeHtml(el.dataset.subpath.replace(/^#\^?/, '')) : ''}</a></div><div class="bs-embed-body">${renderNoteHtml(part, path)}</div>`;
        await hydrate(el, path, depth + 1);
      } catch {
        el.innerHTML = `<div class="bs-embed-missing">Couldn't load ${escapeHtml(path)}</div>`;
      }
    }),
  );
  const diagrams = [...root.querySelectorAll<HTMLElement>('.mermaid-block:not([data-hydrated])')];
  if (diagrams.length) {
    const { default: mermaid } = await import('mermaid');
    const dark = document.documentElement.dataset.theme === 'basalt';
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: dark ? { primaryColor: '#3b2b0b', primaryTextColor: '#f3ead8', lineColor: '#b4a892', primaryBorderColor: '#f2b233' } : { primaryColor: '#fbe6ae', primaryTextColor: '#1f1b16', lineColor: '#5c5143', primaryBorderColor: '#e8a317' } });
    for (const el of diagrams) {
      el.dataset.hydrated = '1';
      try {
        const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, el.dataset.src ?? '');
        el.innerHTML = svg;
      } catch (e) {
        el.innerHTML = `<pre class="bs-embed-missing">Diagram error: ${escapeHtml((e as Error).message)}</pre>`;
      }
    }
  }
}
