# Wikilink

An inline `[[link]]` inside note prose. Internal links are `link` (honey-text) with a honey underline; links to notes that don't exist yet are `ink-muted` with a dashed underline and create the note on click; links leaving the vault are `sky` with an arrow.

- Props: `children` (the note title or alias), `href`, `onClick`, `unresolved`, `external`.
- Only inside running text. In lists of notes use TreeItem or a palette row.
