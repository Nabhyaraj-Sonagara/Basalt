Basalt is a note-taking app for people who keep a vault of linked Markdown notes. Obsidian and basalt are the same lava: obsidian cools in an instant into black glass — sharp, glossy, brittle. Basalt cools slowly and splits into orderly hexagonal columns that hold up a coastline. Everything in this system leans on that difference: **matte, not glossy; structured, not shattered; warm, not violet.** The hexagon (the column, the honeycomb cell) is the system's primary shape, and honey on stone is its palette.

## Positioning and voice

- The jab lives in the name, the material and the details — never in the product UI. Never name a competitor in interface copy, docs or error messages. Marketing may wink ("Same lava. Better structure.", "Cooled slowly. Built to stack.") but never sneers.
- Speak plainly and warmly, like a well-organised friend. Short sentences. Sentence case everywhere: "New note", "Open comb view", "Sync conflict".
- Address the reader as "you"; Basalt never says "we" inside the app.
- Bee and stone puns are allowed once per screen at most, and only where nothing important is being said: empty states, onboarding, release notes. "Nothing in this cell yet." is fine; "Bee-gin writing!" is not.
- No emoji in UI chrome. No exclamation marks in errors. Errors say what happened and what to do: "Couldn't sync 2 notes. They're saved here; Basalt will retry when you're online."
- Product nouns: a **vault** (a folder of notes), a **note**, a **link** (written `[[like this]]`), **backlinks**, **tags**, and the **comb** (Comb view, the honeycomb map that replaces a graph view). Write them lowercase in running text.

## Colour

Two themes, both first-class: **Comb** (beeswax light, the default) and **Basalt** (cooled-stone dark). Every token is defined in both; check both before shipping.

- Grounds: `surface` for the editor and page, `surface-sunken` for the sidebar, tab strip and code blocks, `surface-raised` for cards, menus and the palette, `surface-hover` for row and button hover.
- Text: `ink` for content, `ink-muted` for chrome, metadata and icons, `ink-faint` only for timestamps and counts on `surface` or `surface-raised`.
- Honey is the brand. `honey` is a **fill** — the primary button, a filled task cell, an active tag, a strong comb cell — and text on it is always `on-honey`, never white. Honey as text is `honey-text` (and its alias `link`). `honey-soft` tints selected rows, tags and tip callouts.
- `pollen` is for `==highlights==` and search hits only, with `on-honey` text.
- `stone` and `stone-light` paint columns and dark brand bands; text on `stone` is `stone-ink`.
- Status: `moss` (synced, success), `ember` (conflicts, destructive), `sky` (info, links that leave the vault), each with a `-soft` ground. Always pair a status colour with a word or an icon.
- There is no purple, violet or indigo anywhere in Basalt — not in charts, not in illustrations, not in plugin defaults.
- Every text token's usage note names the grounds it is checked on (4.5:1 in both themes); `line-strong` and `focus` hold 3:1 on every surface. `line` is decorative and never the only edge of a control.

## Type

Four families, each with one job.

- `display` — Bricolage Grotesque. Chunky and slightly irregular, like cut stone. Styles `display`, `title` (a note's H1), `heading` (H2, dialog titles). Never for body text or chrome.
- `sans` — Hanken Grotesk. All chrome: `ui`, `ui-strong`, `label` (uppercase in CSS), `caption`.
- `serif` — Literata. The words people write: `prose` (17/28) in the editor and reading view, `prose-small` in callouts, hover previews and search excerpts. Notes read like a book, not a terminal.
- `mono` — JetBrains Mono. `code` for code blocks, inline code, source mode and key caps.

Set note titles in `title`, never in bold `prose`. Keep line length in the editor to about 68 characters (max width 680px at `prose`).

## Shape: the hexagon

The hexagon is Basalt's round. Wherever another system reaches for a circle or a pill, use a hexagon.

- Use `hex-pointy` (clip-path token) for avatars, vault badges, icon wells and the task cell; `hex-flat` for comb cells and honeycomb patterns; `hex-chip` for tags and count badges (Basalt has no pills).
- A regular hexagon is 1.1547 × as wide as tall (flat) or as tall as wide (pointy). Don't squash hexagons to fit a box; change the box.
- Rectangles stay crisp: `radius-xs` (2px) on inline code, keys and highlights; `radius-sm` (4px) on buttons, inputs, rows and tabs; `radius-md` (8px) on cards, callouts, menus and the palette. Nothing is fully rounded.
- Honeycomb patterns (tiles of `hex-flat` in `wax` on `surface`) are for empty states, onboarding and marketing. Never behind note text.
- Don't stack more than one hex motif in a single control, and don't use hexagons as bullets in prose.

## Space, layout, elevation, motion

- 4px base: `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32, `space-12` 48. Columns stack in fours: keep paddings on the scale.
- Workspace: sidebar 248px on `surface-sunken`, editor centred on `surface` with `space-12` top padding, optional right panel 272px for comb and backlinks; panes divided by 1px `line`, not shadows.
- Basalt is matte. `shadow-sm` for raised cards and the active tab, `shadow-lg` for anything floating (palette, menus, hover previews). No glows, glass, blur or gradients.
- Focus: rectangles show `focus-ring` (a 2px surface gap then 2px solid `focus`). Hex-clipped controls take a 2px solid `focus` outline on their unclipped wrapper, because clip-path cuts shadows.
- Motion is unhurried and settles without bouncing: `duration-fast` for hover and press, `duration-base` for menus, palettes and a task cell filling, always `ease-settle`. Respect reduced-motion by removing transforms, not colour changes.

## Iconography

- Basalt's own set (asset group Icons): 24 grid, 1.75 stroke, round caps and joins, single ink in `currentColor`. Containers inside icons are hexagons (search's lens, task, settings' nut).
- Render 16px in tree rows and tabs, 20px in toolbars; `ink-muted` by default, `ink` on hover, `honey-text` when active, `on-honey` on honey.
- No emoji as icons. Don't mix in another icon library; draw missing icons on the same grid.

## Logo

- The mark is a hexagonal basalt column with a honey cap and one drip (Logos group). Use the `Logo` component for the lockup (mark + lowercase "basalt" in `display` 700).
- `basalt-app-icon.svg` is the dock, favicon and store tile: the column on a stone hexagon. Never put the mark in a rounded square or a circle.
- `basalt-causeway.svg` (three columns) is illustration for splash, onboarding and empty vaults; it is not the logo.
- Don't recolour the cap, add gloss or a glow, outline the mark, or rotate it.

## Components

`window.Basalt` (React 18): `Logo`, `Icon`, `Button`, `Kbd`, `Tag`, `Task`, `Wikilink`, `Callout`, `HexAvatar`, `SearchField`, `TreeItem`, `Tabs`, `CommandPalette`, `Comb`. Load `tokens.css` and `components/bundle.css` first; set `data-theme="comb"` or `data-theme="basalt"` on `<html>`. The Workspace card shows them composed into the app shell.
