# Tetorica FM2608 Synth

Started 2026-11-15. The user explicitly requested implementation after the
other Codex finished. The working tree was clean before this task began.

Build a playable YM2608 / OPNA Synth using the FM2612 Synth's editing and Code
conventions. Use the approved white FM2608 icon and keep shipped source readable.

## First playable version

- [x] Reuse the existing YM2608 runtime and shared FM control modules.
- [x] Add FM, SSG, Rhythm, ADPCM and Mixer tabs with physical-channel selection
      and Auto allocation where the hardware supports several melodic voices.
- [x] Support keyboard, pointer keyboard, octave and duplicated Pitch controls.
- [x] Keep Code playback and manual parameter/key input usable together.
- [x] Reuse Files, Monaco, Run / Apply / Stop, project persistence and export.
- [x] Save and load validated OPNA settings and embedded ADPCM sample data.
- [x] Provide a readable standalone itch.io package and a discoverable app link.
- [x] Verify the actual browser audio, controls, Code, files and packaged app.

## Subsequent development

The user requested the next pass after the first playable version. Implement
reference playback / inspection / capture, special FM controls and portable
Code-loaded samples. Keep Looper and Event recording deferred. Reuse the
existing player, decoder, Files and calibration revision mechanisms.

- [x] Persist imported VGM / VGZ / S98 files under `/vgm/` and list them above
      the monitor with Play / Pause / Resume / Stop and Seek.
- [x] Follow FM, SSG, Rhythm and ADPCM-B settings through the existing controls.
- [x] Audition paused channels, capture their sound and retain song position.
- [x] Allow manual edits and keyboard interaction during reference playback.
- [x] Keep Code and reference-song transports exclusive while manual playing
      remains available to either transport.

- [x] Add VGM / S98 reference playback, Live channel inspection and tone capture
      through the existing OPNA Analyzer engine.
- [x] Expose CH3 special frequencies, per-operator Key On and CSM in the UI.
- [x] Capture Code-loaded ADPCM memory and its selected address range into a
      portable preset, preserving keyboard reference tuning after release.
- [ ] Evaluate Looper / Event recording after the four sound sections work.
- [x] Add FM2608 to the bulk itch.io release plan when preparing its release.
- [x] Prepare a separate Tauri repository when requested.

The first version uses the existing Tetorica synthetic rhythm ROM. FM, SSG,
Rhythm and ADPCM-B are sections of one YM2608. Keyboard allocation and Pitch
are software performance features. Additional Code effects are host software.

## Tauri desktop edition

The user requested implementation in `w/tetorica-fm2608-synth-tauri`.
Initial app version is `0.0.1`. The new repository includes the readable Web
release, import / version-update scripts, existing desktop Menu / Pin and
Web Audio / CPAL output conventions, plus cross-platform build workflows.

The Web Synth now exposes a guarded bridge on local Tauri pages. Its shared
final Master bus is routed before keyboard, Code and reference playback start.
The desktop edition retains the imported Web files byte for byte.

Verification includes 33 Python tests, 47 JavaScript tests, 30 default Rust
tests and nine browser scenarios in each of Chromium and WebKit. A local
unsigned arm64 Release app builds and opens. Actual Menu / Pin, Native output
at 48 kHz and restoration to Web Audio work in the built application.

The opt-in standalone CPAL continuous test failed during device setup in the
command environment, so its planned 30-second stream remains unverified.
Signed / notarized builds, physical listening, prolonged playback and remote
CI builds remain release checks. Detailed evidence and TODOs are in the new
desktop repository's `docs/verification_20261115.md` and `docs/todo_20261115.md`.

## YM2203 compatibility playback

The user chose automatic detection and YM2608 compatibility playback first.
Keep the existing Synth layout and production YM2608 core. Preserve imported
source files in Files. Native YM2203 core selection is a later design decision.

- [x] Detect single-YM2203 VGM / VGZ and converted S98 files before OPNA validation.
- [x] Convert YM2203 writes into the compatible YM2608 register area, using twice
      the source clock and preserving wait timing, loops and GD3 metadata.
- [x] Keep mono pan and suppress OPN writes that would activate OPNA-only features.
- [x] Show YM2203 → YM2608 playback and original / target clocks in the current UI.
- [x] Retain Live view, paused audition, Capture, Seek, Mixer and Code handoff.
- [x] Compare real YM2203 / YM2608 cores for pitch, SSG clocks and output levels.
- [x] Read VGM 1.70 extra-header boundaries without treating volume entries as
      additional chips. Preserve first-chip volume settings in the source file
      and explain their unapplied status in compatibility playback.
- [x] Validate all 49 local EVE burst error YM2203 songs and render real samples.
- [x] Verify readable standalone packaging and Chromium / WebKit operation.

The initial compatibility version used the existing calibrated OPNA output
gain. Its FM level matched the calibrated YM2203 level closely, while its SSG
level was about 4/3 of that source. The Output Mixer pass below now applies
SSG ×0.75 and first-chip VGM volume settings when YM2203 mode is enabled.

## Output Mixer and YM2203 mode

The user requested output-level adjustment in Mixer and automatic YM2203
correction, initially enabled when a YM2203 reference song is loaded.

- [x] Add independent host output gains for the combined FM / Rhythm / ADPCM
      stereo bus and the SSG bus, preserving default output for existing callers.
- [x] Carry those gains through the native SDK, WASM, synchronous engine and
      browser AudioWorklet, including reset and state restoration.
- [x] Add Mixer controls and a YM2203 mode checkbox with the SSG ×0.75 correction
      and the current effective multipliers visible.
- [x] Enable YM2203 mode by default for YM2203 song imports, apply supported
      first-chip VGM volume entries, and retain user output-level controls.
- [x] Keep gain changes effective during playback, paused audition, Resume,
      Seek, manual keyboard performance and Code without stopping notes.
- [x] Verify real native output, browser Mixer behavior, readable packaging and
      the calibration / source receipts affected by the new WASM build.

## Imported song preset library

The user noticed that VGM imports only populate the song list. Import recorded
instruments into Files presets before moving on to the Tauri edition.

- [x] Extract bounded, deduplicated FM, SSG, Rhythm and complete ADPCM-B sounds
      from validated YM2608 / compatible YM2203 VGM, VGZ and S98 sources.
- [x] Save the original song under `/vgm/` and its playable OPNA instruments
      under a collision-safe `/presets/<song>/` folder in one Files transaction.
- [x] Preserve running Code, the current editable instrument and Keyboard / Code
      view during import. Select a saved sound to apply it through the normal UI.
- [x] Select the matching sound section and playable channel when a generated
      preset is chosen, retaining hardware modulation and complete sample data.
- [x] Check real songs, invalid imports, repeated names, persistence, project
      export / restore, both browsers and the readable standalone package.

### Preset library verification

- 109 app / extraction / Files / package tests and 111 shared Code / YM2608
  runtime tests pass. Invalid and oversized batches leave the previous project
  intact. Repeated names use separate source and preset paths.
- All 49 local EVE YM2203 songs extract successfully. Each song and its own
  generated presets fit the existing 12 MiB project budget. The local report is
  `build/fm2608-imported-preset-library.json`. A real Dragon Knight 4 S98 also
  extracts FM and SSG sounds.
- The final package passes 30 audio / UI checks in each of Chromium and WebKit
  with speaker output muted. The new check imports VGM / VGZ / S98 while Code
  runs, exports the actual Files contents, selects each sound section and
  auditions its generated preset. The report is
  `build/fm2608-synth-preset-library-packaged.json`.
- Actual Monaco passes five checks in each browser with no diagnostics or page
  errors. The report is `build/fm2608-synth-preset-library-monaco.json`.
- Verified ZIP is
  `release/tetorica_fm2608_synth_dev-20261115-preset-library_itch.zip`.
  Its 181 files include the readable extractor, Files integration and verified
  native build inputs. Local game recordings remain outside the distribution.
- Selecting a generated preset applies its sound section and channel, keeping
  other sections and running Code available. SSG keyboard Note On retriggers
  its enabled shared hardware envelope, allowing repeated one-shot audition.
- Extracted files contain static instrument snapshots. Later song automation
  remains in the original song. Incomplete, direct-stream, 1-bit DRAM and
  limit-wrapping ADPCM ranges report their omission under Import details.

### Output Mixer verification

- 118 Synth, Runtime, source-navigation and package tests pass. The separate
  calibration, Mixer and generator checks pass all 644 tests.
- The default unity output is bit-identical to the previous WASM across 586
  cases and 7,264,744 stereo frames. Evidence is retained in
  `docs/issues/ym2608_output_gains_default_pcm_01.json`.
- Real YM2203 / doubled-clock YM2608 comparisons verify corrected FM and SSG
  levels, including VGM relative volume entries. Native gain controls validate
  atomically and survive reset and checkpoint restoration.
- Final package passes 29 speaker-muted scenarios in each of Chromium and
  WebKit. This includes independent bus levels, running Code, YM2203 automatic
  mode, actual EVE playback, reference-file removal and mobile Mixer layout.
  The report is `build/fm2608-synth-mixer-verified.json`.
- Actual Monaco passes five checks in each browser with no diagnostics or page
  errors. Its report is `build/fm2608-synth-mixer-verified-monaco.json`.
- Verified ZIP is
  `release/tetorica_fm2608_synth_dev-20261115-ym2203-mixer-verified_itch.zip`.
  The package retains readable source and complete native build inputs. A
  rebuild using only packaged native inputs reproduces its JS and WASM bytes.
- SDK changes are also present in the sibling native checkout's YM2608 wrapper,
  recipe, inventory and gain smoke test. The parent imports a hash-pinned local
  SDK candidate based on its previous snapshot. Publishing remains separate.
- Existing PS1, WonderSwan, POKEY and SCSP calibration reports remain immutable.
  An exact reviewed-source receipt covers the two dormant YM2608 dependencies
  in those eight profiles. Analyzer's active YM2608 anchors were remeasured in
  `docs/issues/analyzer_psg_levels_08.json`, with every measured value unchanged.
- Gain updates follow the existing short audio lookahead. Instrument registers,
  envelopes and transport position remain intact. Output Mixer settings are
  host controls outside instrument presets.

## YM2203 compatibility verification

- All 190 OPNA, shared Code, source-navigation and package tests pass.
- All 49 local EVE burst error YM2203 files pass the normal import validator.
  Dailyopening, Relate and Fanfare each produce finite, audible PCM through the
  real OPNA core over their first five seconds. The report is
  `build/fm2608-eve-ym2203-validation.json`.
- The final packaged app passes 27 speaker-muted scenarios in each of Chromium
  and WebKit, including an actual EVE song, Live view, paused FM / SSG audition,
  Capture, Seek, Resume, original-file export and the existing OPNA controls.
  The report is `build/fm2608-synth-ym2203-ready-packaged.json`.
- Actual Monaco also passes five checks in each browser, including diagnostics
  and implementation navigation. The report is
  `build/fm2608-synth-ym2203-ready-monaco.json`.
- Verified ZIP is `release/tetorica_fm2608_synth_dev-20261115-ym2203-ready_itch.zip`.
  Its 179 files retain readable source and matching build inputs. Compatibility
  playback adds no dedicated YM2203 WASM. Game music stays in the local test
  collection and is excluded from the distribution.

## First-version verification

- 72 unit / source-navigation / shared Code regression / package checks pass.
- The final package passes 18 audio / UI scenarios in each of Chromium and
  WebKit. Reports are `build/fm2608-synth-packaged-final.json` and
  `build/fm2608-synth-packaged-monaco-final.json`.
- The verified ZIP is `release/tetorica_fm2608_synth_dev-20261115-final_itch.zip`.
  It contains readable modules, the matching WASM, 38 verified native inputs
  and the synthetic rhythm ROM's generator and license.
- Actual Monaco runs in Chromium and WebKit. Its worker accepts all four sound
  sections, opens the ADPCM implementation and fits expanded / mobile layouts.
- Browser audio checks intercept every destination through a zero-gain node.
  Actual FM, SSG, Rhythm and ADPCM-B PCM is measured while speakers stay muted.
- Existing mixer-calibration revision tests had five failures among
  twelve tests across the HuC6280, PS1 import and YM2612 export chains. HEAD
  versions of `playground_monaco.js` and `playground_monaco_definitions.js`
  already fail receipt recognition when passed to the restoration function.
  The complete tests were not rerun in a separate HEAD checkout. This task
  changed no DSP or WASM. The FM2608 packager used its own verified receipts.
- [x] Reconcile those pre-existing Monaco UI changes with the calibration
      revision chain before rebuilding the older Playground packages.

## Reference-playback verification

- Verified package is `release/tetorica_fm2608_synth_dev-20261115-reference-ready_itch.zip`.
  Browser reports are `build/fm2608-synth-reference-ready.json` and
  `build/fm2608-synth-reference-ready-monaco.json`.
- 109 OPNA unit, source navigation, shared Code and package checks pass.
- The real OPNA core's CPU-uploaded and VGM-block samples match captured bytes.
- Chromium and WebKit each pass 24 speaker-muted audio / UI scenarios, including
  reference playback, independent paused audition, Capture, Seek, source-channel
  Mixer, keyboard interruption and Code / song handoff. Monaco also checks the
  CSM and portable-capture implementation links in both browsers.
- Manual edits remain visible when Auto update is off. Seek progress resumes
  following the audio clock after a focused slider edit. Invalid file selection
  retains the previous song, selector and running transport.
- Reference songs use one YM2608 and play one pass. Unsupported chips are
  rejected before replacement. Rhythm uses the original Tetorica synthetic ROM.
- Reference Capture requires complete external-memory samples with 32-byte
  addressing. CPU-direct streams and 1-bit DRAM report their capture limits.
  Code sample capture supports completed uploaded 8-bit DRAM data. A dirty
  CPU-written memory image can be replaced with a successful upload or preset.
- PS1, WonderSwan, POKEY and SCSP now have complete new baseline / verify reports
  after the earlier SPC API additions. All 637 calibration-related checks pass.
  Both generated gain policies reproduce those measured inputs. Historical
  measurements are retained through strict UI and gain-policy revision records.
- The bulk release plan now includes FM2608. The Playground's SPC helper is
  included, and its browser ZIP stays within 1000 entries with all original
  build sources retained in the included source ZIP.
