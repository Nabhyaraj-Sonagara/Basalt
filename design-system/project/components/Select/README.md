# Select

A native dropdown styled to match Basalt's inputs: `surface-raised`, `line-strong` border, `radius-sm`, a chevron in `ink-muted`.

- Props: `options` (strings or `{ value, label }`), plus any `<select>` attribute (`value` + `onChange`, `defaultValue`, `disabled`, `aria-label`).
- It stays a native `<select>` so the OS menu, keyboard and screen readers just work. For searching a long list (notes, folders), use the CommandPalette pattern instead.
- Options are nouns in sentence case ("Editing view", "Match system").
