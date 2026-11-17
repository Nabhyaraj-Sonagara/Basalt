# Feature inventory (clean-room)

This is a functional inventory of the incumbent Markdown-notes desktop app that Basalt sets out to match, written so Basalt can be built without looking at that app's code.

## Method and sources

The incumbent is closed-source, so nothing here comes from unpacking, decompiling or tracing its binaries. REA's own disclaimer also rules out "copying proprietary software or reproducing its protected code and assets". The inventory draws on:

1. **Its public plugin API type definitions** (`obsidian-api`, MIT licence, Dynalist Inc.). These name every public concept: `Vault`, `MetadataCache`, `CachedMetadata` (links, embeds, tags, headings, sections, list items, blocks, footnotes, frontmatter), `Workspace` / `WorkspaceLeaf` / splits / tabs, `Command`, `Hotkey`, `SuggestModal`, `HoverPopover`, `PluginSettingTab`, `Bases*` (database views), `SecretStorage`, `registerCliHandler` (CLI integration) and so on.
2. **The JSON Canvas 1.0 spec** (MIT licence). It is an open format, and Basalt implements it directly.
3. **Common file conventions** shared by Markdown tools (see `format-compat.md`).
4. **General knowledge of how the product behaves.** Its website was unreachable from the build environment.

REA is used where it is clearly legitimate: auditing **Basalt's own** packaged Electron build (see `docs/security/rea-audit.md`).

## Inventory

Status codes: **M1** = built in this milestone · **M2** = next milestone · **L** = later.

### Files and hives
| Capability | Behaviour | Basalt | Status |
|---|---|---|---|
| Vault = folder | Any folder of `.md` files; app config lives in a hidden dot-folder | **Hive**; config in `.basalt/`; opens an existing vault folder unchanged | M1 |
| Multiple vaults, vault switcher | Recent list, open folder as vault | Recent hives on the start screen | M1 |
| File explorer | Tree, create note or folder, rename, move, delete to trash, sort | Sidebar tree (`TreeItem`); delete goes to `.basalt/trash` | M1 |
| External change detection | Watches the disk, reloads open files | chokidar watcher, live re-index | M1 |
| Attachments | Images, PDFs, audio and video stored in the vault, with a configurable attachment folder | Embedded inline; attachment folder setting | M1 (images, PDF) |
| File recovery | Periodic snapshots of edited notes | `.basalt/snapshots/` taken on save, with a restore view | M1 |

### Editor
| Capability | Behaviour | Basalt | Status |
|---|---|---|---|
| Live preview | Markdown renders inline and syntax shows only around the cursor | CodeMirror 6 decorations | M1 |
| Source mode | Raw Markdown | Same editor, decorations off | M1 |
| Reading view | Fully rendered, not editable | markdown-it renderer | M1 |
| Autocomplete links | Typing `[[` suggests notes, then headings with `#` and blocks with `^` | CM6 completion source | M1 |
| Tasks | `- [ ]` checkboxes you can toggle | `Task` hex cell | M1 |
| Callouts | `> [!type] Title`, foldable with `+`/`-` | `Callout` component | M1 |
| Highlights, comments | `==mark==`, `%%hidden%%` | pollen highlight; comments hidden in preview | M1 |
| Math, diagrams, code | KaTeX/MathJax, Mermaid, syntax-highlighted code | KaTeX, Mermaid (lazy), highlight.js | M1 |
| Footnotes | `[^1]` with a footnote list | markdown-it-footnote | M1 |
| Tables | GFM tables | Rendered | M1 (visual table editor L) |
| Vim keys, spellcheck, RTL | Editor options | Vim via `@replit/codemirror-vim`; spellcheck with right-click suggestions. RTL later | M1 |
| Slash commands | `/` opens commands inline | Headings, lists, callouts, tables, blocks, links, embeds, templates, date | M1 |

### Linking and knowledge graph
| Capability | Behaviour | Basalt | Status |
|---|---|---|---|
| Wikilinks | `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]`, `[[Note#^block]]` | Same | M1 |
| Markdown links | `[text](Note.md)` also count as links | Same | M1 |
| Embeds | `![[Note]]`, `![[Note#Heading]]`, `![[image.png\|300]]` | Transclusion in preview | M1 |
| Shortest-path resolution | A link resolves by basename unless that is ambiguous | Same algorithm | M1 |
| Aliases | `aliases:` frontmatter matches in the switcher and link suggest | Same | M1 |
| Backlinks / outgoing links / unlinked mentions | Panel with context snippets and a "link" action for mentions | Right panel | M1 |
| Update links on rename | Rewrites every inbound link | Core rewriter | M1 |
| Page preview | Hover a link to see a popover | `HoverPreview` | M1 |
| Graph view | Force-directed graph, global and local, with filters and groups | **Comb view**: honeycomb map; local = rings by link distance, global = hex-snapped layout | M1 |
| Tags | `#tag`, `#nested/tag`, frontmatter `tags:`; tag pane with counts | Same | M1 |
| Outline | Heading tree of the current note | Panel | M1 |

### Properties and data
| Capability | Behaviour | Basalt | Status |
|---|---|---|---|
| Properties | YAML frontmatter editor with types (text, list, number, checkbox, date, datetime) | Properties panel; types inferred and stored per hive | M1 |
| Bases | Database-style table, card and list views over notes, filtered and sorted by properties, with formulas | Query engine M1 (CLI/MCP); table view M2 | M2 |

### Search and navigation
| Capability | Behaviour | Basalt | Status |
|---|---|---|---|
| Search | Full text with `path:` `file:` `tag:` `line:()` `block:()` `section:()` `task:` `task-todo:` `task-done:` `[prop:value]`, `OR`, `-`, quotes, `/regex/` | Same operators, MiniSearch underneath | M1 |
| Quick switcher | Fuzzy-open a note, or create one | `CommandPalette` in file mode | M1 |
| Command palette | Every command, with hotkeys shown | `CommandPalette` | M1 |
| Hotkeys | Rebindable | Settings → Hotkeys | M1 |
| Bookmarks | Notes, headings, searches, groups | Bookmarks panel | M1 |
| Navigation history | Back and forward | Per tab | M1 |
| Random note | Open a random note | Command | M1 |

### Workspace
| Capability | Behaviour | Basalt | Status |
|---|---|---|---|
| Tabs | Pinned and linked tabs | `Tabs` | M1 |
| Splits | Vertical and horizontal | Split panes (two levels) | M1 |
| Stacked tabs, pop-out windows | | Pop-out windows built; stacked tabs later | M1 |
| Sidebars | Left and right docks, collapsible | 248px / 272px per the design system | M1 |
| Workspace layouts | Save and restore named layouts | Last layout restored; named layouts M2 | M1/M2 |
| Status bar | Word count, backlinks count, sync state | Status bar | M1 |

### Core plugins (built-in features)
| Capability | Basalt | Status |
|---|---|---|
| Daily notes (format, folder, template) | Same | M1 |
| Templates (`{{date}}`, `{{time}}`, `{{title}}`) | Same, plus `{{date:FORMAT}}` | M1 |
| Unique note creator (timestamp prefix) | Command | M1 |
| Word count | Status bar | M1 |
| Canvas | JSON Canvas editor: text, file, link and group nodes; edges; pan and zoom | M1 basic |
| Slides (from `---` separators) | Presentation mode | M2 |
| Note composer (merge, extract) | Commands; merge repoints links | M1 |
| Audio recorder | | L |
| Web viewer | | L |
| Format converter (import from other apps) | Importers | L |
| Publish | Static site export (`basalt export`) | M2 |
| Sync | Git or folder sync adapters; end-to-end encrypted service later | L |

### Extensibility
| Capability | Basalt | Status |
|---|---|---|
| Themes and CSS snippets | Comb and Basalt themes; `.basalt/snippets/*.css` | M1 |
| Community plugins | Basalt plugin host first, then a compatibility shim for the public plugin API types | L |
| URI scheme | `basalt://` open, new, daily and search; only hives opened before | M1 |
| CLI | The incumbent's API exposes `registerCliHandler`, so a CLI exists there too. Basalt ships a first-class `basalt` CLI with JSON output | M1 |
| Mobile | Capacitor shell over the same renderer | L |

## Where Basalt goes further (AI-friendly)

| Capability | Why |
|---|---|
| **`basalt mcp` server** | Any MCP agent can search, read, create, edit, append to and link notes, and query properties, backlinks and tags. Writes stay inside the hive root. |
| **`basalt` CLI with `--json`** | Scripts and agents get structured output instead of scraping. |
| **Multi-model assistant panel** | Claude, OpenAI, Google Gemini and any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, Groq, Mistral) behind one interface. Context comes from the current note, the selection or the hive (retrieval). |
| **Semantic search and related notes** | An embeddings index in `.basalt/index/`. It works offline with a built-in hashed-vector model, and quality improves with provider or Ollama embeddings. |
| **Hive conventions file** | `.basalt/agents.md` tells agents and the assistant how this hive is organised. The MCP server and the assistant both read it. |
| **Machine-readable everything** | Settings, workspace and index are JSON in `.basalt/`; notes stay plain Markdown. |
