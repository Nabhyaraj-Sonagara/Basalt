# HoverPreview

The floating card shown when someone hovers a `[[link]]` (or holds ⌘ over one): the note's title and folder, an excerpt in `prose-small`, and a footer of tags, last edit and backlink count. For a link to a note that doesn't exist yet it says so and offers "Create note".

- Props: `title`, `path` (folder, or "Hive / Folder" across hives), `children` (the excerpt; paragraphs), `heading` (when the link targets `[[Note#Heading]]`, the excerpt starts there), `tags`, `meta` ("Edited yesterday"), `backlinks`, `maxLines` (default 6), `onOpen` (shows an open-in-new-tab button), `unresolved` + `onCreate`, `style` for positioning.
- The consumer positions it: 4px below the link, left edges aligned, flipped above when there's no room; open after 300ms of hover, close 150ms after the pointer leaves both link and card. It must stay open while the pointer is inside it.
- Floating, so `surface-raised` + `shadow-lg` + `radius-md`, 360px wide. One preview at a time; never nest a preview inside another.
