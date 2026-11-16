# Comb

Comb view: Basalt's map of linked notes, laid out on a honeycomb instead of a force-directed hairball. The open note sits in a stone cell ringed in honey; its neighbours fill with honey by link strength.

- Props: `cells` — `[{ q, r, label, title?, weight: 0–3, active?, onClick? }]` in axial hex coordinates (flat-top), `cellSize` (circumradius px, default 34), `label` (accessible name).
- Weights: 0 unlinked (`surface-hover`), 1 one link (`honey-soft`), 2 several (`wax`), 3 strongly linked (`honey`). The consumer decides placement; put the strongest links adjacent to the active cell.
- Labels are short (≤ 9 characters at the default size); full titles go in `title`.
