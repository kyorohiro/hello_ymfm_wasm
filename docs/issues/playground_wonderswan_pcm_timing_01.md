# WonderSwan import: render dense Voice PCM at authored sample times

Date: 2026-10-27. Follows [large Voice PCM imports](playground_wonderswan_vgm_import_large_01.md).

## Report and cause

The large song could be imported, but playback sounded broken. The previous
checks established ordered data preservation, nonzero audio and Stop behavior;
they did not establish sample-boundary playback fidelity.

The source uses CH2 Voice PCM, not a changing 32-sample wave RAM instrument.
There are 1,151,160 writes to 0x89, spaced by three or four 44100-Hz source
samples. Parsing preserves these values and times. However, a JavaScript
`createTimeline().waitUntil()` call only resumes JavaScript. It does not reserve
that time in the audio renderer. Immediate writes can arrive in the same audio
quantum and overwrite held PCM values before they have sounded. Worker
lookahead timestamps based on actual dispatch time cannot recover the lost
source intervals.

Analyzer's Wave RAM extraction deliberately excludes Voice PCM. Missing wave
captures therefore did not demonstrate a PCM decoder failure. Timed Voice PCM
sample extraction remains a separate feature.

## Change

`ws.createTimeline({clock, pcmData})` creates an offline builder using the same
raw and high-level WonderSwan authoring methods. `score.at(sample)` advances
the absolute 44100-Hz source position; `score.pcm(...)` appends a packed run.
No sound commands are sent while building the score.

Generated imports call `await ws.prepareTimeline(score.finish(duration))`,
then `await ws.playTimeline()`. Registers, physical RAM and packed Voice PCM
share one ordered trace. The audio renderer traverses that trace without
expanding the song into millions of scheduled command objects. Source sample
positions map to output frames with `ceil(sample * outputRate / 44100)`.
Playback completion is acknowledged after rendering, rather than immediately
after accepting the start request. The generated `finally` then disposes the
owned chip.

Web Audio and Native use the same schema and independent compact cursors.
Prepare validates owned data before replacing the loaded score. Stop, reset,
disposal, owner cancellation and session replacement cancel pending/active
playback. Manual voice edits and clock changes are fenced while playback is
active or its start is reserved. Source cores, SDK snapshots, WASM binaries
and Mixer levels are unchanged.

The prepared payload and event headers have an 8 MiB admission budget. PCM
validation work is also bounded when ranges are reused. A write-density bound
rejects pathological bursts before playback. These guards do not drop writes
or resample the original PCM values.

## Validation

The complete local song was rebuilt in Raw, Readable and High styles. All
1,151,363 register/RAM operations retain the original ordered trace hash:

`da5772eadf630cabbe1120d1d79219c22055e8ef64b7e44bdc0baa04e4651ada`.

All styles retain 204 event/run rows and 2,302,320 packed bytes. Packed data SHA256:
`21edb1bddf365732e110a9260b294a07ab34336d01b628684d7c83776ad7cd2f`.

The converter/builder/core checks passed (50 tests), the complete Playground
suite passed (1,138 tests), and all mode declarations passed. Focused Web
Worklet checks passed (41 tests), including direct real-WASM PCM equality at
44.1/48 kHz, ordinary Wave/RAM, Noise/Sweep, nonstandard clocks, replay,
late-created chips, performance lead, cancellation and manual auditions.
Scheduler checks passed (78 tests).

The final standalone ZIP passed Chromium 153 and WebKit 26.6 checks. For each
browser, all Raw/Readable/High × Main/Worker combinations had **zero sample
differences** against an independent direct audio-engine reference:

- Original synthetic 12 kHz PCM: 31,200 frames/channel, including the silent end.
- The reported local song: its first 24,000 frames/channel (0.5 seconds).

Both browsers also passed Wave CH1–4, Noise, Sweep, Voice, Genesis additional
chip, repeated Run, unsupported input, cancellation, Stop and disposal checks.
All 266 served files match the tested ZIP. Focused Docs WebKit checks also
passed, with all 257 served source hashes verified.

Native checks passed: 87 JavaScript tests, all 747 active Tauri Cargo tests
(four existing ignored tests), and exact real-core PCM comparisons at
44.1/48 kHz. Two local-port MCP tests needed a retry with local-network
permission. Frontend import checks and Tauri's 22 Python / 31 Node tests passed.
The 922-file frontend and 1,864-file corresponding application source archive
were regenerated; all 22 fixed Native snapshots and 395 SDK files verify.

Receipts, reference-input hashes and artifact hashes are preserved in
[playground_wonderswan_pcm_timing_01.json](playground_wonderswan_pcm_timing_01.json).
The development Playground ZIP is
`release/hello_ymfm_wasm_wonderswan-pcm-dev_itch_playground.zip`, SHA256
`7c37e1b8e986989f356073a844496be5170b06f599fc0b30ee0194cb33b90391`.
The Synth package is also regenerated. Cache revisions are
`wonderswan-import-3` and `wonderswan-pcm-timeline-1`.

No source music or captured song PCM is included in the repository or
distribution. Captures were measured before a muted physical output. Human
listening, full-song Native playback and hardware comparison were not
performed. No npm/version/tag/commit/push/CI action was performed.

## Use the corrected import

Reload the updated Playground and import the original VGM/VGZ again. Previously
saved JavaScript still contains the old per-byte timer loop and is not rewritten
automatically. Keep the generated JavaScript and its PCM `.dat` asset together
when saving the Cassette.
