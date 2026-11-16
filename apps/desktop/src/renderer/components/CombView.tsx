import { useEffect, useMemo, useState } from 'react';
import { Comb, SearchField, Button, EmptyState, Select } from '@basalt/ui';
import { layoutGlobalComb, layoutLocalComb, type Graph } from '@basalt/core/browser';
import { api, createNote, openPath } from '../lib/actions';
import { useStore } from '../lib/store';

function useGraph(): Graph | null {
  const version = useStore((s) => s.version);
  const [graph, setGraph] = useState<Graph | null>(null);
  useEffect(() => {
    let live = true;
    void api().hive.graph().then((g) => live && setGraph(g));
    return () => {
      live = false;
    };
  }, [version]);
  return graph;
}

function short(title: string, n = 9): string {
  return title.length > n ? title.slice(0, n - 1).trimEnd() + '…' : title;
}

async function openNode(id: string, newTab: boolean) {
  if (id.startsWith('unresolved:')) {
    const p = await createNote(id.slice('unresolved:'.length));
    if (p) openPath(p, { newTab });
  } else openPath(id, { newTab });
}

/** The local comb: the open note in the centre, linked notes in rings around it. */
export function LocalComb({ path }: { path: string | null }) {
  const graph = useGraph();
  const [depth, setDepth] = useState(1);
  const cells = useMemo(() => {
    if (!graph || !path) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return layoutLocalComb(graph, path, depth, 37).map((c) => {
      const n = byId.get(c.id)!;
      return { q: c.q, r: c.r, weight: c.weight, label: short(n.title, 8), title: `${n.title}${n.resolved ? '' : ' (not written yet)'}`, active: c.id === path, onClick: () => void openNode(c.id, false) };
    });
  }, [graph, path, depth]);
  if (!path) return <EmptyState compact icon="comb" title="No note open">Open a note to see its comb.</EmptyState>;
  if (cells.length <= 1)
    return (
      <EmptyState compact icon="comb" title="Nothing in this cell yet">
        Link this note to another with [[ ]] and it joins the comb.
      </EmptyState>
    );
  return (
    <div className="local-comb">
      <Comb cells={cells} cellSize={26} label="Comb of linked notes" />
      <div className="local-comb-foot">
        <span>{cells.length - 1} linked</span>
        <Select aria-label="Link depth" value={String(depth)} options={[{ value: '1', label: 'Direct links' }, { value: '2', label: 'Two steps' }]} onChange={(e) => setDepth(Number(e.target.value))} />
      </div>
    </div>
  );
}

/** The global comb: every note, clustered by links. */
export function GlobalComb() {
  const graph = useGraph();
  const focus = useStore((s) => {
    const p = s.panes.flatMap((x) => x.tabs).find((t) => t.kind === 'note')?.path;
    return p ?? null;
  });
  const [filter, setFilter] = useState('');
  const [size, setSize] = useState(34);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const cells = useMemo(() => {
    if (!graph) return [];
    const f = filter.trim().toLowerCase().replace(/^#/, '');
    const keep = new Set(
      graph.nodes
        .filter((n) => (showUnresolved || n.resolved) && (!f || n.id.toLowerCase().includes(f) || n.title.toLowerCase().includes(f) || n.tags.some((t) => t.toLowerCase().startsWith(f))))
        .map((n) => n.id),
    );
    const sub = { nodes: graph.nodes.filter((n) => keep.has(n.id)), edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
    const byId = new Map(sub.nodes.map((n) => [n.id, n]));
    return layoutGlobalComb(sub, focus ?? undefined).map((c) => {
      const n = byId.get(c.id)!;
      return { q: c.q, r: c.r, weight: c.weight, label: short(n.title, size > 40 ? 11 : 9), title: n.title, active: c.id === focus, onClick: () => void openNode(c.id, false) };
    });
  }, [graph, filter, focus, showUnresolved, size]);
  return (
    <div className="global-comb">
      <div className="view-toolbar">
        <SearchField placeholder="Filter by name, folder or #tag" value={filter} onChange={(e) => setFilter(e.target.value)} shortcut={null} />
        <label className="check">
          <input type="checkbox" checked={showUnresolved} onChange={(e) => setShowUnresolved(e.target.checked)} /> Notes not written yet
        </label>
        <span className="spacer" />
        <Button size="sm" variant="quiet" aria-label="Smaller cells" onClick={() => setSize((s) => Math.max(20, s - 6))}>
          −
        </Button>
        <Button size="sm" variant="quiet" aria-label="Larger cells" onClick={() => setSize((s) => Math.min(64, s + 6))}>
          +
        </Button>
      </div>
      <div className="global-comb-canvas">
        {cells.length ? (
          <Comb cells={cells} cellSize={size} label="Comb of every note in the hive" />
        ) : (
          <EmptyState title="Nothing in this cell yet" icon="comb" pattern>
            {filter ? 'No notes match that filter.' : 'Write a few notes and link them with [[ ]] to build your comb.'}
          </EmptyState>
        )}
      </div>
      <div className="comb-legend">
        <span>
          <i className="lg lg-active" /> Open note
        </span>
        <span>
          <i className="lg lg-w2" /> Well linked
        </span>
        <span>
          <i className="lg lg-w1" /> Linked
        </span>
        <span>
          <i className="lg lg-w0" /> On its own
        </span>
        <span className="spacer" />
        <span>{cells.length} notes</span>
      </div>
    </div>
  );
}
