# FM2612 / SPU Synth Master volume: 380% (2026-11-02)

The FM2612 Synth and SPU Synth Master controls now reach 380%, matching VGM
Analyzer's linear 3.8× output gain. Startup stays at 100% for FM2612 and 70%
for SPU. The existing blue colour at or below 100% and orange above 100% stay
in place. This scales the final browser output, preserving chip voice volumes,
SPU mixing headroom, instrument files and the sound at existing Master values.

FM2612's existing MegaSynth API already accepts 3.8; only its UI limit changes.
SPU's main-thread output-gain validator now accepts 0–3.8 during creation and
live edits. Nonfinite/out-of-range values fail before changing the gain.
Changed entry/import query versions ensure the updated SPU validator and both
Master controls load together. No SDK, npm package or published site changes
are needed for this Web update. Neither Web Synth persists Master in its
instrument/preset files, so no saved instrument migration is involved.

## Verification

- `npm run test:spu-synth`: 70 passed, including real SPU WASM, gain validation,
  creation at 380%, old 70% / 200% values, mute, invalid inputs, portable
  instruments, compensated Sine regressions and isolated ZIP integrity.
- `node --test docs/synth/synth_runtime.test.mjs docs/synth/synth_project_state.test.mjs`:
  6 passed.
- `node scripts/check_synth_master_ui_browser.cjs docs/issues/synth_master_volume_380_browser_20261102.json`:
  FM2612 and SPU passed in Chromium and WebKit. The test checks startup defaults,
  380% chosen before audio startup, percentage readouts, the 100% colour
  threshold, mute and output ratios at 50%, 200% and 380%. All speaker
  connections are intercepted and muted; this is a PCM measurement, not a
  listening assessment.
- Desktop/mobile Master screenshots (1200 / 390 pixel viewports) were inspected
  locally; 380% remains visible beside each control.

Measured RMS relative to each instrument's 100% output:

| Browser | Synth | 50% | 200% | 380% |
| --- | --- | ---: | ---: | ---: |
| Chromium | FM2612 | 0.49970× | 1.99943× | 3.79861× |
| Chromium | SPU | 0.50043× | 2.00230× | 3.80278× |
| WebKit | FM2612 | 0.49964× | 1.99963× | 3.79789× |
| WebKit | SPU | 0.50010× | 1.99861× | 3.79925× |

The gain test now waits for the Files controller to finish applying the
sustained Sine preset and for the requested keyboard note to become active.
Waiting only for the select's value could measure the previous, decaying
instrument while the asynchronous preset operation was still pending.

## Local distribution checks

Both newly named local ZIPs passed ZIP integrity and contain the 380% Master
control. Existing browser checks served these distribution files without
repository fallback:

- FM2612: Chromium / WebKit startup, TFI import, real keyboard PCM, quiet
  release and replay passed. The package resolved 226 local module/asset
  references.
- SPU: Chromium / WebKit review passed, including common instrument startup,
  accessible settings tabs, paired Pitch/Morph controls with held-note edits,
  and note ownership after rejected PMON changes. The package has 46 files,
  three application bundles and an authenticated source archive.

| Local ZIP | Bytes | SHA256 |
| --- | ---: | --- |
| `hello_ymfm_wasm_gain380-20261102_itch_synth.zip` | 779401 | `887c88b3c5e79e05004be45cc43aad1f269beb2a397d5dec3bac5e59e6c0b641` |
| `tetorica_spu_synth_gain380-20261102_itch.zip` | 5542073 | `da677a0ee00aaaceb58461445e338e91d25ad30169e49804611e5d402fd8f9e6` |

Evidence:

- [Master output measurements](synth_master_volume_380_browser_20261102.json)
- [FM2612 ZIP browser checks](synth_master_volume_380_fm_zip_browser_20261102.json)
- [SPU ZIP browser checks](synth_master_volume_380_spu_zip_browser_20261102.json)

The ZIPs are ignored local build outputs under `release/`; nothing was uploaded
or published, and installed applications were not changed. The native SPU
plugin's gain and automation changes are tracked separately.
