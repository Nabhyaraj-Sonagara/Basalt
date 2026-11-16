# CommandPalette

The `⌘K` / `⌘P` palette: one input, a list of commands and notes, a footer of key hints. Floats on `surface-raised` with `shadow-lg` over `scrim`.

- Props: `query`, `onQueryChange`, `placeholder`, `items` — `[{ icon, label, hint?, shortcut? }]`, `activeIndex`.
- The consumer filters items and moves `activeIndex` with ↑/↓. The active row is `honey-soft`.
- Commands are verb phrases in sentence case ("Open comb view"); notes show their folder as the hint.
