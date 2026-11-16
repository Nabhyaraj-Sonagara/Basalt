import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Button, EmptyState } from '@basalt/ui';
import { CANVAS_PRESETS, canvasId, parseCanvas, serializeCanvas, type CanvasData, type CanvasEdge, type CanvasNode, type CanvasSide } from '@basalt/core/browser';
import { api, errorToast, openPath } from '../lib/actions';
import { renderNoteHtml, hydrate } from '../lib/render';
import { getState, setState } from '../lib/store';

function anchor(n: CanvasNode, side: CanvasSide | undefined, other: CanvasNode): [number, number] {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const s = side ?? (Math.abs(other.x - n.x) > Math.abs(other.y - n.y) ? (other.x > n.x ? 'right' : 'left') : other.y > n.y ? 'bottom' : 'top');
  return s === 'top' ? [cx, n.y] : s === 'bottom' ? [cx, n.y + n.height] : s === 'left' ? [n.x, cy] : [n.x + n.width, cy];
}

function color(c?: string): string | undefined {
  if (!c) return undefined;
  return CANVAS_PRESETS[c] ?? c;
}

function NodeBody({ node, onText }: { node: CanvasNode; onText: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!ref.current || editing) return;
    if (node.type === 'text') {
      ref.current.innerHTML = renderNoteHtml(node.text, '');
      void hydrate(ref.current, '');
    } else if (node.type === 'file') {
      const path = node.file;
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) ref.current.innerHTML = `<img src="${window.basalt.hive.fileUrl(path)}" alt="">`;
      else
        void api()
          .hive.readSubpath(path, node.subpath)
          .then((t) => {
            if (ref.current) {
              ref.current.innerHTML = renderNoteHtml(t, path);
              void hydrate(ref.current, path);
            }
          })
          .catch(() => ref.current && (ref.current.textContent = `${path} is missing`));
    }
  }, [node, editing]);
  if (node.type === 'text' && editing) {
    return (
      <textarea
        className="canvas-text-edit"
        autoFocus
        defaultValue={node.text}
        onBlur={(e) => {
          setEditing(false);
          onText(e.target.value);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }
  if (node.type === 'link') return <div className="canvas-link">{node.url}</div>;
  if (node.type === 'group') return null;
  return <div ref={ref} className="canvas-node-body prose" onDoubleClick={() => node.type === 'text' && setEditing(true)} />;
}

/** A JSON Canvas board: cards for text, notes, links and groups, joined by edges. */
export function CanvasView({ path }: { path: string }) {
  const [data, setData] = useState<CanvasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const drag = useRef<{ kind: 'pan' | 'move' | 'resize'; id?: string; sx: number; sy: number; ox: number; oy: number; ow?: number; oh?: number } | null>(null);

  useEffect(() => {
    void api()
      .hive.read(path)
      .then((t) => {
        try {
          setData(parseCanvas(t));
          setError(null);
        } catch (e) {
          setError((e as Error).message);
        }
      });
  }, [path]);

  // Reload when the file changes elsewhere (an agent, another pane, "Add note").
  useEffect(
    () =>
      api().hive.onChange((changes) => {
        if (saveTimer.current || !changes.some((c) => c.path === path && c.type === 'modify')) return;
        void api()
          .hive.read(path)
          .then((t) => {
            try {
              setData(parseCanvas(t));
            } catch {
              /* keep the current board */
            }
          });
      }),
    [path],
  );

  const commit = (next: CanvasData) => {
    setData(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void api().hive.write(path, serializeCanvas(next)).catch((e) => errorToast("Couldn't save the canvas", e));
    }, 300);
  };

  if (error) return <EmptyState title="This canvas can't be read" icon="warning">{error}</EmptyState>;
  if (!data) return null;

  const toWorld = (cx: number, cy: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return [(cx - r.left - view.x) / view.k, (cy - r.top - view.y) / view.k];
  };

  const addText = (x: number, y: number, text = '') => {
    const node: CanvasNode = { id: canvasId(), type: 'text', text: text || 'New card', x: Math.round(x), y: Math.round(y), width: 260, height: 140 };
    commit({ ...data, nodes: [...data.nodes, node] });
    setSelected(node.id);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const nodeEl = target.closest<HTMLElement>('[data-node]');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (nodeEl) {
      const id = nodeEl.dataset.node!;
      if (linkFrom && linkFrom !== id) {
        const edge: CanvasEdge = { id: canvasId(), fromNode: linkFrom, toNode: id, toEnd: 'arrow' };
        commit({ ...data, edges: [...data.edges, edge] });
        setLinkFrom(null);
        return;
      }
      setSelected(id);
      const n = data.nodes.find((x) => x.id === id)!;
      drag.current = { kind: target.classList.contains('canvas-resize') ? 'resize' : 'move', id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, ow: n.width, oh: n.height };
    } else {
      setSelected(null);
      setLinkFrom(null);
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else {
      setData((cur) =>
        cur && {
          ...cur,
          nodes: cur.nodes.map((n) =>
            n.id !== d.id
              ? n
              : d.kind === 'move'
                ? { ...n, x: Math.round(d.ox + dx / view.k), y: Math.round(d.oy + dy / view.k) }
                : { ...n, width: Math.max(120, Math.round(d.ow! + dx / view.k)), height: Math.max(60, Math.round(d.oh! + dy / view.k)) },
          ),
        },
      );
    }
  };

  const onPointerUp = () => {
    if (drag.current && drag.current.kind !== 'pan' && data) commit(data);
    drag.current = null;
  };

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const sel = selected ? byId.get(selected) : undefined;

  return (
    <div className="canvas-view">
      <div className="view-toolbar">
        <Button size="sm" variant="secondary" icon="new-note" onClick={() => addText((-view.x + 120) / view.k, (-view.y + 120) / view.k)}>
          Add card
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon="note"
          onClick={() => setState({ palette: { mode: 'files', query: '', payload: `canvas:${path}` } })}
        >
          Add note
        </Button>
        <Button size="sm" variant={linkFrom ? 'primary' : 'quiet'} icon="wikilink" disabled={!sel} onClick={() => setLinkFrom(sel?.id ?? null)}>
          {linkFrom ? 'Pick a card to connect' : 'Connect'}
        </Button>
        {sel ? (
          <>
            <span className="canvas-colors" role="group" aria-label="Card colour">
              {['', '1', '2', '3', '4', '5', '6'].map((c) => (
                <button key={c || 'none'} aria-label={c ? `Colour ${c}` : 'No colour'} className="canvas-swatch" style={{ background: color(c) ?? 'var(--surface-raised)' }} onClick={() => commit({ ...data, nodes: data.nodes.map((n) => (n.id === sel.id ? { ...n, color: c || undefined } : n)) })} />
              ))}
            </span>
            {sel.type === 'file' ? (
              <Button size="sm" variant="quiet" onClick={() => openPath((sel as { file: string }).file, { newTab: true })}>
                Open note
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                commit({ ...data, nodes: data.nodes.filter((n) => n.id !== sel.id), edges: data.edges.filter((ed) => ed.fromNode !== sel.id && ed.toNode !== sel.id) });
                setSelected(null);
              }}
            >
              Remove
            </Button>
          </>
        ) : null}
        <span className="spacer" />
        <span className="muted">{Math.round(view.k * 100)}%</span>
      </div>
      <div
        className="canvas-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-node]')) return;
          const [x, y] = toWorld(e.clientX, e.clientY, e.currentTarget);
          addText(x - 130, y - 70);
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            const r = e.currentTarget.getBoundingClientRect();
            const k = Math.min(2.5, Math.max(0.2, view.k * (e.deltaY > 0 ? 0.9 : 1.1)));
            const mx = e.clientX - r.left;
            const my = e.clientY - r.top;
            setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
          } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const p = e.dataTransfer.getData('text/x-basalt-path');
          if (!p) return;
          e.preventDefault();
          const [x, y] = toWorld(e.clientX, e.clientY, e.currentTarget);
          commit({ ...data, nodes: [...data.nodes, { id: canvasId(), type: 'file', file: p, x: Math.round(x), y: Math.round(y), width: 320, height: 220 }] });
        }}
      >
        <div className="canvas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="canvas-edges" width="1" height="1">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-muted)" />
              </marker>
            </defs>
            {data.edges.map((ed) => {
              const a = byId.get(ed.fromNode);
              const b = byId.get(ed.toNode);
              if (!a || !b) return null;
              const [x1, y1] = anchor(a, ed.fromSide, b);
              const [x2, y2] = anchor(b, ed.toSide, a);
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              return (
                <g key={ed.id}>
                  <path
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    stroke={color(ed.color) ?? 'var(--line-strong)'}
                    strokeWidth={2}
                    fill="none"
                    markerEnd={ed.toEnd === 'none' ? undefined : 'url(#arrow)'}
                    markerStart={ed.fromEnd === 'arrow' ? 'url(#arrow)' : undefined}
                  />
                  {ed.label ? (
                    <text x={mx} y={my - 6} className="canvas-edge-label" textAnchor="middle">
                      {ed.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {data.nodes.map((n) => (
            <div
              key={n.id}
              data-node={n.id}
              className={`canvas-node canvas-${n.type}${selected === n.id ? ' selected' : ''}${linkFrom === n.id ? ' linking' : ''}`}
              style={{ left: n.x, top: n.y, width: n.width, height: n.height, borderColor: color(n.color) }}
            >
              {n.type === 'group' ? <div className="canvas-group-label">{n.label ?? 'Group'}</div> : null}
              {n.type === 'file' ? (
                <div className="canvas-file-head" onDoubleClick={() => openPath(n.file, { newTab: true })}>
                  {getState().notesByPath.get(n.file)?.title ?? n.file}
                </div>
              ) : null}
              <NodeBody node={n} onText={(text) => commit({ ...data, nodes: data.nodes.map((x) => (x.id === n.id ? { ...x, text } : x)) })} />
              <span className="canvas-resize" aria-hidden />
            </div>
          ))}
        </div>
        {!data.nodes.length ? (
          <div className="canvas-empty">
            <EmptyState compact icon="comb" title="An empty canvas">
              Double-click to add a card, or drag notes in from the sidebar.
            </EmptyState>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Adds a note card to a canvas (used by the quick switcher's "Add note" mode). */
export async function addNoteToCanvas(canvasPath: string, notePath: string): Promise<void> {
  const data = parseCanvas(await api().hive.read(canvasPath));
  const maxX = data.nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  data.nodes.push({ id: canvasId(), type: 'file', file: notePath, x: maxX + 40, y: 0, width: 320, height: 220 });
  await api().hive.write(canvasPath, serializeCanvas(data));
}
