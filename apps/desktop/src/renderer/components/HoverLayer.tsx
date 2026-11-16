import { useEffect, useRef, useState } from 'react';
import { HoverPreview } from '@basalt/ui';
import { subpathText, splitFrontmatter } from '@basalt/core/browser';
import { api, createNote, openLink, openPath } from '../lib/actions';
import { getState } from '../lib/store';

interface HoverState {
  x: number;
  y: number;
  path: string | null;
  target: string;
  subpath?: string;
  source: string;
  excerpt: string;
}

/** Page preview: hovering a link shows the note it points at. */
export function HoverLayer() {
  const [hover, setHover] = useState<HoverState | null>(null);
  const timer = useRef<number | null>(null);
  const inside = useRef(false);

  useEffect(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.cm-wikilink, a.bs-link-internal, a.bs-link-unresolved');
      if (!el || el.closest('.bs-hover')) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        const source = el.closest<HTMLElement>('[data-path].editor-host, .bs-embed[data-path]')?.dataset.path ?? (document.querySelector('.pane-active .editor-host, .pane .editor-host') as HTMLElement | null)?.dataset.path ?? '';
        const target = el.dataset.target ?? '';
        const subpath = el.dataset.subpath || undefined;
        const path = el.dataset.path || (target ? getState().resolver.resolve(target, source) : source) || null;
        const r = el.getBoundingClientRect();
        let excerpt = '';
        if (path && /\.(md|markdown)$/i.test(path)) {
          const text = await api().hive.read(path).catch(() => '');
          excerpt = (subpath ? subpathText(text, subpath) : text.slice(splitFrontmatter(text).bodyStart)).replace(/^#+\s.*\n/, '').trim().slice(0, 600);
        }
        setHover({ x: Math.min(r.left, window.innerWidth - 380), y: r.bottom + 8 > window.innerHeight - 260 ? Math.max(8, r.top - 268) : r.bottom + 8, path, target, subpath, source, excerpt });
      }, 450);
    };
    const out = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('.cm-wikilink, a.bs-link-internal, a.bs-link-unresolved');
      if (!el) return;
      if (timer.current) clearTimeout(timer.current);
      setTimeout(() => !inside.current && setHover(null), 200);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    const hideOnKey = () => setHover(null);
    document.addEventListener('keydown', hideOnKey);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('keydown', hideOnKey);
    };
  }, []);

  if (!hover) return null;
  const note = hover.path ? getState().notesByPath.get(hover.path) : undefined;
  return (
    <div
      className="hover-layer"
      style={{ left: hover.x, top: hover.y }}
      onMouseEnter={() => (inside.current = true)}
      onMouseLeave={() => {
        inside.current = false;
        setHover(null);
      }}
    >
      <HoverPreview
        title={note?.title ?? hover.target}
        path={hover.path ?? undefined}
        heading={hover.subpath?.replace(/^#\^?/, '')}
        tags={note?.tags.slice(0, 4)}
        meta={note ? `${note.wordCount} words` : undefined}
        unresolved={!hover.path}
        maxLines={8}
        onOpen={() => {
          setHover(null);
          if (hover.path) void openLink(hover.target || hover.path, hover.subpath, hover.source);
        }}
        onCreate={async () => {
          setHover(null);
          const p = await createNote(hover.target);
          if (p) openPath(p);
        }}
      >
        {hover.excerpt}
      </HoverPreview>
    </div>
  );
}
