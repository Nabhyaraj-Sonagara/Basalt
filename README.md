# Basalt

Basalt is a local-first Markdown notes app built so AI can work with your notes too. A **hive** is any folder of Markdown files. Basalt links, searches and maps that folder without locking it in, and any AI model or agent you choose can work in it with you.

![Live preview in the Comb theme](docs/screenshots/live-preview.png)

| Basalt (dark) | Comb view | Canvas |
|---|---|---|
| ![Dark theme](docs/screenshots/basalt-dark.png) | ![Comb view](docs/screenshots/comb-view.png) | ![Canvas](docs/screenshots/canvas.png) |

## What's in it

**Writing and linking**
- Live preview editor (syntax shows only around the cursor), source mode and reading view.
- `[[links]]`, `[[Note#Heading]]`, `[[Note#^block]]`, `[[Note|alias]]` and `![[embeds]]` for notes, images, PDFs, audio and video. Autocomplete for notes, headings, blocks and tags.
- Callouts, tasks, `==highlights==`, `%%comments%%`, footnotes, KaTeX math, Mermaid diagrams and highlighted code.
- Backlinks with unlinked mentions you can link in one click. Hover a link to preview the note.
- Renaming or moving a note rewrites every link to it, including links inside canvases.
- Type `/` to insert headings, tasks, callouts, tables, code and math blocks, links, embeds, templates or today's date.
- Merge a note into another (links follow it), or extract a selection into a new linked note.
- Spellcheck with suggestions on right-click, and optional Vim key bindings.

**Finding and organising**
- Search with operators: `file:`, `path:`, `tag:`, `line:()`, `section:()`, `task-todo:`, `[property:value]`, `[rating:>3]`, `/regex/`, `OR` and `-exclude`.
- **Search by meaning** and **related notes**. These work offline with no setup; for better results, switch them to an embedding model.
- File tree with drag-to-move, tags pane with nested tags, bookmarks, outline, a properties editor, and table views that filter and sort notes by their properties.
- **Comb view**: your link graph laid out on a honeycomb. The local comb puts the open note in the middle with linked notes in rings around it; the global comb clusters the whole hive.
- Canvas boards in the open JSON Canvas format.
- Daily notes, templates, unique notes and file recovery snapshots.
- Tabs, split panes and pop-out windows, a command palette and quick switcher, rebindable hotkeys, Comb (light) and Basalt (dark) themes, and CSS snippets.
- `basalt://` links open a note from anywhere: `basalt://open?hive=Notes&file=Plan`, plus `new`, `daily` and `search`. **Copy Basalt link** in the command palette makes one for the open note.

**Built for AI**
- **Assistant** that answers using your current note, your selection, or relevant notes from across the hive, and links the notes it used. It works with Claude, OpenAI, Gemini, and any OpenAI-compatible endpoint, including **local models** in Ollama or LM Studio. API keys stay in your system keychain.
- **`basalt mcp`**: an MCP server, so Claude Code, Claude Desktop or any other MCP client can search, read, create, append to, set properties on and rename notes. It has no delete tool, and replacing a whole note requires an explicit flag.
- **`basalt` CLI** with `--json` on every command, for scripts and agents.
- **`.basalt/agents.md`**: a short conventions file that tells agents and the assistant how your hive is organised.

Basalt opens an existing folder of Markdown notes as it is. App state lives in `.basalt/` inside the hive; your notes stay plain Markdown. See [format compatibility](docs/research/format-compat.md).

## Download

Get Basalt for macOS, Windows or Linux from the [download page](https://nabhyaraj-sonagara.github.io/Basalt/) or the [latest release](https://github.com/Nabhyaraj-Sonagara/Basalt/releases/latest).

Builds aren't code-signed yet, so the first launch needs one extra step:

- **macOS:** open Basalt once, then go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Basalt message.
- **Windows:** on the SmartScreen prompt, click **More info → Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x Basalt-*.AppImage`), or install the `.deb`.

## Build from source

### Prerequisites

- **Node.js 22 LTS** (20.19 or newer also works). Check with `node -v`.
  - macOS: `brew install node@22`, or [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`. The repository has an `.nvmrc`, so `nvm use` picks the right version.
  - Windows: the LTS installer from [nodejs.org](https://nodejs.org), or `winget install OpenJS.NodeJS.LTS`.
  - Linux: your distribution's Node 22 package, or nvm.
- **npm 10** (comes with Node 22).
- **Git.** On macOS, install the Command Line Tools first if you haven't: `xcode-select --install`.

### Install and run

Clone the repository:

```bash
git clone https://github.com/Nabhyaraj-Sonagara/Basalt.git
```

```bash
cd Basalt
```

Install the dependencies **from the repository root**. One install covers every package and the desktop app, and downloads Electron (about 100 MB):

```bash
npm install
```

Run the desktop app in development:

```bash
npm run dev
```

Build everything (the CLI and the desktop app):

```bash
npm run build
```

Package an installable app for the platform you're on (output in `apps/desktop/release/`):

```bash
npm run package -w @basalt/desktop
```

### Troubleshooting

- **`sh: electron-vite: command not found`** (or `electron-builder` / `vitest`): the dependencies aren't installed. Run `npm install` from the repository root, not from `apps/desktop`, and wait for it to finish without errors. `npm run check` tells you what's missing.
- **`npm install` fails with `EBADENGINE` or "Unsupported engine":** your Node is too old. Install Node 22 (see above), then run `npm install` again.
- **`npm install` failed part-way:** npm rolls back on failure, so nothing is installed. Delete `node_modules` and run `npm ci`, then read the *first* error it prints.
- **Electron's download fails or times out** (common behind proxies or firewalls): point it at a mirror, then install again:

  ```bash
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
  ```

## Connect an agent

Claude Code:

```bash
claude mcp add basalt -- node /path/to/Basalt/packages/cli/dist/basalt.mjs mcp -H /path/to/your/hive
```

From the command line:

```bash
node packages/cli/dist/basalt.mjs -H ~/Notes search 'tag:#project task-todo:'
```

```bash
node packages/cli/dist/basalt.mjs -H ~/Notes query --where '[status:active]' --sort due
```

```bash
ANTHROPIC_API_KEY=… node packages/cli/dist/basalt.mjs -H ~/Notes ask 'What did I decide about the launch?'
```

`ask` uses whichever provider has a key set: `ANTHROPIC_API_KEY` (Claude, default model `claude-opus-5-5`), `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, or `BASALT_OPENAI_COMPAT_URL` for any OpenAI-compatible server. For semantic search with a provider's embedding model, set `BASALT_EMBEDDINGS=<provider id>`.

In the app, **Settings → Agents and CLI** shows these commands already filled in for the hive you have open.

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | Hive engine: parser, link resolver, rename rewriter, search language, properties, templates, JSON Canvas, comb layout, Markdown renderer |
| `packages/ai` | Model adapters (Claude via the Anthropic SDK; OpenAI, Gemini and OpenAI-compatible via HTTP), embeddings, semantic index, prompt building |
| `packages/cli` | `basalt` CLI and the MCP server |
| `packages/ui` | The Basalt design system for React, with tokens generated from `design-system/project/tokens.json` |
| `apps/desktop` | The Electron app: main process, sandboxed preload and React renderer |
| `design-system/` | The Basalt design system |
| `fixtures/sample-hive` | A sample hive, used by the tests and offered on the start screen |
| `docs/` | Feature inventory, format notes and the security audit |

## Testing

```bash
npm test
```

```bash
npm run typecheck
```

End-to-end, against the real Electron app on a copy of the sample hive. On Linux without a display, wrap it in `xvfb-run -a`.

```bash
npm run test:e2e
```

## Security

The window runs with context isolation, the renderer sandbox and no Node integration. The renderer reaches the main process only through a fixed set of IPC calls, which reject any frame that isn't Basalt's own. File access stays inside the open hive, and the packaged binary disables Electron's Node entry points. See the [REA audit](docs/security/rea-audit.md).

## How Basalt was designed

Basalt was designed from a clean-room inventory of features, built from public, openly licensed specifications and documented behaviour. No proprietary code was decompiled or copied. See [docs/research/feature-inventory.md](docs/research/feature-inventory.md) for what's built now and what comes next: database views, slides, sync, publish, mobile and a plugin API.
