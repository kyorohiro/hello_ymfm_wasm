# SID import menu — 2026-11-21

- [x] Move the single Load SID… button into Menu / Import. Keep the existing
      file input and song controls; do not duplicate the import operation.
- [x] Close the menu before opening the native chooser, retain cancel/error
      handling and keyboard focus behavior, and update the local instructions.
- [x] Verify the existing SID suite and actual muted browser menu/chooser,
      cancel and valid self-authored file loading. No autoplay or publication.

Verification: `npm run test:sid-synth` passed 347/347. A focused one-off
Chromium/WebKit check confirmed the single Import button opens a real chooser
and closes the menu, a dispatched input cancel preserves the authored sound,
and selecting a valid self-authored PSID loads without starting audio. Existing
Play/Stop worked with all physical destinations muted before startup. Headless
automation dispatches the input cancel event; it does not dismiss an OS dialog.
Evidence: `build/sid-import-menu-20261121/browser.json` and two screenshots.
No new committed test harness, commit/push, npm/Tauri update or publication.
