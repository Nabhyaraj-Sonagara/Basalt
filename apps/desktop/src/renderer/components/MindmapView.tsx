import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Button } from '@basalt/ui';
import { findNode, layoutMindmap, mindNode, parseMindmap, serializeMindmap, type MindNode } from '@basalt/core/browser';
import { api, errorToast, openLink } from '../lib/actions';
import { useStore } from '../lib/store';

const COL = 236;
const ROW = 46;
const H = 32;

let measureCtx: CanvasRenderingContext2D | null = null;
const fonts = new Map<number, string>();

/** The font a node at this depth is drawn with, read once from the stylesheet. */
function fontFor(depth: number): string {
  const d = Math.min(depth, 2);
  let f = fonts.get(d);
  if (!f) {
    const probe = document.createElement('div');
    probe.className = `mm-node depth-${d}`;
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    f = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    probe.remove();
    if (cs.fontFamily) fonts.set(d, f);
  }
  return f;
}

/** Pill width from the text, so links meet the node edges without waiting for layout. */
function nodeWidth(text: string, depth: number): number {
  const shown = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
  measureCtx ??= document.createElement('canvas').getContext('2d');
  let w = shown.length * (depth === 0 ? 9.5 : 8.5);
  if (measureCtx) {
    measureCtx.font = fontFor(depth);
    w = measureCtx.measureText(shown).width;
  }
  return Math.round(Math.max(64, Math.min(COL - 36, w + 34)));
}

/** Node text with [[links]] as clickable spans. */
function NodeText({ text, source }: { text: string; source: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const [, target, sub, alias] = m;
    parts.push(
      <a
        key={m.index}
        className="mm-link"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void openLink(target, sub, source, { newTab: e.metaKey || e.ctrlKey });
        }}
      >
        {alias ?? target}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className="mm-text">{parts}</span>;
}

export function MindmapView({ path, focus }: { path: string; focus: boolean }) {
  const version = useStore((s) => s.version);
  const title = useStore((s) => s.notesByPath.get(path)?.title ?? 'Mind map');
  const root = useRef<MindNode | null>(null);
  const lastText = useRef<string>('');
  const [rev, setRev] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const surface = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // Load, and reload when the file changes outside this view (our own writes are skipped).
  useEffect(() => {
    let live = true;
    void api()
      .hive.read(path)
      .then((text) => {
        if (!live || text === lastText.current) return;
        lastText.current = text;
        root.current = parseMindmap(text, title);
        setSelected((s) => (s && root.current && findNode(root.current, s) ? s : root.current!.id));
        setRev((r) => r + 1);
      });
    return () => {
      live = false;
    };
  }, [path, version, title]);

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!root.current) return;
    const text = serializeMindmap(root.current, lastText.current);
    if (text === lastText.current) return;
    lastText.current = text;
    void api().hive.write(path, text).catch((err) => errorToast("Couldn't save the mind map", err));
  }, [path]);

  useEffect(() => () => flush(), [flush]);

  const changed = useCallback(() => {
    setRev((r) => r + 1);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 250);
  }, [flush]);

  const nodes = useMemo(() => (root.current ? layoutMindmap(root.current, { colGap: COL, rowGap: ROW, collapsed }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rev, collapsed]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.node.id, n])), [nodes]);

  const fit = useCallback(() => {
    const el = surface.current;
    if (!el || !nodes.length) return;
    const minY = Math.min(...nodes.map((n) => n.y)) - H;
    const maxY = Math.max(...nodes.map((n) => n.y)) + H;
    const maxX = Math.max(...nodes.map((n) => n.x + nodeWidth(n.node.text, n.depth)));
    const w = el.clientWidth;
    const h = el.clientHeight;
    const k = Math.max(0.3, Math.min(1.25, (w - 80) / Math.max(1, maxX), (h - 80) / Math.max(1, maxY - minY)));
    setView({ k, x: (w - maxX * k) / 2, y: (h - (maxY + minY) * k) / 2 });
  }, [nodes]);

  useLayoutEffect(() => {
    if (!fitted.current && nodes.length) {
      fitted.current = true;
      fit();
    }
  }, [nodes, fit]);

  useEffect(() => {
    if (focus && !editing) surface.current?.focus({ preventScroll: true });
  }, [focus, editing]);

  // Keep the selected branch on screen as the map grows.
  useEffect(() => {
    const el = surface.current;
    const n = selected ? byId.get(selected) : undefined;
    if (!el || !n || !fitted.current) return;
    const pad = 48;
    const w = nodeWidth(n.node.text || 'New branch', n.depth) + 60;
    setView((v) => {
      const left = v.x + n.x * v.k;
      const right = v.x + (n.x + w) * v.k;
      const top = v.y + (n.y - H) * v.k;
      const bottom = v.y + (n.y + H) * v.k;
      let { x, y } = v;
      if (right > el.clientWidth - pad) x -= right - (el.clientWidth - pad);
      if (left + (x - v.x) < pad) x += pad - (left + (x - v.x));
      if (bottom > el.clientHeight - pad) y -= bottom - (el.clientHeight - pad);
      if (top < pad) y += pad - top;
      return x === v.x && y === v.y ? v : { ...v, x, y };
    });
  }, [selected, byId]);

  // ---------- editing ----------

  const startEdit = (id: string, value?: string) => {
    const f = root.current && findNode(root.current, id);
    if (f) setEditing({ id, value: value ?? f.node.text });
  };

  const commitEdit = (keepFocus = true) => {
    if (!editing || !root.current) return;
    const f = findNode(root.current, editing.id);
    const value = editing.value.replace(/\s+/g, ' ').trim();
    setEditing(null);
    if (f && value && value !== f.node.text) {
      f.node.text = value;
      changed();
    } else if (f && !value && f.parent && !f.node.children.length) {
      // An empty new branch is dropped rather than saved as a blank bullet.
      f.parent.children.splice(f.index, 1);
      setSelected(f.parent.id);
      changed();
    }
    if (keepFocus) surface.current?.focus({ preventScroll: true });
  };

  const add = (kind: 'child' | 'sibling') => {
    if (!root.current || !selected) return;
    const f = findNode(root.current, selected);
    if (!f) return;
    const n = mindNode('');
    if (kind === 'child' || !f.parent) {
      f.node.children.push(n);
      if (collapsed.has(f.node.id)) setCollapsed((c) => new Set([...c].filter((x) => x !== f.node.id)));
    } else f.parent.children.splice(f.index + 1, 0, n);
    setSelected(n.id);
    setEditing({ id: n.id, value: '' });
    setRev((r) => r + 1);
  };

  const remove = () => {
    if (!root.current || !selected) return;
    const f = findNode(root.current, selected);
    if (!f?.parent) return;
    f.parent.children.splice(f.index, 1);
    setSelected((f.parent.children[f.index] ?? f.parent.children[f.index - 1] ?? f.parent).id);
    changed();
  };

  const toggle = (id: string) => {
    const f = root.current && findNode(root.current, id);
    if (!f?.node.children.length) return;
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const move = (key: string) => {
    const cur = selected ? byId.get(selected) : undefined;
    if (!cur) return setSelected(root.current?.id ?? null);
    if (key === 'ArrowLeft' && cur.parent) return setSelected(cur.parent);
    if (key === 'ArrowRight') {
      if (collapsed.has(cur.node.id)) toggle(cur.node.id);
      const first = cur.node.children[0];
      if (first) setSelected(first.id);
      return;
    }
    const same = nodes.filter((n) => n.depth === cur.depth).sort((a, b) => a.y - b.y);
    const i = same.indexOf(cur);
    const next = key === 'ArrowUp' ? same[i - 1] : same[i + 1];
    if (next) setSelected(next.node.id);
  };

  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    // Keys the map uses must not also reach the app's hotkeys (F2 renames the note, for one).
    if (!mod || e.key === '0') e.stopPropagation();
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      add('child');
    } else if (e.key === 'Enter' && !mod) {
      e.preventDefault();
      add('sibling');
    } else if (e.key === 'F2') {
      e.preventDefault();
      if (selected) startEdit(selected);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove();
    } else if (e.key === ' ') {
      e.preventDefault();
      if (selected) toggle(selected);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      move(e.key);
    } else if (mod && e.key === '0') {
      e.preventDefault();
      fit();
    } else if (e.key.length === 1 && !mod && !e.altKey && selected) {
      // Typing on a selected node starts renaming it with that character.
      e.preventDefault();
      startEdit(selected, e.key);
    }
  };

  // ---------- pan and zoom ----------

  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.mm-node, .mm-tools')) return;
    if (editing) commitEdit(false);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        setView((v) => {
          const k = Math.max(0.25, Math.min(2.5, v.k * Math.exp(-e.deltaY * 0.0025)));
          return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (f: number) => {
    const el = surface.current;
    if (!el) return;
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    setView((v) => {
      const k = Math.max(0.25, Math.min(2.5, v.k * f));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };

  // ---------- render ----------

  const width = (id: string) => {
    const n = byId.get(id);
    if (!n) return 0;
    return editing?.id === id ? Math.max(nodeWidth(editing.value || 'New branch', n.depth), 120) : nodeWidth(n.node.text, n.depth);
  };

  return (
    <div className="mindmap-view">
      <div
        ref={surface}
        className="mm-surface"
        tabIndex={0}
        role="tree"
        aria-label={`Mind map: ${title}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="mm-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="mm-links" width="1" height="1" aria-hidden>
            {nodes.map((n) => {
              if (!n.parent) return null;
              const p = byId.get(n.parent);
              if (!p) return null;
              const x1 = p.x + width(p.node.id);
              const x2 = n.x;
              const mx = (x1 + x2) / 2;
              return <path key={n.node.id} className={`mm-edge depth-${Math.min(n.depth, 4)}`} d={`M${x1},${p.y} C${mx},${p.y} ${mx},${n.y} ${x2},${n.y}`} />;
            })}
          </svg>
          {nodes.map((n) => {
            const id = n.node.id;
            const isEditing = editing?.id === id;
            const hidden = collapsed.has(id) ? n.node.children.length : 0;
            return (
              <div
                key={id}
                role="treeitem"
                aria-level={n.depth + 1}
                aria-selected={selected === id}
                aria-expanded={n.node.children.length ? !hidden : undefined}
                data-node={id}
                title={n.node.text}
                className={`mm-node depth-${Math.min(n.depth, 4)}${selected === id ? ' selected' : ''}`}
                style={{ left: n.x, top: n.y - H / 2, width: width(id), height: H }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (editing && editing.id !== id) commitEdit(false);
                  setSelected(id);
                }}
                onDoubleClick={() => startEdit(id)}
              >
                {isEditing ? (
                  <input
                    className="mm-input"
                    aria-label="Branch text"
                    autoFocus
                    placeholder="New branch"
                    value={editing.value}
                    onChange={(e) => setEditing({ id, value: e.target.value })}
                    onBlur={() => commitEdit(false)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitEdit();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        if (!editing.value && !n.node.text) commitEdit();
                        else {
                          setEditing(null);
                          surface.current?.focus({ preventScroll: true });
                        }
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        commitEdit();
                        setTimeout(() => add('child'), 0);
                      }
                    }}
                  />
                ) : (
                  <NodeText text={n.node.text || ' '} source={path} />
                )}
                {hidden ? (
                  <button className="mm-more" aria-label={`Show ${hidden} hidden branches`} onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle(id)}>
                    {hidden}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mm-tools">
          <Button size="sm" variant="quiet" onClick={() => add('child')} disabled={!selected}>
            Add branch
          </Button>
          <Button size="sm" variant="quiet" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            −
          </Button>
          <Button size="sm" variant="quiet" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
            +
          </Button>
          <Button size="sm" variant="quiet" onClick={fit}>
            Fit
          </Button>
        </div>
        <p className="mm-hint">Tab adds a branch · Enter adds a sibling · type or F2 to rename · Space folds · ⌫ deletes</p>
      </div>
    </div>
  );
}
