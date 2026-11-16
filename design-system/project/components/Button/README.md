# Button

Four variants: `primary` (honey fill, `on-honey` label) at most once per view for the thing the screen is for; `secondary` (raised, `line-strong` border) for everything else that matters; `quiet` for toolbar and inline actions; `danger` (ember) only for actions that destroy notes.

- Props: `variant` (default `secondary`), `size` (`md` 32px, `sm` 28px), `icon` (an Icon name, leading), `children` (the label), plus any `<button>` attribute. Icon-only buttons need `aria-label`.
- Labels are verbs in sentence case: "New note", "Open hive", "Delete note". Never "OK", never "Click here", never Title Case.
- Focus shows `focus-ring`; pressing nudges down 1px. No glow, no gradient — Basalt is matte.
