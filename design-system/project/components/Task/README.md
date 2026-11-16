# Task

A `- [ ]` checklist item. The box is a hexagonal cell that fills with honey when done — the one place Basalt animates a fill (`duration-base`, `ease-settle`).

- Props: `checked` + `onChange(next)` (controlled) or `defaultChecked`; `disabled`; `children` (the task text, set in `prose`).
- The cell is a `role="checkbox"` button; clicking the text toggles too. Done tasks go `ink-muted` with a strike in `line-strong`.
- Don't swap the cell for a square or circle checkbox anywhere in the product.
