# TreeItem

One row in the file tree: caret (folders), icon, label, optional count. 28px tall, indented 16px per depth.

- Props: `kind` (`note` | `folder`), `label`, `depth`, `open` (folders), `active` (the note in the editor: `honey-soft` row, `honey-text` label), `count`, `icon` (override, e.g. `daily`), `onClick`.
- Wrap rows in an element with `role="tree"`; the consumer handles arrow-key movement.
- Labels truncate with an ellipsis; never wrap a tree row.
