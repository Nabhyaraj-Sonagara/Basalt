# Icons

Basalt's own set: 24×24 grid, 1.75px stroke, round caps and joins, single ink drawn with `currentColor`. Where an icon needs a container shape it is a hexagon, never a circle (search's lens, task, new note, settings' nut, the daily cell).

Inline the SVG so it takes CSS `color` (as an `<img>` it renders black). Default ink is `ink-muted`; `ink` when active or hovered; `honey-text` for the active tree item; `on-honey` on a honey fill. Render at 16px in dense chrome (tree, tabs) and 20px in toolbars; never below 14px.

- `note.svg` — A note (file in the tree, "New note" menu rows).
- `folder.svg` — A folder in the tree.
- `comb.svg` — Comb view, Basalt's honeycomb map of linked notes.
- `wikilink.svg` — Insert `[[link]]`; outgoing links panel.
- `backlinks.svg` — Backlinks panel: links arriving at this note.
- `search.svg` — Search; a hexagonal lens.
- `tag.svg` — Tags pane; a hex-ended chip like the Tag component.
- `daily.svg` — Today's daily note.
- `task.svg` — Tasks pane; the same cell as the Task checkbox.
- `new-note.svg` — Create a note (ribbon and empty states).
- `settings.svg` — Settings; a hex nut.
- `command.svg` — Command palette.
- `highlight.svg` — Highlight `==text==` in the editor toolbar.
- `pin.svg` — Pin a tab or note.
