# Logos

The mark is a single hexagonal basalt column seen from above: three stone faces, one cross-joint, and a cap of honey with one drip. Never redraw it; never tilt, outline, recolour the cap, or add a gloss — Basalt is matte.

- `basalt-mark.svg` — Primary mark, full colour (fixed colours: honey `#e8a317` cap on stone faces). Works on `surface` in both themes. Minimum 16px tall; clear space = the cap's height on every side.
- `basalt-mark-mono.svg` — Single ink, drawn with `currentColor` and face opacities. Inline it and set CSS `color` (`ink` on surfaces, `on-honey` on honey); as an `<img>` it renders black.
- `basalt-app-icon.svg` — App and favicon tile: the column on a pointy-top stone hexagon. Use as-is for dock, taskbar, favicon. Never put it inside a rounded square.
- `basalt-causeway.svg` — Three columns of different heights, the tallest honey-capped. Splash screens, onboarding, empty vaults and marketing only — never as the logo.

The wordmark is the word "basalt", lowercase, set live in `display` (Bricolage Grotesque, 700, -0.02em). Lockup: mark left, wordmark baseline aligned to the mark's lower joint, gap = 0.25 × mark height. Render it with the `Logo` component rather than an image.
