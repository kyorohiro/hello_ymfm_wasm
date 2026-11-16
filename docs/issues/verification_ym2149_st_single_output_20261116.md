# AY / YM2149 Single Output support

Date: 2026-11-16. User reported `AY flags 0x2: Support coming soon` when loading a VGM into YM2149 ST Synth and requested support.

## Implementation

Flag `0x02` selects MAME's nonlinear tied-channel resistor output. The standalone AY / YM adaptation now ports the pinned original `build_3D_table` and `mix_3D` behavior for unequal fixed levels, envelope selections and tone / noise gates. It retains the existing independent-channel output for flags 0 / 1 / 0x10 / 0x11.

Both JS and native validation accept bits 0, 1 and 4; bit 4 remains YM2149-only. AY flags 2 / 3 and YM flags 2 / 3 / 0x12 / 0x13 are supported. Raw / resistor output, stereo-pan flags and other chip variants remain unsupported.

The direct native mixed-tick accessor retains MAME's original level (including its legacy factor of three). Public PCM uses the established host division by three and duplicates mono to left and right. Channel muting retains the corresponding electrical zero-level load and envelope selector; all-channel host mute returns zero. Muting does not reset counters or discard partial native-tick phase. The old independent-channel speaker offset is excluded from Single Output.

The canonical `w/tetorica-soundchip-native` checkout received the matching adaptation, header, README and WASM bridge changes. The application's authenticated SDK snapshot overlays exactly those four inputs onto its previous verified local candidate, preserving common SDK metadata and unrelated source inputs. It retains the existing unpublished version marker and records the added changed paths; no SDK release or commit is claimed.

AY WASM was rebuilt and synchronized. The SPU artifact was rebuilt from its unchanged source inputs to update its complete-SDK provenance receipt. The runtime artifact checker verifies the complete canonical set and mirrors.
The resulting SPU WASM bytes are unchanged (SHA-256 `cd1223fe41624db415c31395e3eba30cab18c56c46a28d57425dfa71f038f96f`).

## Numerical and runtime verification

- Original pinned MAME routines: **8,375,616 native ticks matched**, including **4,396,704 Single Output ticks**, plus **119,749 host mute checks**. The verifier compiles the original table builder and mixer independently of the adaptation. It covers all fixed-level tuples, mixed envelope selectors, gates, envelope shapes / retriggers, host PCM scaling and divider profiles.
- Before / after WASM hashes: all six existing profiles generated **bit-identical PCM** for 13,220 stereo frames per profile with deterministic register changes, mute changes and irregular render lengths.
- Extended SDK comparison: **8,208 legacy-vs-new cases**, maximum difference **0**, with 1,260 reset replays. New Single Output profiles additionally pass **72 cases** across clocks and output rates, including actual nonlinear interactions, chunking, reset, mute phase and stereo equality. The checker generated **43,463,246 stereo frames** in total; this includes self-checks for the new modes, not only old-vs-new comparisons.
- Actual AY WASM / native runtime tests: **116 passed**.
- YM2149 ST Synth tests and readable package tests: **109 passed**.
- Native additional-AY route regression: **114 cases**, 466,944 stereo frames, maximum difference **0**.
- Authenticated SDK / runtime artifact checks and `git diff --check`: passed.

Reports: [SDK and WASM comparison](verification_ym2149_st_single_output_sdk_20261116.json), [source Chromium / WebKit replay](verification_ym2149_st_single_output_source_browser_20261116.json).

The SDK report retains input hashes, profile/group counts and detailed wrapper / Player checks. Repeated per-case metrics from the full 5.9 MB local report are summarized; its exact size and hash are retained, and the verifier reproduces the cases from generated inputs.

Source Chromium and WebKit both import an original generated VGM with flags `0x02`, produce measurable PCM, retain the flag in Live snapshots, and Pause / Resume without losing position. Existing VGM / VGZ, LHA YM and ICE SNDH cases also pass. Speaker output is permanently muted by the test instrumentation; this verifies generated PCM and UI behavior, not human listening.

## Shared calibration freshness

The AY JS / WASM changes invalidate previous served-source fingerprints even when the measured default profile is unchanged. Historical reports remain untouched. A fresh offline [PSG measurement](soundchip_psg_levels_06.json) covers 18 actual WASM captures; its statistics and derived defaults match the previous report exactly.

Fresh complete browser matrices cover [PS1 SPU](ps1_ay_single_output_chip_levels_01.json), [WonderSwan](wonderswan_ay_single_output_chip_levels_01.json), [POKEY](pokey_ay_single_output_chip_levels_01.json) and [SCSP](scsp_ay_single_output_chip_levels_01.json), including Chromium / WebKit, 44.1 / 48 kHz, Main / Worker and primary / extra roles. These record current source hashes and verify continuous PCM with physical outputs muted. PS1 / WonderSwan gains are unchanged. Recomputed POKEY gains differ by about 0.000017–0.000018, and SCSP extra gain by 0.000001, reflecting the measured capture window; values are retained as measured.

Affected policies receive complete applied-gain verification: [POKEY](pokey_ay_single_output_chip_levels_verify_01.json) and [SCSP](scsp_ay_single_output_chip_levels_verify_01.json). The existing PS1 / WonderSwan applied-gain proofs remain applicable to their identical gains. Generated policy freshness is checked against these current reports without altering the old calibration evidence.

Both the public sound-chip Mixer and Playground policy generators pass freshness checks. Other sound-chip DSP sources and the measured AY default output profile retain their existing behavior; the additional gain differences above are measured policy rounding, not chip-core changes.

The calibration follow-up passes **71 targeted tests**, verifies the strict current-policy receipt, and builds the npm source package successfully (361 modules, 28 JS/WASM pairs and 412 declaration files). See [calibration evidence and historical-report handling](verification_ay_single_output_calibration_20261116.md). Historical VAB evidence correctly remains stale for the new AY WASM; no DSP hash bypass was added to make it appear fresh.

The complete historical calibration guard suite passes **459 / 459**, compared with **447 / 447** on isolated pre-change commit `2484643630a824dd4168c4731997ff0fe4eec647`. Test-only reconstruction preserves archived VAB source-pair checks without bypassing live DSP dependencies. Two passive UI cache identities are restored to their original values; a separately pinned, two-path / six-report cache receipt authenticates their equivalence to the aliases captured during the new measurements. Historical reports and receipts remain untouched.

## Readable package

```sh
sh scripts/package_itch_ym2149_st_synth.sh single-output-20261116-r2
```

Created `release/tetorica_ym2149_st_synth_single-output-20261116-r2_itch.zip`:

- 197 files, 2,386,966 bytes.
- SHA-256: `6d86b42dad9f50e92bc20d803f9d3329dfeeaae81c1066ca39e854324ea5645d`.
- Original readable browser modules and native rebuild sources / provenance remain included.
- Packaged Chromium / WebKit reference tests pass, including flags `0x02` with positive AC-RMS (about 0.0014, independently of its DC offset), retained Live flags, Pause / Resume and native Worker cleanup.
- Existing Keyboard / Code and audio-device recovery tests also pass. The browser regression now waits for a sounding part of the Code loop before recording PCM, so an intentional rest cannot be mistaken for a failed audio path.

See [packaged reference evidence](verification_ym2149_st_single_output_package_browser_20261116.json) and [packaged instrument evidence](verification_ym2149_st_single_output_instrument_browser_20261116.json). All physical speaker routes were muted during automation. The dedicated workflow now also runs the independent original-MAME verifier. Remote Actions has not been run for these uncommitted changes.

## Scope and limitations

VGM replay honors the file's output model; the default editable 2 MHz YM2149 instrument remains on its existing output profile. Static Capture copies register settings, not the reference chip's analog model, oscillator / envelope phase, timer routines or interactions with the other two channels.

No original user VGM was supplied with this report; reproductions use generated fixtures. Other unsupported chip types, flags or commands in the same file can still produce their own explicit errors. No npm publication, commit, push, tag or public release was performed.
