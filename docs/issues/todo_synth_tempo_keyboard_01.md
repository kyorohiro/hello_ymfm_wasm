# Synth examples: tempo-aware music and keyboard in Code view

Started: 2026-11-14.

- [x] Inventory the default and bundled Synth examples and corresponding docs.
- [x] Use beat() for musical note lengths and rests, so setBpm() changes the
      full performance. Preserve the initial duration at each example's default
      BPM where practical; do not replace wall-clock infrastructure waits or
      fixed media durations indiscriminately. Inspect FM2612, HuC6280 and other
      Synths, and keep SID's deliberately independent modulation periods clear.
- [x] Enable physical musical keyboard input in Code view outside text editors,
      text/number inputs, selects and dialogs. Check all Synths with Code mode;
      preserve Code execution, focus safety, key-up/blur cleanup and ownership.
- [x] Run appropriate existing checks and meaningful focus/keyboard regressions,
      with physical audio output muted. Verify relevant packaged/browser paths.
- [x] Update docs and the continuation record. Do not overwrite existing user
      index.js files, cassette projects, or saved examples when defaults change.

No commit/push, release/tag or Tauri import is requested by this task.

Completed: 2026-11-14.

- FM2612, HuC6280, DMG and SPU starters now use beats for musical waits;
  related README examples and the HuC6280 CD-DA repeat example follow BPM too.
  At 120 BPM, 0.1 seconds becomes 0.2 beats and 0.12 seconds becomes 0.24 beats.
  SID's melody already used beats; its independent 2-second modulation and
  4-second filter motions remain in seconds. Media sample rates remain fixed.
- All five Code-enabled Synths accept musical computer keys outside typing
  controls. Code-tab selection keeps performance focus; explicit editing still
  focuses the editor. View changes preserve held manual notes and running Code.
  Stop leaves Code view playable. Run/Apply/Stop shortcuts, text input, key-up,
  blur, owner fencing and output transitions remain covered by regressions.
- Final Node run: 270 passed, 0 failed, 0 skipped, including five package checks.
  Packaged Chromium/WebKit runs: five Synths, 10 runs, 90 check groups passed.
  Physical output was muted throughout; no listening or long-duration test.
  Browser checks use the textarea fallback and protected editor containers;
  they do not validate the downloaded Monaco engine itself.
- Existing saved index.js, cassette projects and examples are preserved.
  Replace musical sleep() calls manually in existing projects when desired.
- The initial SPU browser failure compared a preset baseline taken before the
  new manual-key test changed pitch. The checker now captures its full baseline
  after that test; preset equality assertions remain intact. Product code and
  ZIPs were unchanged for that correction. The failed receipt is retained.

Durable verification: [verification_synth_tempo_keyboard_20261114.json](verification_synth_tempo_keyboard_20261114.json).
Local logs, browser receipts and screenshots: build/synth-tempo-keyboard-20261114/.
All checker browser/server processes completed. Tauri, npm, remote Actions and
publishing are outside this task.
