# Writing Basalt plugins

A plugin is a folder in a hive's `.basalt/plugins/` with a `manifest.json` and a script. Install one from Settings → Plugins → **Choose folder…**, or put the folder there yourself (or ask your AI agent to) and press **Reload**. Plugins start off, and Basalt asks before turning one on.

See [`examples/plugins/word-goal`](../examples/plugins/word-goal) for a complete plugin.

## manifest.json

```json
{
  "id": "word-goal",
  "name": "Word goal",
  "version": "1.0.0",
  "description": "What it does, in a sentence.",
  "author": "You",
  "permissions": ["read", "write"],
  "main": "main.js",
  "panel": "panel.html"
}
```

| Field | |
| --- | --- |
| `id` | 2–41 lowercase letters, digits or dashes; must match the folder name. |
| `permissions` | `"read"` to read notes, `"write"` to create and change them. Leave it out if the plugin only adds commands and status text. |
| `main` | The background script (default `main.js`). |
| `panel` | Optional HTML page shown in the right sidebar's **Plugins** panel. |

If a new version asks for more permissions, Basalt pauses it until it's turned off and on again.

## The sandbox

Plugins run in sandboxed frames with **no internet access** and no access to Basalt, the disk or other frames. They can load their own files (scripts, styles, images, fonts) by relative path. Everything else goes through the `basalt` SDK, and Basalt checks each call against the plugin's approved permissions. Plugins can't read or write anything in `.basalt/` (including their own code and settings).

## The `basalt` SDK

`window.basalt` is ready when `main.js` runs, and is added to panel pages automatically. Every call returns a promise.

| Call | Needs | |
| --- | --- | --- |
| `commands.add({ id, name }, run)` | – | Adds "Plugin name: name" to the command palette (main script only). |
| `commands.remove(id)` | – | |
| `ui.toast(message, tone?)` | – | `tone`: `'success'` or `'danger'`. |
| `ui.status(text)` | – | Text in the status bar; `''` clears it. |
| `on('note-open', ({ path }) => …)` | read | Called when another note becomes active (`path` is `null` for non-notes). |
| `notes.active()` | read | `{ path, title, text, selection }` of the open note, or `null`. |
| `notes.list()` | read | `[{ path, title, tags, mtime, words }]` |
| `notes.read(path)` | read | Markdown text. |
| `notes.search(query)` | read | Same query language as the search box. |
| `notes.open(path)` | read | Opens the note. |
| `notes.create(path, text?)` | write | Picks a free name if taken; returns the path. |
| `notes.write(path, text)` | write | Replaces an existing note. |
| `notes.append(path, text)` | write | Adds to the end (creates the note if needed). |
| `editor.insert(text)` | write | Replaces the selection in the open note. |

Paths are relative to the hive, like `Projects/Plan.md` (`.md` is added if there's no extension).
