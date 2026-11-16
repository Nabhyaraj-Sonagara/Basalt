# Callout

A `> [!kind]` block inside a note: a tinted card with a hex-contained icon and a short title. Four kinds — `note` (sunken stone), `tip` (honey-soft), `info` (sky-soft), `warning` (ember-soft).

- Props: `kind`, `title` (defaults to the kind's name), `children` (body content; paragraphs render in `prose-small`).
- Colour is never the only signal: every kind has its own icon and title.
- No coloured side stripe — the whole card is tinted, corners `radius-md`.
