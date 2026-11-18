// A hive's picture: a small cluster of basalt columns generated from the hive's name, so every
// hive gets its own recognisable crest. A hive can override it with an emoji and a colour
// (.basalt/appearance.json: { "icon": "📚", "color": "#3f7fb3" }).

/** FNV-1a, then a small PRNG (mulberry32) so the same name always draws the same crest. */
function rng(seed: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Background tints a crest can sit on (used when the hive has no colour of its own). */
const TINTS = ['#e8a317', '#5f8a4c', '#3f7fb3', '#c8553d', '#8a5fb3', '#5d6b78', '#b08d57', '#2f8f87'];

interface Column {
  cx: number;
  w: number;
  top: number;
  base: number;
  honey: boolean;
}

function columns(name: string): { tint: string; cols: Column[] } {
  const r = rng(name.trim().toLowerCase() || 'hive');
  const tint = TINTS[Math.floor(r() * TINTS.length)];
  const back = 2 + Math.floor(r() * 2); // 2-3 tall columns behind
  const front = 1 + Math.floor(r() * 2); // 1-2 shorter in front
  const cols: Column[] = [];
  const place = (n: number, base: number, minH: number, maxH: number, w: number) => {
    const span = 64 - 2 * 16;
    for (let i = 0; i < n; i++) {
      const cx = 16 + (n === 1 ? span / 2 : (span * i) / (n - 1)) + (r() - 0.5) * 6;
      const h = minH + r() * (maxH - minH);
      cols.push({ cx, w, top: base - h, base, honey: false });
    }
  };
  place(back, 46, 20, 32, 15);
  place(front, 54, 10, 20, 15);
  cols[Math.floor(r() * cols.length)].honey = true;
  return { tint, cols };
}

function prism(c: Column, key: number) {
  const { cx, w, top, base } = c;
  const q = w / 4;
  const d = w * 0.2; // depth of the top face
  const L = cx - w / 2;
  const R = cx + w / 2;
  const pts = (p: number[][]) => p.map((x) => x.join(',')).join(' ');
  return (
    <g key={key}>
      <polygon points={pts([[L, top], [cx - q, top + d], [cx - q, base + d], [L, base]])} fill="#6b6259" />
      <polygon points={pts([[cx - q, top + d], [cx + q, top + d], [cx + q, base + d], [cx - q, base + d]])} fill="#48423b" />
      <polygon points={pts([[cx + q, top + d], [R, top], [R, base], [cx + q, base + d]])} fill="#34302b" />
      <polygon points={pts([[L, top], [cx - q, top - d], [cx + q, top - d], [R, top], [cx + q, top + d], [cx - q, top + d]])} fill={c.honey ? '#f2b63a' : '#9a9083'} />
      {c.honey ? <polygon points={pts([[cx - q * 0.9, top], [cx - q / 2, top - d / 2], [cx + q / 2, top - d / 2], [cx + q * 0.9, top], [cx + q / 2, top + d / 2], [cx - q / 2, top + d / 2]])} fill="#ffd77a" /> : null}
    </g>
  );
}

export function HiveCrest({ name, size = 32, icon, color }: { name: string; size?: number; icon?: string; color?: string }) {
  const { tint, cols } = columns(name);
  const bg = color && /^#[0-9a-f]{6}$/i.test(color) ? color : tint;
  const hex = '32,2 60,18 60,46 32,62 4,46 4,18';
  const id = `crest-${Math.abs([...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7))}`;
  return (
    <svg className="hive-crest" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${name} hive`}>
      <defs>
        <clipPath id={id}>
          <polygon points={hex} />
        </clipPath>
      </defs>
      <polygon points={hex} fill={bg} opacity={0.28} />
      <polygon points={hex} fill="none" stroke={bg} strokeWidth={2.5} strokeLinejoin="round" />
      {icon ? (
        <text x="32" y="33" textAnchor="middle" dominantBaseline="central" fontSize="30">
          {icon}
        </text>
      ) : (
        <g clipPath={`url(#${id})`}>{[...cols].sort((a, b) => a.base - b.base).map(prism)}</g>
      )}
    </svg>
  );
}
