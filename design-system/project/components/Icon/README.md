# Icon

Renders one of Basalt's 24-grid line icons inline so it takes `currentColor`. Pass `name` (`note`, `folder`, `comb`, `wikilink`, `backlinks`, `search`, `tag`, `daily`, `task`, `new-note`, `settings`, `command`, `highlight`, `pin`, plus the utility glyphs `chevron`, `external`, `close`, `info`, `warning`), `size` (default 16) and `label` when the icon stands alone and means something.

- Colour comes from the parent: `ink-muted` by default, `ink` on hover, `honey-text` when active.
- 16px in tree rows and tabs, 20px in toolbars. Never below 14px.
- Containers are hexagons, never circles — draw new icons on the same grid with 1.75 stroke and round joins.
