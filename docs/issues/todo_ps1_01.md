# PlayStation SPU: staged instrument support

The first milestone is a CPU-free, experimental SPU instrument core shared by
Native and WASM. It uses the individually BSD-3-Clause-licensed MAME SPU files,
with their attribution and pristine pinned sources retained in the fixed SDK at
`third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/`. The independently
distributed source bundle retains its public `sources/native/ps1/` layout.
No BIOS, game audio, console CPU or MAME framework is required.

## Completed foundation

- [x] Port the real 24-voice SPU decoder, 512 KiB RAM and fixed 44,100 Hz output.
- [x] Provide a C register/RAM/stereo-PCM interface and an injected-WASM JS wrapper.
- [x] Validate voices, pitch, looping, ADSR, stereo, RAM updates and instance isolation.
- [x] Preserve licenses, source provenance and reproducible build inputs.
- [x] Rebuild final WASM and compare its output with the actual native core.
- [x] Provide an original audible sample example and document the raw API.
- [x] Verify browser/worker loading and standalone source rebuilding.
- [x] Finish isolated npm payload verification and record results.

Results: [ps1_spu_01.md](ps1_spu_01.md) / [JSON](ps1_spu_01.json). No publication has been performed.

## Browser mode milestone

- [x] Add a Synth API for samples, tuning, fixed stereo gain, ADSR and key-on/off.
- [x] Add a Web Audio adapter, phase-preserving host-rate conversion and lifecycle handling.
- [x] Add experimental PS1 mode, starter, 24 Keyboard targets and an SPU voice tab.
- [x] Include two original editable examples; keep Mixer settings in the Mixer.
- [x] Verify sample ownership, scheduled voice ownership, immediate Stop and retained banks.
- [x] Finish source / actual Run ZIP browser verification and record results.

Results: [ps1_mode_01.md](ps1_mode_01.md) / [JSON](ps1_mode_01.json).
Source and the actual Run ZIP pass Chromium / WebKit × Main / Worker (8 routes).

## Following milestones

- [x] Match the initial index.js/Keyboard instrument to the editor Sine level while retaining calibrated Mixer gain. See [ps1_init_sample_01.md](ps1_init_sample_01.md).
- [x] Add PCM → SPU ADPCM conversion with explicit loop and tuning metadata.
- [x] Add Sample Editor conversion, before/after comparison, actual SPU preview and saved Keyboard instruments.
- [x] Add live SPU-tab sound design: named ADSR, owned-note retrigger, sustained audition and shared reverb with per-voice sends.
- [x] Add direct per-voice PCM-cycle drawing with bounded reusable ADPCM slots and portable voice code.
- [x] Integrate the source and build recipe into SDK 0.1.6 (unpublished, hash-pinned local candidate).
- [x] Implement the Tauri Native audio adapter for primary and additional PS1 instruments. Rust, package and offline parity verification passed. Browser core and WebKit source/Run ZIP checks passed; Chromium Worker clock continuity remains a separate unresolved follow-up. GUI listening and remote OS CI remain pending.

The Browser adapter renders through AudioWorklet and batches only the native
frames needed for the current scheduled segment. Buffers are reused and the
SPU tab adds no periodic reads. Decoded sample caches can allocate on the first KON/render and other cache
paths; allocations are not restricted to preparation work. There is no
unconditional zero-allocation or real-time guarantee. Sample Editor conversion runs
in its preparation Worker; its preview uses a private SPU instance. It adds no
periodic live-chip reads. The SDK and Native adapter implementation is recorded in
[ps1_sdk_native_01.md](ps1_sdk_native_01.md) / [JSON](ps1_sdk_native_01.json).
That record lists completed implementation checks and the unresolved Chromium
clock-continuity follow-up. Do not treat the complete Browser UI matrix as passed. Browser
audio remains the default; Native output is explicitly selected in Tauri.

PCM conversion results: [ps1_adpcm_encoder_01.md](ps1_adpcm_encoder_01.md) /
[JSON](ps1_adpcm_encoder_01.json).

Sample Editor results: [ps1_sample_editor_01.md](ps1_sample_editor_01.md) /
[JSON](ps1_sample_editor_01.json). Public workflow:
[PS1 Sample Editor](../ps1_sample_editor.md). The PS1 mode now lists four
examples, including the PCM encoder and saved-sample Keyboard instrument.

Voice/effect editor results: [ps1_voice_editor_01.md](ps1_voice_editor_01.md) /
[JSON](ps1_voice_editor_01.json). Rate controls represent the retained core's
table indexes; envelope timing and reverb remain approximate.

Direct PCM drawing results: [ps1_pcm_waveform_01.md](ps1_pcm_waveform_01.md) /
[JSON](ps1_pcm_waveform_01.json). Each voice has a lazy reusable 64-byte slot
for its 112-frame cycle; copied code recreates the instrument in a fresh bank.

## Accuracy and supported subset

The pinned MAME implementation uses linear interpolation, floating envelope-rate
approximations and preset-based approximate reverb. This is not a claim of
hardware-exact sound or game soundtrack compatibility. ADSR changes apply on the
next key-on. The supported use is self-authored ADPCM instruments; the live editor also exposes the retained preset-based reverb.

The public adapter supports standard 512 KiB RAM mapping, 16-byte-aligned ADPCM
packet addresses and fixed volumes. Unsupported RAM mappings and volume sweeps
are rejected. CPU/DMA/IRQ timing, PSF playback, CD-XA and external CD audio are
outside this milestone. BRR, ADPCM-A and SPU ADPCM are different formats.

At the 2026-10-28 SDK milestone, the fixed SDK included the unchanged PS1 core
through an explicit 0.1.6 local-candidate pin, and the Tauri Native adapter implementation/offline tests
were complete. Chromium clock continuity, GUI/human listening and remote OS CI
were tracked separately. PS1 then had an explicitly unmeasured unity Mixer
profile; existing gains and Browser binary outputs were unchanged. The WASM
loader supports injected bytes in AudioWorklet. No SDK tag or package
publication was performed at that stage. See the dated follow-ups below for
later changes, including the current [PS1 Mixer calibration](ps1_chip_levels_01.md).

## 2026-10-28: Browser clock follow-up

The SDK-stage record above retains its historical six passed / two failed UI
conditions. Follow-up diagnostics reproduced the same Chromium global
`currentFrame` anomaly without PS1 while independently counted captured PCM
remained consecutive. The test oracle now audits actual pilot
PCM, retaining global-clock anomalies as diagnostics and preserving the existing
instrument PCM assertions. See [ps1_audio_clock_01.md](ps1_audio_clock_01.md) /
[JSON](ps1_audio_clock_01.json) for minimal controls, old/current real-core
comparisons and final source / Run ZIP results. The new oracle passes all eight UI
routes (415 captures / 3,895,296 frames), and the independent diagnostic passes
36 windows / 1,728,000 pilot samples while retaining one Chromium global-clock
anomaly. The common helper passes 18 tests. The old failed runs remain recorded
under their original oracle. This does not establish physical device deadlines
or replace Tauri GUI listening and remote OS CI. The pilot validates its separate
capture input, not every SPU output frame. The existing instrument PCM checks
and old/current real-core comparison remain separate evidence. The eight routes
refer only to the voice UI checker. The Playground PS1, Sample Editor and ADPCM
encoder Browser checkers still use their previous `currentFrame` assertions;
applying the shared audit to those three checkers remains a follow-up.

## 2026-10-28 follow-up: remaining checker migration

The three-checker follow-up is complete: Mode, PCM-to-ADPCM and Sample Editor pass 24 newly executed source / actual Run ZIP routes, auditing 771 captures / 6,500,352 frames. One Mode ZIP capture retains a global-clock anomaly while its independent pilot remains continuous. The 43 helper/aggregate unit tests pass. Previous voice UI evidence was reused only after current checker/helper/archive hashes matched; its eight routes were not rerun in this stage or counted among the 24. The local packaged aggregate passes four reports / 16 routes, including the previous voice ZIP proof. See [ps1_capture_migration_01.md](ps1_capture_migration_01.md) / [JSON](ps1_capture_migration_01.json). All historical results above remain unchanged. Production audio, WASM, Mixer, fixed SDK, Tauri and package versions are unchanged. Remote CI and human listening remain pending; no commit, push or publication was performed.

## 2026-10-29: dedicated Mixer reference

PS1 now has a dedicated single-voice digital reference instead of using the
quiet starter as a calibration instrument. Playground System built-in and the
optional npm calibrated preset use `0.128832` for primary and additional PS1
instances. Existing calibrated sound-chip gains and the common target are
retained; raw SPU output and authored/saved Mixer settings are unchanged.

The original filter-0/shift-0 sine has decoded peak `0.875`; the starter's shift-4
sample has sixteen times less amplitude at the codec input. Calibration
accounts for the reference's codec headroom and does not normalize every
sample, perceived loudness or multivoice playback. Actual Browser coverage and
offline Native/WASM comparisons, with their distinct limits, are recorded in
[ps1_chip_levels_01.md](ps1_chip_levels_01.md). This does not measure a physical
Native audio device or console hardware volume. Refer to that record for
completed checks and any remaining work; the historical stage results above
remain unchanged.
