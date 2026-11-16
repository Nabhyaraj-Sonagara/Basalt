# Logos

The mark is a single hexagonal basalt column seen from above: three stone faces, one cross-joint and a lit, weathered top. Plain stone, no honey. Never redraw it; never tilt, outline, colour it, or add a gloss — Basalt is matte.

- `basalt-mark.svg` — Primary mark in fixed stone tones (faces `#6b6259` / `#48423b` / `#34302b`, top `#9a9083`). Works on `surface` in both themes. Minimum 16px tall; clear space = the cap's height on every side.
- `basalt-mark-mono.svg` — Single ink, drawn with `currentColor` and face opacities. Inline it and set CSS `color` (`ink` on surfaces, `on-honey` on honey); as an `<img>` it renders black.
- `basalt-app-icon.svg` — App and favicon tile: the stone column on a pointy-top honey hexagon (`#e8a317`), the one place the mark meets honey. Use as-is for dock, taskbar, favicon. Never put it inside a rounded square.
- `basalt-causeway.svg` — Three plain stone columns of different heights, the tallest with the mark's lit top. Splash screens, onboarding, empty hives and marketing only — never as the logo.

The wordmark is the word "basalt", lowercase, set live in `display` (Bricolage Grotesque, 700, -0.02em). Lockup: mark left, wordmark baseline aligned to the mark's lower joint, gap = 0.25 × mark height. Render it with the `Logo` component rather than an image.
