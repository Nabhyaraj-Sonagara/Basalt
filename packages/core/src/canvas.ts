// JSON Canvas 1.0 (https://jsoncanvas.org, MIT). Unknown fields are preserved on round-trip.

export type CanvasColor = string; // "1"–"6" preset or "#rrggbb"
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';

interface NodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
  [extra: string]: unknown;
}

export interface TextNode extends NodeBase { type: 'text'; text: string }
export interface FileNode extends NodeBase { type: 'file'; file: string; subpath?: string }
export interface LinkNode extends NodeBase { type: 'link'; url: string }
export interface GroupNode extends NodeBase { type: 'group'; label?: string; background?: string; backgroundStyle?: 'cover' | 'ratio' | 'repeat' }
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: 'none' | 'arrow';
  toEnd?: 'none' | 'arrow';
  color?: CanvasColor;
  label?: string;
  [extra: string]: unknown;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [extra: string]: unknown;
}

export class CanvasError extends Error {}

export function parseCanvas(json: string): CanvasData {
  if (!json.trim()) return { nodes: [], edges: [] };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new CanvasError(`Canvas file is not valid JSON: ${(e as Error).message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CanvasError('Canvas must be a JSON object');
  const obj = data as CanvasData;
  const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const edges = Array.isArray(obj.edges) ? obj.edges : [];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (typeof n.id !== 'string' || !['text', 'file', 'link', 'group'].includes(n.type)) throw new CanvasError(`Invalid canvas node: ${JSON.stringify(n).slice(0, 80)}`);
    for (const k of ['x', 'y', 'width', 'height'] as const) if (typeof n[k] !== 'number') throw new CanvasError(`Canvas node ${n.id} is missing ${k}`);
    ids.add(n.id);
  }
  const validEdges = edges.filter((e) => typeof e.id === 'string' && ids.has(e.fromNode) && ids.has(e.toNode));
  return { ...obj, nodes, edges: validEdges };
}

export function serializeCanvas(c: CanvasData): string {
  return JSON.stringify({ ...c, nodes: c.nodes, edges: c.edges }, null, '\t');
}

export function canvasId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Files referenced by a canvas (for backlinks and rename updates). */
export function canvasFileRefs(c: CanvasData): string[] {
  return c.nodes.filter((n): n is FileNode => n.type === 'file').map((n) => n.file);
}

/** Maps preset colours onto Basalt tokens. There is no purple in Basalt: preset 6 becomes stone. */
export const CANVAS_PRESETS: Record<string, string> = {
  '1': 'var(--ember)',
  '2': 'var(--honey)',
  '3': 'var(--pollen)',
  '4': 'var(--moss)',
  '5': 'var(--sky)',
  '6': 'var(--stone-light)',
};
