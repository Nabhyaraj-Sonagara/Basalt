# Tabs

The editor's tab strip on `surface-sunken`. The active tab joins the editor's `surface` with a 2px honey bar along its top; unsaved notes show a small honey hexagon; pinned tabs lead with a pin.

- Props: `tabs` — `[{ id, title, pinned?, dirty? }]`, `active` (an id), `onSelect(id)`.
- Titles are note titles verbatim, truncated at 200px.
