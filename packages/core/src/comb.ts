// Lays a link graph out on a flat-top hex grid (axial q, r) for the Comb view.
import type { Graph } from './types';

export interface CombPlacement {
  id: string;
  q: number;
  r: number;
  /** 0–3: visual weight. 3 is reserved for the focused note. */
  weight: 0 | 1 | 2 | 3;
  /** Link distance from the focus note (local comb), or 0 in the global comb. */
  ring: number;
}

const DIRS: [number, number][] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

/** Cells at exactly `radius` steps from (q, r), in a stable clockwise order. */
export function hexRing(q: number, r: number, radius: number): [number, number][] {
  if (radius === 0) return [[q, r]];
  const out: [number, number][] = [];
  let cq = q + DIRS[4][0] * radius;
  let cr = r + DIRS[4][1] * radius;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push([cq, cr]);
      cq += DIRS[side][0];
      cr += DIRS[side][1];
    }
  }
  return out;
}

export function hexDistance(a: [number, number], b: [number, number]): number {
  const dq = a[0] - b[0];
  const dr = a[1] - b[1];
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function weightFor(degree: number, maxDegree: number): 0 | 1 | 2 {
  if (maxDegree <= 0 || degree === 0) return 0;
  const f = degree / maxDegree;
  return f > 0.5 ? 2 : f > 0.15 || degree >= 3 ? 1 : 0;
}

function adjacency(g: Graph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of g.nodes) adj.set(n.id, new Set());
  for (const e of g.edges) {
    if (e.from === e.to) continue;
    adj.get(e.from)?.add(e.to);
    adj.get(e.to)?.add(e.from);
  }
  return adj;
}

/**
 * Local comb: the focus note sits in the centre; notes one link away fill the first ring(s),
 * two links away the next, up to `depth`.
 */
export function layoutLocalComb(g: Graph, focus: string, depth = 2, maxCells = 61): CombPlacement[] {
  const adj = adjacency(g);
  if (!adj.has(focus)) return [];
  const degree = new Map(g.nodes.map((n) => [n.id, adj.get(n.id)?.size ?? 0]));
  const maxDeg = Math.max(1, ...degree.values());
  const dist = new Map<string, number>([[focus, 0]]);
  let frontier = [focus];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!dist.has(nb)) { dist.set(nb, d); next.push(nb); }
    frontier = next;
  }
  const ordered = [...dist.entries()]
    .filter(([id]) => id !== focus)
    .sort((a, b) => a[1] - b[1] || (degree.get(b[0]) ?? 0) - (degree.get(a[0]) ?? 0) || a[0].localeCompare(b[0]));
  const out: CombPlacement[] = [{ id: focus, q: 0, r: 0, weight: 3, ring: 0 }];
  let radius = 1;
  let cells = hexRing(0, 0, 1);
  let ci = 0;
  let prevDist = 1;
  for (const [id, d] of ordered) {
    if (out.length >= maxCells) break;
    // Start a fresh ring when the link distance increases, so distance reads as rings.
    if (d > prevDist && ci > 0) {
      radius++;
      cells = hexRing(0, 0, radius);
      ci = 0;
    }
    prevDist = d;
    if (ci >= cells.length) {
      radius++;
      cells = hexRing(0, 0, radius);
      ci = 0;
    }
    const [q, r] = cells[ci++];
    out.push({ id, q, r, weight: weightFor(degree.get(id) ?? 0, maxDeg), ring: d });
  }
  return out;
}

/**
 * Global comb: hubs first at the centre; each later note takes the free cell nearest
 * to an already-placed neighbour, so linked notes cluster into combs.
 */
export function layoutGlobalComb(g: Graph, focus?: string): CombPlacement[] {
  const adj = adjacency(g);
  const degree = new Map(g.nodes.map((n) => [n.id, adj.get(n.id)?.size ?? 0]));
  const maxDeg = Math.max(1, ...degree.values());
  const order = [...g.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const taken = new Set<string>();
  const pos = new Map<string, [number, number]>();
  const key = (q: number, r: number) => `${q},${r}`;

  const nearestFree = (q: number, r: number): [number, number] => {
    for (let rad = 0; rad < 10000; rad++) {
      for (const c of hexRing(q, r, rad)) if (!taken.has(key(c[0], c[1]))) return c;
    }
    return [q, r];
  };

  // BFS from hubs keeps clusters together.
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const n of order) {
    if (seen.has(n.id)) continue;
    queue.push(n.id);
    seen.add(n.id);
    while (queue.length) {
      const id = queue.shift()!;
      const placedNb = [...(adj.get(id) ?? [])].map((nb) => pos.get(nb)).filter(Boolean) as [number, number][];
      let anchor: [number, number] = [0, 0];
      if (placedNb.length) {
        anchor = [Math.round(placedNb.reduce((s, p) => s + p[0], 0) / placedNb.length), Math.round(placedNb.reduce((s, p) => s + p[1], 0) / placedNb.length)];
      } else if (pos.size) {
        // A new component: start it just outside what is already placed.
        const radius = Math.max(...[...pos.values()].map((p) => hexDistance(p, [0, 0]))) + 2;
        anchor = hexRing(0, 0, radius)[(pos.size * 7) % (6 * radius)];
      }
      const cell = nearestFree(anchor[0], anchor[1]);
      taken.add(key(cell[0], cell[1]));
      pos.set(id, cell);
      const nbs = [...(adj.get(id) ?? [])].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));
      for (const nb of nbs) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
  }
  return order.map((n) => {
    const [q, r] = pos.get(n.id)!;
    return { id: n.id, q, r, ring: 0, weight: n.id === focus ? 3 : weightFor(degree.get(n.id) ?? 0, maxDeg) };
  });
}
