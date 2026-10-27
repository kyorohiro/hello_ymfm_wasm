# WonderSwan VGM import for Playground

Date: 2026-10-27. Status: implemented and locally verified; not published or committed.

Playground's **Menu → Import → VGM / S98…** now recognizes a single WonderSwan VGM/VGZ and generates editable JavaScript. The dialog offers Raw register/RAM writes, writes with explanations, and High-level API with raw fallback.

## Converted data

- All four wavetable channels, packed wave RAM, Noise, Sweep and unsigned 8-bit Voice PCM.
- BC relative register writes become absolute `0x80..0x9f` addresses. C6 big-endian RAM writes retain their physical 16 KiB addresses, including nonzero banks.
- Supported uncompressed DAC data banks and first-chip WonderSwan stream commands are expanded through the existing `Ym2612VGM.playStep()` / `consumeWait()` implementation. This preserves writes at sample zero, wait boundaries and their original order; it does not invent a second stream decoder.
- The source clock is explicitly applied with `await ws.setClock(clock)`. Allowed clocks match the existing API's 100,000–100,000,000 Hz range.
- High mode uses only byte-identical volume, adjacent frequency-pair and Voice PCM operations. Gates, mode transitions and RAM edits stay raw. `setWaveform()` is deliberately not used for incoming RAM writes because it would add key-off.

The script creates an independent `createSoundChip('wonderswan')`, configures the clock, cold-resets without `initialize()` defaults, then replays one pass using absolute `createTimeline().waitUntil(sample / 44100)` positions. It disposes the owned chip in `finally`, including interrupted waits or failed clock setup. High mode's `adoptRegisterState()` grants API access without writing the chip.

The first implementation used relative top-level `sleepSamples()` waits, like the existing Game Boy/NES conversion. Browser testing exposed cumulative timer delays with dense Voice PCM. The final output uses the existing absolute-timeline API already used by SPC import, anchored after resource setup. Overdue events catch up instead of delaying every following event. This adds no runtime scheduling capability: the source's logical trace is retained, but browser audio delivery is not guaranteed sample-accurate and dense PCM can still sound uneven. Original VGM loop points are not repeated automatically.

## Explicit limits

Mixed chips, second-chip/variant headers, additional header clock/volume overrides, Hyper Voice, DMA, out-of-range addresses, unsupported commands, compressed data banks and table/ROM/RAM block types are rejected before project files change. Unsupported clocks omitted from the shared parser's public header are also detected through the full header clock table.

The complete raw command stream is checked before the parser can recursively skip metadata. Limits are 16 MiB input/bank payload, 1,000,000 expanded writes, 64 MiB generated source, 64 MiB accumulated bank-copy work, 256 consecutive metadata commands and `0xffffffff` total VGM samples. A repeated stream target setup requires fresh bank/frequency configuration before start. These conservative limits avoid silently producing partial conversion output.

## Changes

- New converter and core tests: `docs/playground/wonderswan_vgm_import.js` and `.test.mjs`.
- Detection/preflight in `playground_vgm_import.js`; dialog and import routing in `index.html` / `playground.js`.
- UI/preflight regression tests, plus `scripts/check_playground_wonderswan_import_browser.cjs` for actual browser import and playback.
- WonderSwan's existing `adoptRegisterState()` method is now included in the Playground declaration and mode-type fixture. Initial browser verification found the missing declaration in High output; the runtime method was already present.
- Standalone Playground and Synth packaging include the new module. Cache token `wonderswan-import-1` applies only to the changed import/UI entry modules; the versioning script is idempotent.
- No sound core, Worklet, transport, Native Rust/C++ code, Mixer gain, SDK source or WASM output was changed.

## Verification

- Final complete Playground unit run: **1,130 passed**, no failures/skips.
- WonderSwan-related Web/Native/Analyzer tests: **72 passed**. These overlap other earlier runs.
- Converter-focused tests: **35 passed**, including exact real-WASM stereo PCM and timed write traces for all four wave channels, Noise, Sweep, Voice PCM and source-clock changes; normal/fast/reverse/looping DAC streams; failures, cancellation and a delayed-timer drift regression using the actual common timeline implementation.
- All Playground mode declarations passed the common mode/type check, including generated-code setup methods.
- Final docs and flat Playground checks passed in Chromium 153.0.8010.12 and WebKit 26.6. Each checks VGM/VGZ and all three conversion styles, all four wave channels, Noise/Sweep/Voice PCM, Main/Worker, independent imports in Genesis mode, Monaco diagnostics, RAM/bank preservation, Stop, natural disposal, Run→Run, Cancel and unsupported inputs. No missing assets or unexpected page errors remained.
- The two-second dense Voice PCM fixture completed in **2.02–2.19 seconds** across all eight docs/flat/browser/Main/Worker combinations, passing the 1.5–3.5-second duration guard. Individual sample delivery remains uneven; this is a duration-drift fix, not proof of original PCM pitch/timbre accuracy.
- All 267 docs / 265 flat served-file hashes match current disk bytes; flat files also match the exact distribution ZIP entries. Stop output measured zero. Browser results and source hashes are preserved in the companion JSON.
- Independent review found no remaining correctness issue. All 2,048 representable pitch periods across six edge/nonstandard clocks round-tripped to identical register bytes (12,288 combinations).
- Both standalone Playground and Synth packages passed their checks.
- Playground Tauri: **921 imported frontend files**, importer verification, **22 Python / 31 Node tests passed**. All 22 fixed Native source snapshots, SDK 0.1.4's 395 files, and the corresponding application source ZIP (1,862 files) verified offline.
- All 55 WASM outputs and core/Mixer/SDK source bytes are unchanged.

Physical output is muted after measurement; this phase does not claim human listening results, original hardware accuracy or actual Tauri WebView sound verification. Native client regression uses the existing test environment; no fresh desktop binary/CI build was run for this frontend-only addition. Detailed source hashes and final reports are in [playground_wonderswan_vgm_import_01.json](playground_wonderswan_vgm_import_01.json).

## Artifacts and repository state

Standalone Playground ZIP: `release/hello_ymfm_wasm_wonderswan-import-dev_itch_playground.zip`.

SHA256: `838ee8d1853f9d74b07a467b9e224f25abeb6cc768e06e299ca72cc77d676490`.

This exact ZIP is imported into `w/tetorica-fm2612-playground-tauri`. The corresponding source ZIP is `native-source-bundle/application-sources.zip`, SHA256 `517e039c805a284f4873ef7dca23d33fb11d637a6af33d2df707d659508fa080`.

Main base commit: `28adb38f09569312aa6e35407cb4d9e7a15c93b3`. The previous WonderSwan Wave RAM extraction is already committed in main and Analyzer Tauri (`591ec071e03d267af49bf27dde6f862b8924eff9`). This phase changes main and Playground Tauri only; no npm publication, version bump, commit/push, tag or CI dispatch was performed.

## Reproduction

From main:

```sh
node --test --test-concurrency=2 docs/playground/*.test.mjs
node --test --test-concurrency=2 web/*wonderswan*.test.mjs test/wonderswan*.test.mjs
node scripts/check_playground_wonderswan_import_browser.cjs --root=docs --out=/private/tmp/ws-import-docs.json
sh scripts/package_itch_playground.sh wonderswan-import-dev
node scripts/check_playground_wonderswan_import_browser.cjs --root=release/itch_playground_wonderswan-import-dev --out=/private/tmp/ws-import-flat.json
sh scripts/package_itch_synth.sh wonderswan-import-dev
```

From Playground Tauri, import the generated ZIP using `python3 scripts/import_release.py <absolute-ZIP-path>`, then run `python3 scripts/import_release.py --check`, `npm test`, `python3 scripts/prepare_native_sources.py` and `python3 scripts/check_native_sources.py --bundle`.

## Next

Import an actual WonderSwan VGM/VGZ and listen in Web Audio and Native, starting with a wavetable song and then Voice PCM. Commit/push main and Playground Tauri and verify CI. Voice PCM capture in Analyzer remains a separate feature; this import replays Voice PCM writes but does not infer the original recorded sample.
