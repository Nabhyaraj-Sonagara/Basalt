# Tag

A `#tag` as a hex-ended chip — Basalt's answer to the pill. Shown in note metadata, the tags pane and search filters.

- Props: `children` (the tag, with or without a leading `#`), `count` (notes using it), `active` (honey fill when it's a selected filter), `tone="stone"` (archived or system tags), `onClick` or `href` to make it interactive.
- Interactive tags take focus on their unclipped wrapper (2px `focus` outline): the hex clip would cut a box-shadow ring.
- Tags are lowercase-kebab as the user typed them; never re-case them.
