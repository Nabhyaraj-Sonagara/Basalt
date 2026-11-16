# Toast

A short, temporary message about something that just happened: a move with an undo, a finished sync, an import in progress, a sync failure. Toasts stack bottom-right in a `ToastStack` (also exported), 16px from the window edges, newest at the bottom, at most three on screen.

- Props: `tone` (`neutral`, `success`, `progress`, `danger`), `title` (what happened, past tense: "Moved 3 notes to Field notes"), `children` (one optional line of detail), `action` (`{ label, onClick }`: one verb, such as "Undo" or "Retry"), `onClose`, `progress` (0–1: a row of ten hex cells that fill with honey), `icon` (override the tone's icon).
- Tone shows in the hexagonal icon well and in the words, never in a coloured stripe. Danger toasts are `role="alert"`; the rest are polite status messages.
- Neutral and success toasts dismiss after 5 seconds (paused while hovered or focused); danger and progress stay until they resolve or are closed. Anything that needs a decision belongs in a dialog, not a toast.
- No exclamation marks, no puns: toasts carry real news.
