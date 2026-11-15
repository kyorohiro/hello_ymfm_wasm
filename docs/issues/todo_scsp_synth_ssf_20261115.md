# SCSP Synth SSF / MiniSSF playback

Requested 2026-11-15. Add Saturn sound-program playback to the existing SCSP
Synth song controls. Keep the current Code / keyboard workflow usable.

## Plan

- [x] Inspect available SSF players, licenses and browser build feasibility.
- [x] Select a sound-CPU / SCSP engine and record its source provenance.
- [x] Read SSF / MiniSSF containers, metadata and dependency libraries from a
      folder. Resolve relative paths and report missing dependencies clearly.
- [x] Execute the 68000, SCSP and required timing / interrupts to produce PCM.
- [x] Connect the engine to the existing shared Master and song transport.
- [x] Import a folder through Menu and retain original files in Files.
- [x] Preserve source replacement, Pause / Resume, Stop and Code exclusion.
- [x] Exercise generated fixtures and available real recordings with muted
      physical output in Chromium / WebKit.
- [x] Include readable frontend and engine source / licenses in the ZIP.
- [x] Update the guide and automated checks with actual supported scope.
- [ ] Listen to real songs and compare a longer playback with a reference
      player. Automated checks measure PCM with physical output muted.
- [ ] Run the updated GitHub workflow after committing and pushing.

Song-slot Live editing / capture and DSP assembler work are follow-up tasks.

## Implemented scope

Menu → SSF folder imports related files beneath `ssf/` with their folder
hierarchy. The existing song selector lists SSF / MiniSSF and VGM recordings.
Libraries stay in Files as dependencies. A `.ssf` with `_lib` tags is treated
as a MiniSSF-style song. Individual files can also be selected together.

The browser verifies PSF version 0x11, compressed CRC, zlib data, load ranges,
relative paths, recursion and cancellation before committing a source. The
primary library loads before the entry, followed by ordered auxiliary
libraries. Missing or invalid required files preserve the previous loaded
song. Unrelated broken entries can remain in Files while valid songs load.
Editing or removing an active dependency invalidates that source. Unrelated
Code / library edits leave the selected song available.

The sound machine uses ssfplay_tools commit
`a28e0d7e14a3dc04a486ea26f30bc52edad3dc4d`, based on Mednafen 1.32.1,
under GPL-2.0-or-later. Pinned zlib 1.3.2 retains its zlib license. The
original source hashes and copyright notices are in `third_party/ssfplay/`.
The Tetorica C ABI wrapper is GPL-2.0-or-later. The current Synth authoring
core and SSF song machine have independent state and RAM. They share the
existing AudioContext and final Master output. Each song / seek candidate
uses an independent WASM instance because the upstream native state is global
within a module.

Pause preserves native state and unconsumed scheduled PCM. Resume continues
from the same audible position. Seek rebuilds and executes from the reset
state. Length, fade and relative volume tags apply in the renderer. A missing
or invalid length uses a 180-second preview with a visible message. Starting
the song stops Code, and Run stops the song. The keyboard continues to play
the authored instrument. Read-only song-slot Live inspection was subsequently
implemented in [SSF Live view](todo_scsp_synth_ssf_live_20261115.md). Song-slot
editing, Capture and selected-slot keyboard audition remain follow-up tasks.

The existing Files project limit is 12 MiB. The standalone loader accepts up
to 512 supplied files, 4 MiB per file, 64 MiB per set and 32 MiB of expanded
dependency programs. Each resulting sound RAM image is 512 KiB. Native render
blocks are bounded, and the common transport retains a short PCM lookahead.

## Verification recorded 2026-11-15

- 106 SCSP unit / actual-WASM / packaging tests passed.
- 107 mixer-calibration tests and the SCSP source-navigation receipt check
  passed.
- All 12 local Can Can Bunny songs composed with their shared SSFLib and
  rendered three seconds of finite nonzero PCM with the final WASM.
- The actual ZIP was independently extracted. SSF, Code / Files and VGM
  browser runners passed Chromium and WebKit with gain-zero physical output.
  The real 12-song corpus also passed brief playback / Stop checks in both
  browsers. Full-track reference comparison and long-running listening remain
  pending above.
- The original fixture executes a documented 68000 program that sets up
  SCSP sine PCM. Its MiniSSF patches a pitch instruction in a shared library.
  Browser native-buffer measurements changed from 689.0625 to 344.53125 Hz.
- SSF UI checks cover folder / file imports, original bytes, hidden library
  entries, exact Master zero, Pause / Resume, seek / Stop / natural end,
  Code switching, keyboard audition, failed replacement / recovery and
  silent reload. 1240 px / 390 px layouts have zero horizontal overflow.
- Final extracted-ZIP regression checks also passed both browsers for the
  existing PCM / FM / LFO / Delay, Code / Files, VGM and actual Monaco with
  its fallback. A long native WebKit select placeholder had propagated text
  outside its measured box. Clipping that select's text resolved the 15 px
  overflow after desktop-to-narrow resize and Code restore.
- The ZIP contains 345 files, readable browser modules and the complete SSF
  source kit under `sources/ssf-player/`, including native wrapper, CMake
  configuration, pinned sources, zlib and licenses.
- Building only from that extracted kit with fresh output / build / cache
  folders succeeded under restricted networking. The resulting JavaScript
  and WASM matched the distributed bytes exactly. Rebuilt and shipped engines
  generated byte-identical PCM for the original 99,225-frame fixture.
- Final WASM SHA-256 is
  `39e2a2825053870731626aeae0f6ffc4406ecb1b68067a3c1d62a7c7ee348f63`.

## Commands

```sh
npm run test:scsp-synth
npm run test:scsp-synth:ssf-browser
npm run test:scsp-synth:ssf-browser -- --real-set="ww/Can Can Bunny Premiere 2 (EMU).zophar"
npm run build:ssf-player
```

The browser command's real-set option reads local recordings for verification.
The fixture source and distribution contain original demonstration material.

[SSF engine upstream](https://github.com/niekvlessert/ssfplay_tools),
[Mednafen SSF documentation](https://mednafen.github.io/documentation/ssfplay.html)
and [PSF / SSF format](https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e).
