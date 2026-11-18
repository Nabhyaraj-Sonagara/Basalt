export interface HiveSettings {
  dailyNotes: { folder: string; format: string; template: string };
  templates: { folder: string; dateFormat: string; timeFormat: string };
  attachments: { folder: string };
  newNotes: { folder: string };
  uniqueNote: { format: string; folder: string };
  editor: {
    defaultMode: 'live' | 'source' | 'reading';
    readableLineLength: boolean;
    vimMode: boolean;
    spellcheck: boolean;
    showFrontmatter: boolean;
    /** Typing / opens a menu of things to insert. */
    slashCommands: boolean;
  };
  links: { updateOnRename: boolean; useWikilinks: boolean };
  snapshots: { intervalMinutes: number; keep: number };
  snippets: string[];
}

export const DEFAULT_SETTINGS: HiveSettings = {
  dailyNotes: { folder: 'Daily', format: 'YYYY-MM-DD', template: '' },
  templates: { folder: 'Templates', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
  attachments: { folder: 'Attachments' },
  newNotes: { folder: '' },
  uniqueNote: { format: 'YYYYMMDDHHmm', folder: '' },
  editor: { defaultMode: 'live', readableLineLength: true, vimMode: false, spellcheck: false, showFrontmatter: false, slashCommands: true },
  links: { updateOnRename: true, useWikilinks: true },
  snapshots: { intervalMinutes: 5, keep: 20 },
  snippets: [],
};

type Obj = Record<string, unknown>;

/** Deep merge used to layer saved settings over defaults so new keys get default values. */
export function mergeDeep<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out: Obj = { ...(base as Obj) };
  for (const [k, v] of Object.entries(over as Obj)) {
    const b = (base as Obj)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? mergeDeep(b, v) : v;
  }
  return out as T;
}

/** Default contents of `.basalt/agents.md`, read by the MCP server and the assistant. */
export const DEFAULT_AGENTS_MD = `# Hive conventions

Agents and the Basalt assistant read this file before working in this hive. Edit it to describe how you organise notes.

- Notes are Markdown. Link notes with [[wikilinks]].
- Put daily notes in \`Daily/\` named \`YYYY-MM-DD\`.
- Use frontmatter properties for structured data (status, due, tags).
- Draw diagrams and charts as \`\`\`mermaid code blocks. Mind maps are notes with \`view: mindmap\`, a \`# Central idea\` heading and a nested bulleted list.
- Interactive pages are self-contained \`.html\` files (they run offline, without network access); embed one with \`![[page.html]]\`.
- Don't delete notes; ask first.
`;
