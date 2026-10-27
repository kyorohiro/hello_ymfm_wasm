# Atari POKEY VGM Analyzer integration

The Analyzer detects and plays one or two POKEYs, with four independent
physical channels per chip. Operator Info shows their written register state,
shared clock/join/filter settings, distortion, volume-only output and timer
frequency. Each chip has its own Mixer strip; the output channel controls
address all four or eight channels separately.

## Format and playback

VGM 1.61+ stores the POKEY clock at header offset `0xb0`; bit 30 selects two
chips. Opcode `0xbb` uses bit 7 of the register byte to select the second chip.
Standard DAC streams with chip types `0x1e` / `0x9e` write one register/data
byte at a time. Their port field is unused. These paths share the existing
stream scheduling, cancellation, reverse and loop machinery.

The shared parser/player additions are in canonical `web/ym2612vgm.js` and
`web/vgmplayer.js`, mirrored into the website. Analyzer playback uses
`pokey_playback.js`: independent sound-core handles and DC filters, with one
shared WASM module allocation. Mixer IDs are `pokey` and `pokey:2`; defaults
are explicitly uncalibrated unity, without a hidden dual-chip attenuation.
The CLI provides `pokey-ch-1`–`pokey-ch-4`, or up to `pokey-ch-8` for dual
files. Channels 5–8 belong to the second chip.

Playback preserves polynomial noise, joined channels, high clocks, filters,
volume-only output and stream timing. The monitor displays estimated pitch
only for an unfiltered pure square tone, and labels other modes explicitly.
Monitoring mute leaves the core's timers running and survives replay/seek.
Seek replays from the beginning, restoring both chips and their speaker DC
state; no checkpoint cache is advertised. POKEY also routes independently
inside the existing header-composed mixed engine.

The UI updates the register shadow from audio writes and renders on the
existing view schedule. It adds no polling loop or UI-to-audio writeback.
Song analysis, score/MIDI/sample export and FM voice conversion are disabled
for POKEY. No claim is made about reconstruction of instruments or analog
Atari board filtering. The SDK/core/WASM binaries are unchanged from the
previous POKEY integration.

## Distribution

The flat Analyzer ZIP and npm VGM staging include the POKEY JS/WASM files,
BSD notices, upstream/adapted source and rebuild recipe. npm staging retains
the published version number `0.2.15` during development; public npm 0.2.15
does **not** contain POKEY. No publication, tag, commit or push is performed.
Cache identity `pokey-vgm-1` rolls out the parser/player and Analyzer UI graph
together; canonical package class imports remain unchanged.

Existing Analyzer levels were actually remeasured because the source guard
changed: 18 Extra and 12 PSG captures match the previous PCM hashes and levels
exactly. Strict provenance checks remain active. Details are in
[analyzer_mixer_calibration_refresh_03.md](analyzer_mixer_calibration_refresh_03.md).

Verification passed:

- Shared parser/player and Analyzer regression run: 1,150 passed, one existing
  optional-tool test skipped, no failures. The focused real-WASM playback,
  dual PCM sum, mute/replay, seek and mixed-engine tests also passed.
- Chromium and WebKit: single 4CH and dual 8CH routing, each channel's mute,
  visible Operator Info and live updates, independent Mixer volume/pan/mute,
  DAC streams, pause, seek, Stop and replay. Both docs and final flat builds
  passed; final tone scenes reported no underruns or page errors.
- All 193 Browser-served asset hashes match the final ZIP. All ZIP members
  match staging, and the Analyzer Tauri importer verified all 421 payload
  files against its lock. Its six Python and four Desktop Origin tests passed.
- The unpublished VGM npm candidate passed an isolated offline consumer:
  all 277 files match staging and installation; 168 modules import; API/CLI
  analysis, support, lossless JSON, gzip, all 12 channel routes, mute, WAV,
  stream/noise seek, independent Mixer and lifecycle checks passed. See
  [atari_pokey_vgm_package_01.md](atari_pokey_vgm_package_01.md).
- The FM package also rebuilt its shared parser successfully: 302 modules,
  28 WASM pairs and 349 declarations, with NodeNext/Bundler/DOM-only types.

The final ZIP is
`release/hello_ymfm_wasm_pokey-vgm-dev_itch_vgm_analyzer.zip`, SHA-256
`415eca667067e9df6678d6c650f4f87e3739c53977df67d22caf508df7d7e2d7`.
Archive, Browser, Tauri and source-hash evidence is recorded in
[atari_pokey_vgm_analyzer_01.json](atari_pokey_vgm_analyzer_01.json).
Automatic Browser measurements use a muted physical sink; human listening and
comparison with Atari hardware are separate checks.

## References

- [Original VGM specification](https://raw.githubusercontent.com/vgmrips/vgmplay-legacy/master/VGMPlay/vgmspec171.txt)
- [libvgm command handlers](https://raw.githubusercontent.com/ValleyBell/libvgm/master/player/vgmplayer_cmdhandler.cpp)
- [libvgm DAC stream implementation](https://raw.githubusercontent.com/ValleyBell/libvgm/master/emu/dac_control.c)
