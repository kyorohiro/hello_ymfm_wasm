# Incremental POKEY timeline preparation

POKEY timelines can be prepared without decoding an entire large trace on the
Browser audio thread in one message. The client sends owned chunks of at most
16 KiB and waits for each validation acknowledgement before sending the next.
The existing 8 MiB trace limit and packed timeline format are unchanged.

## Audio-thread work

The Worklet receives a small header, retains transferred chunk buffers, and
validates at most 1,024 completed writes and 16 KiB of input in each audio
quantum. Validation runs once per `process()` call, including when scheduled
events split that quantum into several render segments. Incomplete records
can span chunks; canonical varints, register bounds, duration and rolling
512-write/128-output-frame density checks are retained.

Chunk acknowledgement follows validation. A completed upload is committed
without joining its buffers, copying the full score, or rescanning it. Playback
uses a cursor over the retained chunks and does not create typed-array views
for individual events. An old bulk `prepareTimeline` Worklet message is limited
to 16 KiB and follows the same bounded validation path; public Browser clients
use the chunk protocol for all sizes.

The client still makes a full snapshot on the calling Main/Worker thread before
its first await, so later caller mutations cannot change the score. This work
does not remove all control-side allocations or promise a hard audio deadline.
The change bounds the new decoding work on the audio thread.

## Commit and cancellation

An upload has its own ID and exact port/session/owner identity. Preparing and
validating data do not reset the chip, release ordinary held voices, or replace
the previously committed score. Only a successful commit replaces that score.
Preparing while a timeline is playing or a manual audition is held is rejected;
commit checks admission again. Progress is available through optional
`preparing`, `bytesReceived` and `bytesValidated` state fields.

Stop, reset, all-notes-off, disposal, owner/session cancellation and endpoint
replacement discard unfinished uploads. Late acknowledgements cannot resume
an aborted client upload or commit old data. Replacing an upload from another
loop cancels the previous owner's upload using its original identity; cleanup
does not acquire ownership for the new loop. No additional UI or audio timer
polling is introduced.

Native preparation already happens on the control side and retains its existing
single preparation RPC. Browser/Native routing remains explicit. Mixer gains,
POKEY core, SDK sources and generated WASM binaries are unchanged. Runtime
cache identity is `pokey-prepare-1` with dependent imports updated.

## Reproducible checks

- `node --test test/pokey*.test.mjs web/*pokey*.test.mjs`
- `node --test --test-concurrency=4 web/*.test.mjs docs/playground/*.test.mjs`
- `node scripts/check_playground_mode_types.mjs`
- `node scripts/build_fm2612_package.mjs`
- `node scripts/check_fm2612_package.mjs --skip-build`
- `node scripts/check_playground_pokey_prepare_browser.cjs`
- `node scripts/check_playground_pokey_import_browser.cjs --chromium-only --sample-rate=44100`
- `node scripts/check_playground_pokey_import_browser.cjs --webkit-only --sample-rate=48000`

The preparation Browser check uses production clients and actual AudioWorklets
in Chromium/WebKit, Main/module Worker, at actual 44.1/48 kHz. It prepares up to
the exact 8 MiB limit while other POKEYs play a reference tone, checks transfer
sizes/backpressure/cancellation, and compares captured PCM with a separate
reference node and an independent WASM renderer. The measurement sink emits
zero to the physical output. These checks measure generated PCM and transport
behavior; they do not replace human listening or prove that an operating
system never underruns its output device.

Final verification counts, artifact hashes and distribution receipts are
recorded in [pokey_timeline_prepare_01.json](pokey_timeline_prepare_01.json).
This is local development work; no publication is performed.

The source regression suite passed 4,531 tests. Package checks built 305 modules,
28 chip/engine pairs and 352 declarations, then verified the isolated consumer,
all 28 WASM engines and three type configurations. All 880 members of the local
package candidate match staging byte for byte. Its version remains `0.2.30`;
public npm 0.2.30 does not contain POKEY and was not republished.

The docs Browser matrix passed all eight routes, including four exact 8 MiB
preparations. Those large uploads each used 512 transferred chunks with at most
one pending acknowledgement; complete preparation took about 8.2 seconds on
this machine. The four 300 KiB cases took 0.325–0.356 seconds. Across preparation
and cancellation, 1,762,432 held-tone frames matched an independent WASM renderer
exactly, with no non-finite values, stereo differences or missing capture quanta.
All 48 staged cancellation cases passed. This is an explicit tradeoff: large
preparations take longer overall, while their audio-thread work is bounded.

The local Playground archive is
`release/hello_ymfm_wasm_pokey-prepare-dev_itch_playground.zip`, SHA-256
`34404c07c2ba398a3f8485dc8850dc7305db3d9c4e2af0df8611b8af367bc834`.
All 958 ZIP members match staging. Tauri imported all 957 effective payload
files byte for byte; its existing rules omit one `.DS_Store` metadata file.
The matching 1,918-file source bundle passed 22 source-pin checks. Tauri's
24 Python and 31 Node tests passed. Native Rust/DSP was unchanged, so Cargo
was not rerun for this Browser transport change.

The optional second Browser run against the final flat directory did not launch:
two execution requests returned no process/session/output while dispatch or
approval remained pending. They were cancelled by the parent agent; no rejection
was reported and no checkers remain running. Separate flat preparation and VGM
import UI captures are therefore not claimed for this step. All 25 runtime assets
actually loaded in the completed docs Browser matrix were instead SHA-256 checked
against the final ZIP and match exactly. Source conversion regressions also
passed in the complete test suite. The pending-launch details are retained in
the JSON receipt.

## Source map

- `web/pokey_timeline_upload.js`: incremental validator and chunk cursor.
- `web/playground_pokey.js`: snapshot, transferred chunks and cancellation.
- `web/playground_pokey_worklet.js`: per-quantum validation and atomic commit.
- `web/playground_performance_sender.js`: preparation ownership metadata.
- `web/playground_runtime.js`: Main loop preparation ownership.
- `test/pokey-worklet-upload.test.mjs`: real-WASM bounded-work/continuity checks.
- `web/playground_pokey_upload_client.test.mjs`: transfer and lifecycle checks.
- `scripts/check_playground_pokey_prepare_browser.cjs`: real Browser checks.
