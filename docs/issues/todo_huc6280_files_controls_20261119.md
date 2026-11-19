# HuC6280 Files controls

- [x] Seed examples in a fresh application project and remove its Examples button.
- [x] Label New JS as ＋ JS; add Discard all beside Save/Save all/Discard.
- [x] Preserve Undo files until the user decides after its explanation.
- [x] Explain Save sound as creating a new preset document; verify existing saves.

Examples are seeded for fresh application projects and New Cassette; existing
restored projects retain their own files. Undo remains in the lower actions row,
separate from the four save/discard controls. Save sound creates a new preset.

Verification: Files/Code host tests 74/74 pass, including multi-document Discard
all. Chromium/WebKit at 1240px/390px retain context-menu layout and Escape
behavior without creating audio. No automatic Code execution was added.
