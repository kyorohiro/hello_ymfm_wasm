# DMG working/saved rollout — 2026-11-20

Authorized by the user after the SMSGEAR release. First complete the saving / document-editing slice, following HuC6280 and SPU. The expanded Code layout and timed register API remain separate next slices; no new recording, chip renderer, mixer policy or PCM abstraction is included here.

- [x] Adopt the existing Virtual Files working/saved workspace and migrate v1 DMG projects / Cassette ZIPs without rewriting original preset, VGM, opaque or unrelated text bytes.
- [x] Add default-on Auto apply, Files dots, Save / Save all / Discard / Discard all and Ctrl/Cmd+S. Accepting in memory is separate from storage durability.
- [x] Link the active valid sound JSON to the knobs and CH3 Wave drawing. Preserve source-mode differences, physical-channel session edits, sweep allocation and note/Gate ownership.
- [x] Auto apply Off retains working sound/Code edits until Save; invalid/incomplete JSON stays editable and never replaces a valid sound.
- [x] Explicit Run/Apply reads saved entry, imported modules and data. Save never runs Code, and ordinary file/sound edits preserve active loops, context, FX and VGM position. Stop restores accepted author settings.
- [x] Preserve both versions through selection, rename/delete, history, New Cassette, import/export, reload and recovery. Keep unchanged binary song files once. Preserve native backup cancellation.
- [x] Verify Pulse / CH1 sweep / Wave / Noise, Code/manual/VGM interaction, old-project migration, failure atomicity, journal/quota recovery, keyboard focus and actual readable ZIPs using physically muted Chromium/WebKit (Monaco and fallback).
- [x] Record actual validation and update the DMG alignment checklist. No npm publication, Tauri import, commit/push, tag or release is requested.

## Implemented behavior

Files starts with Auto apply On. Turn it Off to edit an instrument JSON,
its Auto controls or Wave RAM drawing without changing the accepted sound.
Files shows **●** on modified paths; Save (Ctrl/Cmd+S) accepts the selected
file, Save all accepts all files, and Discard restores the saved version.
Neither Save nor choosing a source file executes JavaScript. Explicit Run/Apply
uses saved entry/module/data bytes. Selecting a JSON file does not switch
Keyboard to Code.

Numbered CH controls remain physical session edits and do not rewrite the
authored Auto document. Saving an unrelated author field keeps these channel
differences, active Code/context/FX and Gate/frequency ownership. A CH3 Wave RAM
upload retains its documented DAC stop/retrigger behavior, but does not stop
held Pulse or Noise channels. Envelope/Sweep initial settings still take effect
at the next trigger. Raw chip APIs and mixer gain policy are unchanged.
An explicit **＋ Instrument** still takes a snapshot of the selected physical
channel (or the Auto sound), saves it as a new linked document and adopts it
after native acceptance. Detached batch/export saves remain passive.

Menu → New → Cassette starts with the normal sound and starter Code. New and
Import offer a backup before replacement; canceling the native save retains
the current workspace. Files context menu offers history Undo without adding
another toolbar button. ZIP normal entries contain saved bytes, with compact
working recovery metadata; unchanged original binary songs are stored once.

## Completed validation

- Node: `node --test docs/synth-dmg/*.test.mjs scripts/package_itch_dmg_synth.test.mjs`
  — **318/318 passed**; includes real APU at 44.1/48 kHz, native ownership,
  delayed ACK/Stop/manual-edit races, candidate Save/Auto acceptance failure,
  v1 migration, both-version recovery/size limits and readable packaging.
- Browser runner: `scripts/check_dmg_working_saved_browser.cjs`; records local
  source hashes, real register/PCM measurements and permanently muted physical
  output. Final source/extracted-ZIP × Chromium/WebKit × real Monaco/fallback:
  **8/8 cases, 72 stage checks passed**. Both 1360px and 390px layouts fit,
  including the existing Code expansion and restoration. Nonzero paused VGM
  positions (6,379–9,672 frames) remain exact through selection and saving.
  Pulse/Wave PCM and Wave bytes stay unchanged while edits are pending; Save
  changes the accepted signal and Noise clock while keeping independent
  frequency, Gate ownership, context, named loops and software FX alive.
- Authoritative browser evidence:
  `build/dmg-working-saved-20261120/final/browser-matrix.json` and its four
  detailed receipts. No missing application resources, external requests,
  unexpected console errors, page errors or unhandled rejections. Earlier
  non-final runs in the parent evidence directory are excluded from signoff.
- Evidence: `build/dmg-working-saved-20261120/`. Monaco 0.52.2 is loaded from the
  existing npm cache; the browser test makes no dependency-CDN requests.
- Final readable ZIP: `build/dmg-working-saved-20261120/package/tetorica_dmg_synth_working_saved_20261120_r3_itch.zip`
  (136 files; SHA-256 `80d6d5e329a799eb22de8b69291b0208f3930d2acced961fa8493eec3728ce27`).
  Test extraction is `build/dmg-working-saved-20261120/extracted-zip-final/`.
  All 120 original-input receipts still match source; all 136 extracted files
  match the packaged stage, including 87 readable JavaScript modules.
- `git diff --check` passed. Browser checks use real APU output measurements;
  physical listening remains a human check. No remote CI or publication was run.

Persistent expanded Code navigation, common channel switches, Live highlighting
and timed register APIs remain on the separate alignment checklist.
