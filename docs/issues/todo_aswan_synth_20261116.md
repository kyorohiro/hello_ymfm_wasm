# Tetorica ASWAN Synth

Product identifier: `tetorica-aswan-synth`; browser entry: `docs/synth-aswan/`.
Use HuC6280 Synth's layout and shared Code/Files components, with the existing
WonderSwan WASM/API. Keep other Synths and their imported projects unchanged.

## Adopted icon follow-up

- [x] Preserve the approved PNG and convert it to 1254×1254 sRGB WebP, matching
      the other Synth assets without changing the approved design.
- [x] Replace the CSS placeholder in the header, add favicon/touch-icon links,
      and use the same artwork on the Sound Laboratory product card.
- [x] Include the icon in standalone root/nested entries and source receipts.
- [x] Verify image dimensions, package references and desktop/mobile rendering
      in muted browsers. No commit, push, tag or publication.

Icon verification: two packaging tests and 16 browser/layout checks passed.
See [icon verification](verification_aswan_icon_20261116.json).

## Initial implementation

- [x] Inspect WonderSwan authoring, VGM extraction/playback, mixer calibration,
      and the current HuC6280 UI/Code/Files contracts.
- [x] Add four physical channels and Auto keyboard allocation, 32-point 4-bit
      wave drawing, stereo channel volumes, CH3 hardware Sweep and CH4 Noise.
      Keep wave edits audible without releasing held notes.
- [x] Add CH2 Voice PCM with explicitly software-fed playback; preserve hardware
      channel restrictions and distinguish software Envelope/FX from hardware.
- [x] Add Keyboard/Code, Run/Apply/Stop, Monaco declarations and source links,
      common Files/presets/Cassette recovery, hamburger import/export menu.
      Code and manual editing/keyboard share the same chip; tab changes and
      preset edits keep Code running. Melody examples use beat().
- [x] Add VGM/VGZ import, sound extraction to Files, reference playback and
      selected-channel Live display. Keep playback failures transactional and
      limitations explicit; no game music is bundled.
- [x] Match shared gain policy and monitor the post-Master stereo output.
- [x] Add readable standalone ZIP packaging, source/license kit, discovery links,
      focused tests and CI. Check actual WASM output and muted browser behavior.
- [x] Record implemented scope, verification and remaining work here.

No commit, push, tag, npm publication or external release. No Tauri app in this
task. Use self-authored test music and fresh browser storage; keep physical
audio muted during automated checks. The approved ASWAN artwork is retained as
a PNG original and a 1254×1254 WebP used by the app, catalogue and ZIP.

## Verification and remaining work

- `npm run test:aswan-synth`: 104 tests passed, including real WASM,
  AudioWorklet-subset globals, async ownership, types, Files and packaging.
- Shared Monaco navigation and batch-packaging tests: 32 passed.
- Source application: Chromium / WebKit, five check groups each.
- The actual standalone ZIP: Chromium / WebKit, five check groups each,
  including paused Seek and changing songs without resuming the old source.
- Exactly one live AudioContext and destination, physical gain zero throughout;
  no app errors or missing local assets. PCM is finite and nonzero in all modes.
- Reviewed desktop and 390px layouts. Monitor axes resize to the available width.
- Browser assets remain readable modules; original native sources and licenses
  accompany the two binaries (WonderSwan and host software FX).

Try `/synth-aswan/index.html` on the normal docs server, or package with
`sh scripts/package_itch_aswan_synth.sh VERSION`.

Human listening and real-game VGM checks remain. Narrow Envelope plot header
labels can be polished further. The
[paused-channel follow-up](todo_aswan_paused_audition_20261116.md) adds
Wave / Sweep / Noise audition and sparse edits while keeping Auto and the song
position. The [live manual follow-up](todo_aswan_live_manual_20261116.md)
also adds direct edits and keyboard input while the VGM continues.
Transient Voice DAC bytes cannot be captured as a fake sample;
use the recorded PCM extraction path. Hardware speaker output, HyperVoice, DMA,
a full console CPU, Tauri, Looper and Event Rec are outside this initial slice.

See [verification](verification_aswan_synth_20261116.json). No publication.
