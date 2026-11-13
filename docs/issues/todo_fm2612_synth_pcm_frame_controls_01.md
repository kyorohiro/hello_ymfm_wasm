# FM2612 Synth: PCM preset lengths and frame control dragging

- [x] Reproduce preset application with short, 256-frame and longer PCM samples;
      distinguish real sample length from fixed UI bounds or stale selection.
- [x] Make Loop Start / Loop End numeric drag bounds and sensitivity follow the
      current sample and valid loop interval, without jumping to the endpoints.
- [x] Preserve preset sample bytes, root/rate and loop settings across selection,
      Auto / physical CH changes, Code, Files and browser reload.
- [x] Treat built-in waveform buttons as separate preset selections, preserving
      the currently selected file instead of overwriting it with a 256-frame shape.
- [x] Inspect the attached Cassette without executing embedded code; recover its
      original PCM from the checkpoint into separate local files.
- [x] Test variable sample lengths and actual pointer dragging in Node and muted
      Chromium / WebKit, then verify the readable standalone package.

## Scope

Fix existing variable-length PCM loading and frame controls first. Built-in
single-cycle shapes contain 256 frames; no sample resizing or hardware RAM limit
change is needed. The user's Cassette has a 9,215-frame checkpoint but the
working preset contains the 256-frame Saw, revealing built-in selection writing
over the active file. Keep ordinary Range/Draw/parameter draft saving intact.
No physical audio, commit, push or publication during automated work.

## Verification

725 Node tests pass, including shared-control clients in SID Synth and Playground.
Five browser suites pass in Chromium and WebKit (10 runs): new PCM frame controls,
PCM Live, Code preset changes, selected-channel preset saving and standalone ZIP
startup/keyboard audio. Every browser destination was muted before app JavaScript.

The new checker uses self-authored 1/128/256/1024/4096/9215-frame PCM samples.
Actual pointer drags produce intermediate values, +/- stays one frame, and bounds
update after length or loop changes. A 9215-frame / 8960..9215-loop fixture stays
unchanged after choosing Saw, can be reselected, and retains its Revert checkpoint.
Code, keyed internal PCM, draft persistence and reload also pass.

Recovery artifacts are under ignored local `build/recovery/fm-pcm-20261113/`:
an original PCM JSON and a recovered Cassette that retains the previous Saw in a
separate file. The input archive was unchanged; its sample/VGM were not executed
or played, and no user sound data was copied into tests or release artifacts.

Candidate: `release/hello_ymfm_wasm_pcm-frames-20261113b_itch_synth.zip`.
All 292 files match the stage, CRC passes, and changed readable source matches
the repository after path relocation. No commit, push or publication performed.

Record: [verification_fm2612_synth_pcm_frames_20261113.json](verification_fm2612_synth_pcm_frames_20261113.json).
Detailed receipts: `build/verification/fm-pcm-frames-20261113/`.
