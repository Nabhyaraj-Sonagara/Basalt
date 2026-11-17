// How Basalt looks on this device: accent colour, fonts, sizes, density, the sidebar toolbar
// and which panels show. Stored per device (localStorage); a hive's own icon and colour live
// in the hive (.basalt/appearance.json). Themes export to and import from a .basalt-theme.json file.
import { useSyncExternalStore } from 'react';

export type Density = 'compact' | 'comfortable';
export type LineWidth = 'narrow' | 'normal' | 'wide' | 'full';

export interface Appearance {
  /** Accent colour (hex); null keeps the theme's honey. */
  accent: string | null;
  uiFont: 'hanken' | 'system';
  editorFont: 'literata' | 'hanken' | 'system' | 'mono';
  editorSize: number;
  lineWidth: LineWidth;
  density: Density;
  iconSize: 16 | 20 | 24;
  /** Sidebar toolbar buttons, in order. Ids from TOOLBAR_ITEMS. */
  toolbar: string[];
  /** Right-panel tabs that are hidden. */
  hiddenPanels: string[];
  /** Left-sidebar tabs that are hidden. */
  hiddenViews: string[];
  statusBar: boolean;
}

export const DEFAULT_TOOLBAR = ['new-note', 'new-folder', 'daily', 'comb', 'palette', 'search'];

export const DEFAULT_APPEARANCE: Appearance = {
  accent: null,
  uiFont: 'hanken',
  editorFont: 'literata',
  editorSize: 17,
  lineWidth: 'normal',
  density: 'comfortable',
  iconSize: 20,
  toolbar: DEFAULT_TOOLBAR,
  hiddenPanels: [],
  hiddenViews: [],
  statusBar: true,
};

export const ACCENTS: { name: string; hex: string | null }[] = [
  { name: 'Honey', hex: null },
  { name: 'Moss', hex: '#5f8a4c' },
  { name: 'Sky', hex: '#3f7fb3' },
  { name: 'Ember', hex: '#c8553d' },
  { name: 'Heather', hex: '#8a5fb3' },
  { name: 'Slate', hex: '#5d6b78' },
];

const KEY = 'basalt.appearance';
const listeners = new Set<() => void>();
let current: Appearance = load();

function load(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return sanitize(raw);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Accepts anything (an imported file, old settings) and returns a valid Appearance. */
export function sanitize(input: unknown): Appearance {
  const o = (input && typeof input === 'object' ? input : {}) as Partial<Appearance>;
  const d = DEFAULT_APPEARANCE;
  const oneOf = <T,>(v: unknown, opts: readonly T[], def: T): T => (opts.includes(v as T) ? (v as T) : def);
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : null);
  return {
    accent: typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : null,
    uiFont: oneOf(o.uiFont, ['hanken', 'system'] as const, d.uiFont),
    editorFont: oneOf(o.editorFont, ['literata', 'hanken', 'system', 'mono'] as const, d.editorFont),
    editorSize: typeof o.editorSize === 'number' ? Math.min(24, Math.max(13, Math.round(o.editorSize))) : d.editorSize,
    lineWidth: oneOf(o.lineWidth, ['narrow', 'normal', 'wide', 'full'] as const, d.lineWidth),
    density: oneOf(o.density, ['compact', 'comfortable'] as const, d.density),
    iconSize: oneOf(o.iconSize, [16, 20, 24] as const, d.iconSize),
    toolbar: strings(o.toolbar) ?? d.toolbar,
    hiddenPanels: strings(o.hiddenPanels) ?? [],
    hiddenViews: strings(o.hiddenViews) ?? [],
    statusBar: typeof o.statusBar === 'boolean' ? o.statusBar : true,
  };
}

const FONT: Record<Appearance['editorFont'], string> = {
  literata: 'var(--font-serif)',
  hanken: 'var(--font-sans)',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'var(--font-mono)',
};
const WIDTH: Record<LineWidth, string> = { narrow: '600px', normal: '680px', wide: '860px', full: 'none' };

/** Applies the appearance to the document (CSS variables and data attributes). */
export function applyAppearance(a: Appearance = current): void {
  const root = document.documentElement;
  const set = (k: string, v: string | null) => (v == null ? root.style.removeProperty(k) : root.style.setProperty(k, v));
  if (a.accent) {
    set('--honey', a.accent);
    set('--pollen', `color-mix(in srgb, ${a.accent} 80%, white)`);
    set('--honey-soft', `color-mix(in srgb, ${a.accent} 22%, transparent)`);
    set('--honey-text', `color-mix(in srgb, ${a.accent} 72%, var(--ink))`);
    set('--focus', a.accent);
  } else for (const k of ['--honey', '--pollen', '--honey-soft', '--honey-text', '--focus']) set(k, null);
  set('--editor-font', FONT[a.editorFont]);
  set('--editor-size', `${a.editorSize}px`);
  set('--editor-line', `${Math.round(a.editorSize * 1.65)}px`);
  set('--line-width', WIDTH[a.lineWidth]);
  set('--icon-size', `${a.iconSize}px`);
  set('--font-ui-override', a.uiFont === 'system' ? 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' : null);
  root.dataset.density = a.density;
  root.dataset.uiFont = a.uiFont;
}

export function getAppearance(): Appearance {
  return current;
}

export function setAppearance(patch: Partial<Appearance>): void {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private storage */
  }
  applyAppearance(current);
  listeners.forEach((l) => l());
}

export function resetAppearance(): void {
  setAppearance(DEFAULT_APPEARANCE);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** The contents of a shareable .basalt-theme.json file. */
export interface ThemeFile {
  basaltTheme: 1;
  name: string;
  colorScheme?: 'comb' | 'basalt' | 'auto';
  appearance: Appearance;
  /** Extra CSS, applied like a snippet. */
  css?: string;
}

export function parseThemeFile(text: string): ThemeFile {
  const data = JSON.parse(text) as Partial<ThemeFile>;
  if (data.basaltTheme !== 1) throw new Error("This isn't a Basalt theme file.");
  return {
    basaltTheme: 1,
    name: typeof data.name === 'string' ? data.name.slice(0, 80) : 'Imported theme',
    colorScheme: ['comb', 'basalt', 'auto'].includes(data.colorScheme as string) ? data.colorScheme : undefined,
    appearance: sanitize(data.appearance),
    css: typeof data.css === 'string' ? data.css.slice(0, 100_000) : undefined,
  };
}
