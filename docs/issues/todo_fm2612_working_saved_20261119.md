# Files working/saved and explicit Save — 2026-11-19

User-approved behavior: two internal versions, `working` and `saved`. Auto apply
is on by default and advances saved immediately. With Auto apply off, edits
remain working until Save or Save all. Show a dot beside unsaved filenames in
Files, without adding a Code status label. Cmd/Ctrl+S saves the active document;
buttons offer Save, Save all and discard changes.

- [x] Add a reusable, typed two-version Virtual Files API with independent
  working/saved data, atomic Save/Save all/discard and snapshot recovery.
- [x] Keep existing filesystem/checkpoint APIs compatible; avoid copying all
  audio bytes on every small edit or conflating saved with IndexedDB durability.
- [x] Integrate FM2612 Files and draft recovery; preserve both versions across
  file selection, editor changes, Undo and reload. Migrate existing projects.
- [x] Replace Sync/Revert UI with Auto apply (default on), Save, Save all and
  discard; show unsaved dots beside filenames in Files.
- [x] Ensure manual-mode tone edits do not reach playback until Save, across
  FM/PSG/PCM and running Code; saving JavaScript never executes it automatically.
- [x] Verify text/binary, multi-file instruments, failure atomicity, shortcuts,
  browser source and readable standalone ZIP without speaker output.

Scope is the shared Virtual Files foundation and FM2612 Synth integration.
No npm publication, commit, push or release is requested.

Foundation verification: all 118 Virtual Files tests pass, including 12 new
workspace cases. The browser mirror matches canonical sources and declarations.
The packed offline consumer passes runtime checks and TypeScript NodeNext /
Bundler checks without changing the package version or publishing it.

Implementation: FM2612 uses separate authoring/playback state for manual FM,
PSG and RF5C164 editing. Saving FM fields uses sparse writes, preserving a
running Code performance's pitch and packed-register companions. Physical CH
controls remain direct hardware edits. Run/Apply resolves the saved JavaScript
entry, dynamic modules and files; Save never executes source.

The user chose to retain both versions in exported Cassettes. Ordinary files
contain saved data; versioned metadata stores working differences, deletions,
directories and Auto apply state. Unchanged audio is included once. FM native
binary/sidecar pairs save atomically, including pending renames. Existing v1
projects migrate without discarding opaque files or legacy checkpoint bytes.
Both local draft and small recovery journals retain accepted/working versions;
Save updates memory even if IndexedDB fails, with Export recovery available.

Verification: 758 Synth unit tests, 4 standalone packaging tests, 118 Virtual
Files tests, and 724 Code-focused tests covering the shared controls and the
other 10 Synth applications pass. The readable FM2612 ZIP builds and its
dependency graph validates; each extracted file matches the archive/stage.
Browser verification uses speaker gain zero and measures rendered output.

Source browser checks pass in Chromium and WebKit, with both the fallback
textarea and real Monaco. The nine groups cover default Auto apply, shortcuts,
Save all, binary/sidecar pairs, saved Code/modules, running audio, import/export,
Undo/New/reload, and IndexedDB quota failures with journal recovery. No page
exceptions are filtered. Desktop and 390px layouts were inspected. Monaco's
existing optional word-occurrence cancellation workaround now also covers the
two-version FM host; legacy hosts retain their options.

The exact standalone ZIP also passed the nine runtime groups in all four
browser/editor combinations. Final focused checks then verified normal and
expanded layouts through desktop → 390px → desktop, plus Auto apply checkbox
focus, on both source and the latest ZIP in all four combinations. The final
UI-only fixes prevent Monaco's grid minimum from widening the mobile page and
release checkbox focus so keyboard notes remain available. No audio-core or
execution behavior changed after the full runtime checks.

Validation ZIP (not a release/publication):
`release/hello_ymfm_wasm_working_saved_check_20261119_itch_synth.zip`.
SHA-256: `85ac241fe40d5bf7feb6eff6c64b42c4a879fd47f3223fbba8a4492e1d271182`.
Its 333 extracted files match the stage. Browser receipts/screenshots are under
`/private/tmp/fm2612-working-saved-{source,zip}-*.json` and matching directories;
the tracked checker can reproduce them after a reboot.

Reproduce:

```sh
node --test docs/synth/*.test.mjs scripts/package_itch_synth.test.mjs
node --test packages/virtual-files/tests/*.test.mjs
node scripts/check_synth_working_saved_browser.cjs --editor=fallback
node scripts/check_synth_working_saved_browser.cjs --editor=monaco
```
