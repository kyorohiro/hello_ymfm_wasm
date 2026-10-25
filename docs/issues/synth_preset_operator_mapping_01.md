# Synth: built-in preset operator mapping

Date: 2026-10-25

## Problem

Selecting `1OP Basic` in Synth left two audible carriers under algorithm 7:
OP3 had TL 2 / RR 13, and OP4 retained the startup TL 8 / RR 8.

`FM_PRESETS` stores operators in a zero-based array. Synth's `applyPresetData()`
read it with the displayed operator numbers 1–4, shifting OP2–OP4 onto OP1–OP3.
The missing fourth entry was merged with the previous operator state. The
canonical presets and `YM2612Synth.setPreset()` already handled the indices
correctly; the defect was in the Synth application.

## Changes

- Detect zero-based presets and one-based imported/saved snapshots when loading.
- Replace each operator from independent defaults, so omitted RS, AM and SSG-EG
  settings cannot carry over from a previously edited instrument.
- Keep the one-based TFI/VGI and Synth snapshot format unchanged.
- Update the Synth entry module URL so the corrected application is requested.

`1OP Basic` now loads TL values `[127, 127, 127, 2]` with RR 13 on OP4.

## Validation

- `node --test docs/synth/*.test.mjs`: 73 passed.
- `node scripts/check_synth_files_browser.cjs`: Chromium and WebKit passed,
  including TFI/VGI, Cassette, draft restore and Sync/Revert.
- `sh scripts/package_itch_synth.sh preset-fix`: 222 local references resolved;
  generated `release/hello_ymfm_wasm_preset-fix_itch_synth.zip`.
- `node scripts/check_synth_adsr_browser.cjs --root=release/itch_synth_preset-fix --entry=/index.html`:
  Chromium and WebKit passed against the packaged application.
- The same browser check with `--entry=/index.html?engine=nuked` passed in both
  browsers. Checks cover all 16 built-in presets, all four displayed operators
  and all six Synth channels, omitted-field reset, one-based VFS restore,
  immutable built-ins, lazy audio startup and real Worklet output while editing.
- Running the new regression against a separate copy of the pre-fix Synth failed
  at the initial `1OP Basic` assertion with exactly the reported OP3/OP4 values.

The application fix does not change shared preset definitions or npm package
sources. Previously saved instruments retain their saved parameters; select
the built-in preset to load the corrected one-operator sound.
