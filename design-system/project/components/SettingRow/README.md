# SettingRow

One setting: a label and a one-line description on the left, its control on the right. Rows live inside a `SettingsGroup` (also exported), which adds a `heading` title, an optional description and the raised card; rows are divided by `line`.

- `SettingRow` props: `label`, `description` (text or nodes; wrap paths in `<code>`), `badge` (a stone Tag such as "beta"), `tone="danger"` (ember label, for destructive rows: put them last in their group), `disabled`, `children` (exactly one control: `Toggle`, `Select`, or a `Button` size `sm`).
- The row names its control: a single child without its own `aria-label` gets `aria-labelledby` pointing at the row label.
- `SettingsGroup` props: `title`, `description`, `children` (SettingRows).
- Labels say what the setting is, not what the switch does ("Spellcheck", not "Enable spellcheck"). Descriptions say what changes, in one sentence. A setting's effect is immediate: there is no Save button on settings pages.
