# PC Engine media keyboard — 2026-11-18

User requested keyboard playback for the authored MSM5205 sample and selected
CD-DA track, alongside the existing shared UI and Code playback sources.

- [x] Add a pure monophonic trigger controller over the current media source.
  MSM5205 uses its selected Rate/Loop; CD-DA restarts the selected track at its
  existing 44.1 kHz rate. Loading remains silent.
- [x] Fence pending starts and release only the latest keyboard-owned playback.
  An old release must preserve newer keys, UI playback and Code playback.
- [x] Retire keyboard work on tab changes, Stop, blur, New and disposal; expose
  held-note state for the existing fretboard integration.
- [x] Verify readiness/release races, retrigger ownership, UI/Code takeover and
  cancellation with focused pure tests before browser integration.
- [x] Verify computer and screen keys, overlap/release and UI/Code handoffs
  through real permanently muted browser source and extracted ZIP runs.

Use the existing media source/player instances. No native/WASM, FX, menu or
gain changes, commit, push or publication are included in this controller task.

The source-owned `playbackGeneration` advances on accepted Play and validated
takeovers; polls, playback defaults and rejected preparation retain ownership.
The app-only conditional Stop preserves unrelated pending UI preparation and
does not appear on Code clients. Main owns the keyboard/tab/lifecycle wiring.

Focused controller and real shared-player/WASM source tests: **76/76 passed**.
Evidence: `build/pce-opna-refinement-20261118/pce-media-keyboard-tests.log`.

Final computer/screen keyboard, held-readiness cancellation, UI/Code ownership,
tab/blur/Stop/New cleanup and original-rate checks passed in Chromium / WebKit
on both source and actual extracted ZIP. See [the combined verification](verification_pce_opna_refinements_20261118.md).
