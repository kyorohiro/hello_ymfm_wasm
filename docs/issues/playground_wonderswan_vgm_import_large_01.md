# Large WonderSwan Voice PCM imports

Historical record: this resolved import size, but subsequent user playback
exposed timing corruption. See [the sample-timeline correction](playground_wonderswan_pcm_timing_01.md)
for the current playback path and stronger waveform verification.

Date: 2026-10-27. This follows the initial [WonderSwan VGM import](playground_wonderswan_vgm_import_01.md). The initial record and JSON retain their historical source hashes; the development ZIP path has been regenerated for this fix.

## Problem

`04 Cat Song ~ Theme of UPA.vgz` failed import at the 1,000,000-write bound. Expanding every write into JavaScript would also exceed the 64 MiB generated-source bound. Raising the write count alone cannot fix both errors.

The local source contains 95.954785 seconds of playback, 1,151,171 direct register writes and 192 RAM writes. Of those, 1,151,160 are direct Voice PCM writes to register 0x89. There are no VGM DAC data banks or stream commands in this particular file. The PCM cadence alternates between three and four VGM samples; it must not be rounded to a constant 12 kHz rate.

## Fix

Only consecutive writes to 0x89 with the authored Voice PCM bit enabled are packed into data. Each record stores an unsigned variable-length sample delta and the original PCM byte. Any RAM, control or other-register write ends that run, retaining the source's same-time ordering. First and last sample positions are preserved.

The generated Raw/Readable/High code retains editable control and RAM operations. PCM runs use one shared Virtual Files asset, `/wonderswan-pcm-<id>.dat`, loaded before playback; a short JavaScript helper replays its original values using the existing absolute timeline. This does not embed a VGM player or add a sound-core streaming API.

`validateWonderSwanVgm()` checks the whole source with nonretaining sinks before the options dialog. `readWonderSwanVgm(..., {packPcm:true})` retains compact runs plus a packed byte buffer. Its default expanded form remains available for small traces and retains its original write-count bound.

The production path bounds ordinary writes/run headers at 1,000,000 and packed PCM memory/work at 64 MiB. Other input, command, bank-copy, total-duration and generated-source guards remain. Inline fallback checks its output size before creating a large joined string. A file callback is used by the UI, so dense PCM does not become a giant numeric JavaScript literal.

Missing files, wrong lengths and malformed/noncanonical deltas are rejected before creating a chip or sending sound writes. File callbacks stage bytes in memory and Virtual Files is updated only after successful conversion. Stop/errors dispose the owned chip; same-time packed bursts yield at least every 1,024 writes.

## Actual-file verification

| Item | Result |
|---|---:|
| Compressed / decompressed source | 1,510,590 / 4,606,002 bytes |
| PCM records | 1,151,160 |
| Retained event/run objects | 204 |
| Packed asset | 2,302,320 bytes |
| Generated UI Raw JavaScript | 9,154 bytes |
| Generated UI Readable JavaScript | 21,642 bytes |
| Generated UI High JavaScript | 21,693 bytes |

Before this fix, Raw write/wait lines alone would require about 88 million characters. Ordinary controls remain visible after compaction.

All three generated styles were executed to completion against a deterministic timeline and real Synth authoring layer. An independent walk of the original source and all three outputs produced the same ordered time/address/value hash for **all 1,151,363 operations**, including the first PCM at sample 1,096 and final sample 4,231,606:

`da5772eadf630cabbe1120d1d79219c22055e8ef64b7e44bdc0baa04e4651ada`.

The packed asset hash is `21edb1bddf365732e110a9260b294a07ab34336d01b628684d7c83776ad7cd2f` in all three styles. The source audio and generated music payload are not committed or included in distribution archives; the companion record stores measurements and hashes only.

## Checks

- Converter suite: **44 passed**, including a synthetic direct PCM source above one million writes, exact timed hashes in all three styles, external-file real-WASM PCM comparisons, stream boundaries, RAM/control interruptions, full uint32 time deltas, missing/corrupt assets and cancellation.
- Complete Playground suite: **1,139 passed**, no failures/skips. Counts overlap the converter suite.
- Independent code review found no blocking correctness issue.
- Standalone Playground and Synth package checks passed. Cache revision is `wonderswan-import-2` and the versioning script is idempotent.
- Browser checks cover the original synthetic modes and the local large file in all three styles, Main and Worker. Actual-song checks capture its initial one second of output and then Stop; the full 96-second song is not played or evaluated by ear.
- Tauri imports the same 921-file frontend. Its fixed Native source inventory, SDK 0.1.4 and corresponding application source ZIP are verified without modifying native code.

Final browser reports, source hashes, test logs and exact artifact receipts are preserved in [playground_wonderswan_vgm_import_large_01.json](playground_wonderswan_vgm_import_large_01.json). Sound cores, Worklets, Native Rust/C++, all 55 WASM outputs and Mixer values remain unchanged. No npm/version/tag/commit/push/CI action was performed.

## Playback limit

This fixes import memory and generated-code size. It does not make per-sample asynchronous Voice PCM delivery sample-accurate. The absolute timeline still avoids accumulating timer delays; individual audio boundaries and timbre can differ. Asset validation also performs bounded synchronous work before playback. Browser measurements are upstream of a muted physical output; no human listening, original hardware or actual Tauri WebView audio claim is made.

## Reproduce

```sh
node --test --test-concurrency=2 docs/playground/*.test.mjs
sh scripts/package_itch_playground.sh wonderswan-import-dev
sh scripts/package_itch_synth.sh wonderswan-import-dev
node scripts/check_playground_wonderswan_import_browser.cjs --root=docs --large-file=/path/to/song.vgz --out=/private/tmp/ws-large-docs.json
node scripts/check_playground_wonderswan_import_browser.cjs --root=release/itch_playground_wonderswan-import-dev --large-file=/path/to/song.vgz --out=/private/tmp/ws-large-flat.json
```

Reload the Playground before importing again so that the `wonderswan-import-2` modules are loaded. Import creates the JavaScript and one PCM asset together. Save both when saving a Cassette.
