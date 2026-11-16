# Toggle

An on/off switch for settings that take effect immediately. The track is a hex-ended chip, the thumb a pointy hexagon: off is a `line-strong` track with a `surface-raised` thumb; on is `honey` with an `on-honey` thumb, sliding over `duration-base`.

- Props: `checked` + `onChange(next)` (controlled) or `defaultChecked`, `disabled`, `label` (accessible name when not inside a SettingRow), `id`.
- It is a `role="switch"` button; focus shows a 2px `focus` outline on the unclipped button.
- Use it only where the change applies at once. For choices that need confirming, or in note content, use `Task`; for more than two options, `Select`.
