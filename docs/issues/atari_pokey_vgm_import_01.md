# POKEY VGM import for Playground

Playground imports a POKEY-only VGM/VGZ into an editable, one-pass score.
Both a single four-channel chip and two independent POKEYs are supported.
The import dialog offers raw writes, writes with explanations, and high-level
operations with exact-register fallback. The source clock is retained; the
selected mode's primary instruments are not reset or retuned by the import.

## Playback and authoring

The generated code creates one owned `createSoundChip('pokey', {clock})` per
recorded chip. It builds and prepares each score before starting playback.
Both chips use the same absolute audio `startFrame`. A fresh core and speaker
filter reset occurs at that frame, rather than earlier while data is uploaded.
Completion, Stop, owner cancellation, reset, disposal and replacement Run all
release the playback reservation. Partially created chips are disposed if
preparation fails.

`createTimeline()` is an offline builder: `at(sample)` selects an original
44100 Hz VGM sample position, and the usual register/Synth operations collect
writes without sounding the device. `adoptRegisterState()` enables authoring
without inserting setup writes. High-level conversion is used only when it
emits the same register bytes in the same order; shared controls, joined pairs,
STIMER, polynomial selection and all remaining writes retain raw fallback.

Standard DAC stream types `0x1e` / `0x9e` are expanded using the existing VGM
parser's scheduling. Their register events are packed into one binary sidecar
for both chips, avoiding a JavaScript line for each PCM byte. Ordinary-only
imports need no sidecar. Packed records use a canonical unsigned delta followed
by register and byte; they preserve same-time order independently for each chip.
The builder validates a complete packed run before modifying its score.

The Browser Worklet and Native audio callback consume a prepared cursor. They
do not receive one JavaScript RPC or timer per event. Original sample positions
are mapped to output frames using `ceil(sample * sampleRate / 44100)` at both
44.1 and 48 kHz. This is a direct host-rate rendering contract, not a claim of
identical output to the Analyzer's 44.1 kHz rendering followed by resampling.
At 44.1 kHz the source-player and timeline boundaries coincide exactly.

The renderer reuses its decode state and channel buffers. No additional UI
polling or view-to-audio writeback is introduced. Manual audition, fixed-clock
checks and ownership rules remain enforced. Native control-side completion
checks use status snapshots; audio generation and event timing stay in the
Native callback.

At the completion of this import step, Browser preparation validated and copied
the complete trace on the Worklet thread. A local warm Node timing check took
about 32–35 ms for an 8 MiB / 2.8-million-write trace; this was not a Browser
deadline guarantee. Generated imports prepared while their owned chips were
silent, then started after all acknowledgements. Preparing a large score while
other chips were playing could still interrupt their audio: the render cursor's
per-quantum limit did not bound preparation cost. The subsequent
[incremental preparation change](pokey_timeline_prepare_01.md) addresses this
limitation with bounded upload and validation.

## Bounds and unsupported input

Before enabling conversion, the complete stream is checked for mixed chips,
variant flags, undeclared second-chip access, invalid registers, unsupported
commands/banks, malformed/truncated data and invalid DAC stream setup. Accepted
input is limited to 16 MiB, prepared conversion data to 8 MiB, generated source
to 64 MiB and time to unsigned 32-bit VGM samples. Bank-copy work and recursive
metadata processing have separate bounds. Prepared playback rejects more than
512 writes in any rolling 128 output frames, as well as excessive same-sample
writes. Data uploads are bounded and owned on both Browser and Native paths.

Playback is one pass. Source loop offsets are not repeated. External I/O,
mixed-chip conversion, instrument reconstruction and analog Atari board
filtering are not added here. Existing POKEY speaker DC correction and explicit
unity Mixer defaults are retained. Other chip gains, SDK/core and generated
WASM binaries are unchanged.

## Verification and distribution

Source tests execute the generated scores against an independent parser trace,
including all three styles, ordinary/dense streams, one/two chips, same-time
joined writes, reverse/fast streams, bounds and failure cleanup. The real Native
and WASM renderers match exactly in the focused delayed-start timeline fixtures
at 44.1 and 48 kHz. Playground declarations cover builders, state queries and
absolute starts.

Completed checks include 4,503 Web/Playground source regressions and the
Playground mode declarations. Chromium 153 and WebKit 26.6 both passed the
complete 44.1/48 kHz matrix: one/two chips, ordinary/dense streams, all three
conversion styles, and Main/Worker execution. All 96 PCM captures matched the
independent source trace exactly over 2,873,520 frames per channel. The 44.1 kHz
reference also matches the original VGM player exactly. Cancel, unsupported
input, natural completion, disposal, replacement Run, immediate Stop, Monaco
diagnostics and missing-resource checks passed.

The local FM package built 304 modules, 28 chip/engine pairs and 351 declarations.
Its isolated consumer, all real WASM engines, and NodeNext/Bundler/DOM-only
type checks passed. All 878 candidate tarball members match staging byte for
byte. It retains version `0.2.30` as an unpublished development candidate;
public npm 0.2.30 does not contain POKEY. The VGM parser/player and Analyzer
were not changed in this step.

The final flat ZIP also passed 48 PCM captures (Chromium at 44.1 kHz and WebKit
at 48 kHz), covering the same single/dual, ordinary/dense, style and execution
combinations. All 957 ZIP members match staging. Native Cargo passed 764 tests
with four existing ignored tests; the final Native JS connection checks passed
65 cases, including generated imports and primary loop cancellation. Native
admission silences old voices during a future start and validates its end frame
before changing state. The latest Native/WASM timeline fixture matches exactly
over 1,945 frames at 44.1/48 kHz.

Tauri imported all 956 effective frontend files byte for byte. Its existing
importer excludes one `.DS_Store` metadata file. The corresponding-source ZIP
contains 1,917 files, including the final Rust timeline changes. Its 22 offline
source-pin checks, source-bundle verification, 24 Python tests and 31 Node tests
passed.

The local Playground ZIP is
`release/hello_ymfm_wasm_pokey-import-dev_itch_playground.zip`, SHA-256
`dfa777c90ab8877ed84fd1a68336b2573d02ab26c3e5c8adb10e33abc780d059`.
Browser, flat archive, Tauri import and package verification evidence is recorded
in [atari_pokey_vgm_import_01.json](atari_pokey_vgm_import_01.json).
Automatic audio capture mutes the physical output downstream of measurement;
human listening and comparison with Atari hardware remain separate checks.

This is local development work. No commit, push, tag, remote CI, npm publication
or itch.io upload is performed. The public npm versions have not changed.

## Source map

- `docs/playground/pokey_vgm_import.js`: input validation and code generation.
- `web/pokey_timeline.js`, `pokey_timeline_builder.js`: shared packed format,
  validation, offline authoring and allocation-free cursor.
- `web/playground_pokey.js`, `playground_pokey_worklet.js`: Browser control and
  audio-side playback.
- `web/native_genesis_extra_pokey.js` and Tauri's
  `native_genesis_pokey_timeline.rs`: Native connection and decoder.
- `scripts/check_playground_pokey_import_browser.cjs` and
  `scripts/check_pokey_native_timeline.mjs`: reproducible integration checks.
