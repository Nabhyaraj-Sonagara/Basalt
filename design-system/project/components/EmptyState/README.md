# EmptyState

What a pane shows when it has nothing in it: an empty hive, no search results, no backlinks, no tasks. The full size sits on a honeycomb that thins out from the centre (`honey-soft` cells with a few `wax` accents — fewer cells, never a gradient); `compact` drops the pattern for sidebars and panels.

- Props: `title` (required, one short sentence, no full stop), `children` (one or two sentences saying what will appear here and how), `actions` (Buttons; at most one `primary`), `icon` (an Icon name in a hexagonal well, default `note`), `illustration="causeway"` (the three-column drawing, for an empty hive or first run only), `compact`, `pattern` (false to hide the honeycomb).
- Copy: say what goes here and how to put it there. The one bee or stone pun allowed on the screen lives here, in the title ("Nothing in this cell yet"); search and error states stay plain ("No notes match “colonade”").
- The consumer provides the container size; the full variant needs about 320px of height.
- Don't use it for loading (show the pane's skeleton) or for errors (use a warning Callout).
