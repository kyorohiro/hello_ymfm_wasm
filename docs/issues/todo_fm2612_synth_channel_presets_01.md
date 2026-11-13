# FM2612 Synth: save selected channel and apply PCM presets

- [x] Add selected physical CH snapshot saving during Normal and Code, alongside
      the existing paused-VGM Copy operation.
- [x] Save a new uniquely named instrument in Files without applying it,
      switching CH/Auto, replacing an old file, stopping Code/song or touching RAM.
- [x] Capture the displayed frozen settings with Live off, or a fresh coherent
      written state with Live on. Support FM/PSG/PCM and preserve format limits.
- [x] Diagnose and fix PCM preset selection that appears not to apply, including
      physical CH views, Auto, Code, built-ins and Files presets.
- [x] Verify snapshots, files and rejection/async ownership in Node; check actual
      WASM and UI with muted Chromium/WebKit; ship readable source in the ZIP.

## Scope

Normal/Code snapshot saving keeps the current performance intact. Existing VGM
Copy remains a paused import into Auto. PCM presets are an explicit author sound
selection; selecting one should show and use the selected sound while retaining
the automatic performance. No physical audio, commit, push or publication.

## Verification

All 642 Synth Node tests pass. The new muted browser checker passes 12 groups
in Chromium and WebKit. Five existing browser suites also pass on both engines:
physical-channel views, Code, manual PCM/VGM controls, VGM Live and standalone
ZIP startup/keyboard audio (12 browser runs in total).

Candidate: `release/hello_ymfm_wasm_channel-presets-20261113b_itch_synth.zip`.
All 292 files match its stage; CRC passes and changed readable sources match
the repository after packaging's path relocation. No physical output or human
listening was performed. No commit, push or publication was performed.

The browser checks also found high-level FM frequency batches bypassing the
written-state observer. The observer now retains one physical batch while
tracking CH3 frequencies, OP masks and ordinary frequency changes. Files and
native seek test waits were made robust without weakening their assertions.

Record: [verification_fm2612_synth_channel_presets_20261113.json](verification_fm2612_synth_channel_presets_20261113.json).
Detailed receipts: `build/verification/fm-channel-presets-20261113/`.
