# SearchField

The vault search box at the top of the sidebar: hexagonal lens icon, input, and a `⌘K` hint.

- Props: `placeholder` (default "Search the vault"), `shortcut` (default `⌘K`; `null` hides it), and any `<input>` attribute (`value`, `onChange`, `onKeyDown`).
- Border is `line-strong` (3:1 on every surface); focus adds `focus-ring` to the whole field.
