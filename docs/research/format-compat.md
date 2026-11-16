# Format compatibility

Basalt opens an existing Markdown vault in place and changes nothing until you edit. Everything below is plain text on disk.

## Markdown dialect

| Syntax | Meaning | Indexed as |
|---|---|---|
| `---\nkey: value\n---` at the top of the file | YAML frontmatter (properties) | `properties` |
| `aliases: [A, B]` / `alias:` | Alternative names for the note | `aliases` |
| `tags: [a, b/c]` / `tags: a` | Tags in frontmatter | `tags` |
| `#tag`, `#nested/tag` | Inline tag. It must contain at least one non-digit, can't start inside a word, and doesn't count in code | `tags` |
| `[[target]]` | Wikilink | `links` |
| `[[target\|display]]` | Wikilink with display text | `links` |
| `[[target#Heading]]`, `[[target#^blockid]]`, `[[#Heading]]` | Subpath link (same-note when the target is empty) | `links` with `subpath` |
| `![[target]]`, `![[img.png\|300]]`, `![[img.png\|300x200]]` | Embed (transclusion or attachment) | `embeds` |
| `[text](path.md)`, `[text](path%20with%20spaces.md#heading)` | Markdown link to a local file | `links` |
| `^blockid` at the end of a paragraph or list item | Block id | `blocks` |
| `> [!note] Title`, `> [!tip]-` (folded), `> [!warning]+` | Callout | rendered |
| `==text==` | Highlight | rendered |
| `%%comment%%` (inline or block) | Hidden comment | stripped in preview and index |
| `- [ ]`, `- [x]`, `- [-]` | Tasks (todo, done, cancelled) | `tasks` |
| `$inline$`, `$$block$$` | Math | rendered with KaTeX |
| ```` ```mermaid ```` | Diagram | rendered with Mermaid |
| `[^1]` / `[^1]: note` | Footnotes | rendered |

## Link resolution

1. Strip the subpath (`#…`) and display text (`|…`).
2. If the link text has a `/`, try it as a path relative to the hive root (with or without `.md`), then relative to the source note's folder.
3. Otherwise match by basename, case-insensitive. Prefer an exact-case match; if several notes share the basename, prefer the one closest to the source folder, then the shortest path.
4. A link that doesn't resolve is **unresolved**. It's rendered with the `unresolved` Wikilink style, and clicking it creates the note.

When you rename or move a note, Basalt rewrites every inbound link. It keeps each link's style (wikilink or Markdown), its display text and its subpath, and it uses the shortest unambiguous link text.

## JSON Canvas 1.0

Basalt reads and writes `.canvas` files per the open JSON Canvas 1.0 spec:
- `nodes[]`: `text | file | link | group`, each with `id, x, y, width, height, color?`. Array order is z-order.
- `edges[]`: `id, fromNode, toNode, fromSide?, toSide?, fromEnd?, toEnd?, color?, label?`.
- Colours: preset `"1"`–`"6"` or a hex string. Basalt maps the presets onto its own palette (no purple: preset 6 maps to `stone`).
- Fields Basalt doesn't know are kept as they are when it writes the file back.

## App state

| Path | Contents |
|---|---|
| `.basalt/settings.json` | Hive settings (daily-note format, templates folder, attachment folder, editor options) |
| `.basalt/workspace.json` | Open tabs, splits, panel state |
| `.basalt/bookmarks.json` | Bookmarks |
| `.basalt/hotkeys.json` | Custom hotkeys |
| `.basalt/snippets/*.css` | CSS snippets |
| `.basalt/snapshots/` | File-recovery snapshots |
| `.basalt/trash/` | Deleted notes |
| `.basalt/index/` | Search and embedding caches (safe to delete) |
| `.basalt/agents.md` | Hive conventions for agents and the assistant |

API keys are **never** written to the hive. The desktop app keeps them in the OS keychain through Electron `safeStorage`. The CLI and MCP server read them from environment variables.
