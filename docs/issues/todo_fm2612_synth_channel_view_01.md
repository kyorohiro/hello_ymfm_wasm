# FM2612 Synth: persistent chip/channel selection

- [x] Move Live/channel controls out of the VGM-only container.
- [x] Add child tabs under the existing chip tabs: Auto / YM2612 CH1–6,
      PSG Tone1–3/Noise, RF5C164 CH1–8. Remember each chip's full selection.
- [x] Support the selected physical channel for normal keyboard and Code:
      coherent written-state display, sparse editing and keyboard routing.
- [x] Keep Live Off a frozen display and preserve authored presets, running
      Code/context/FX and existing VGM/Pause/Copy/seek/Mixer behavior.
- [x] Verify Node tests and actual WASM in muted Chromium/WebKit; keep readable
      package source and update documentation/verification.

## Findings

`synth_song_controls.js` hides the complete transport container when `/vgm/`
contains no songs, and forces Synth when no song is selected. The PSG/PCM lists
exist, but require choosing their chip tabs first. A DOM move alone would not
provide physical-channel behavior outside VGM playback.

## Verification

Complete: 620/620 Node tests pass. Final D passes 11 browser suites in both
Chromium and WebKit (22 runs): the new channel view, standard ZIP smoke, FM/PSG/
PCM manual VGM controls, Code keyboard, Code preset changes, Seek, FM Live,
PCM Live and Mixer. These cover actual finite/nonzero PCM, custom RAM, frozen
sparse edits, stale releases, per-chip Auto, VGM/Pause/Copy and 390px layout.
All browser destinations were muted before app JavaScript, with Chromium also
using `--mute-audio`. No physical output or human listening was performed.

Candidate D: `release/hello_ymfm_wasm_channel-view-20261113d_itch_synth.zip`.
292 files match the stage byte-for-byte and ZIP CRC checks pass. D fixes a
regression found by the PCM Live checker: selecting PCM/PSG with a remembered
Auto during VGM could invoke the obsolete global author fallback and bounce
back to FM. The chosen chip now stays selected and restores its own authored
bank. Twelve real-function VM combinations and both browsers cover this handoff.
Recording guidance also says "choose Auto". Only `synth.js` differs from C; all
endpoints, gain calibration and DSP files are byte-identical. Detailed logs:
`build/verification/fm-channel-view-20261113/`.

Record: [verification_fm2612_synth_channel_view_20261113.json](verification_fm2612_synth_channel_view_20261113.json).
No commit, push or publication was performed.

## Implementation

`synth_song_controls.js` owns the persistent child row, Normal/Code/VGM badge,
per-chip selection, separate source/frozen snapshots and bounded polling. Auto
keeps the authored instrument and automatic keyboard allocation. Selecting a
physical CH never copies presets or collapses channel differences.

`synth_fm_edits.js`, `synth_psg_audio.js` and `synth_pcm_audio.js` observe writes
through the existing endpoints and reuse the reference interaction helpers for
packed edits and gate/pitch ownership. The shared `synth_local_channel_voice.js`
retains each channel's actual OP mask, CH3 ratios, Noise clock and PCM RAM.
PCM absolute RAM is observed only after its transfer ACK; raw register and
semantic key commands keep the CH/RAM cursors and logical gate masks coherent.

Live Off overlays only deliberately touched fields. Code's later writes retain
priority, and a separate Code ownership claim protects hand-held notes from an
older Code Off. No extra sound chip or native/public SDK API was introduced.
Physical views are session state; Auto holds the saved instrument. Copy remains
the paused-VGM import operation. Worklet-scheduled future writes/internal
envelopes are outside the Main-thread written-state observation.
