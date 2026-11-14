# SNES SPC live channels — 2026-11-15

Added Playback channels inside Sounds from SPC. Eight stable rows show sampled ENVX / OUTX activity, signed voice L / R volume, PITCH, SRCN and Noise / PMON / Echo flags. Muted channels remain inspectable. Polling runs about five times per second only while playing; Pause freezes the display, Seek refreshes the destination and Stop shows the initial snapshot. Mobile rows become cards with a visible Load sound action.

Load sound captures fresh atomic RAM / DSP and imports the selected channel through the existing validated preset path, using the Echo / FIR and PMON pair options. Snapshot BRR bytes, channel tuning and envelopes are materialized into the editable preset. Unsupported samples or PMON pairs retain their reason and the edited instrument. Newer edits and transport / source changes supersede pending captures. The initial-file candidate list remains independent; ordinary display updates never change the instrument.

The implementation reuses existing SPC snapshot APIs and the common AudioContext / Master. No shared runtime, WASM, SDK, Tauri adapter, Menu or output route is added. Event Rec and event JSON remain excluded. These sampled values are not a complete note history or loudness meter, and an analysis snapshot is not a restorable emulator state. Imported envelopes restart on keyboard key-on, with the existing BRR / Echo / PMON limitations.

Validation: 160 Node tests passed. Final ZIP passed Chromium / WebKit tests for actual SPC700 DSP writes, fresh BRR export equality, keyboard audition, Pause / Seek / Mute, unsupported-channel errors, delayed capture cancellation, PMON / Echo / Noise, source replacement and mobile layout. Existing SPC / Code / keyboard and Looper regressions passed. Mocked Tauri Native PCM / Web route switching passed in both engines. All physical output was muted; no listening or physical CPAL device test was performed.

See [verification receipt](verification_snes_spc_live_channels_20261115.json). Review ZIP, screenshots and logs are in ignored `build/verification/snes-spc-live-20261115/`. No commit, push, tag, release or Tauri dist import was performed.
