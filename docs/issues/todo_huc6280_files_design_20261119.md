# HuC6280 Files visual alignment — 2026-11-19

- [x] Align Files panel, compact actions, tree selection and context menu with
  FM2612's outlined controls, spacing and hierarchy using the PC Engine palette.
- [x] Preserve existing file/save/context actions and keyboard focus behavior.
- [x] Inspect desktop/mobile layouts and context menu in Chromium/WebKit;
  verify file controls with existing tests. No audio output is needed.

Verification: existing Files tests 65/65 pass. Chromium/WebKit at 1240px and
390px: panel/menu visible, pill styling applied, no horizontal overflow, Escape
closes the context menu, and no AudioContext was constructed. Mobile WebKit
screenshot visually inspected. Receipts/screenshots: `/private/tmp/huc-files-design/`.
Only HuC6280 CSS and its cache token changed; file operations retain their handlers.
