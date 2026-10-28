# PCM → PS1 SPU ADPCM — 2026-10-28

Base commit: `baf12fc1` (PS1 Browser mode).
Public guide: [../ps1_adpcm_encoder.md](../ps1_adpcm_encoder.md).

## Implemented

- Original BSD-3-Clause `encodePs1Adpcm()` in `web/ps1_adpcm_encoder.js` for
  normalized finite mono Float32 PCM. Browser, Worker and Node share one pure
  implementation; Playground exposes global / `pg.encodePs1Adpcm`.
- Complete 16-byte / 28-frame packets, low nibble first, filters 0–4 and shifts
  0–12. Deterministic greedy nearest-nibble search matches the pinned decoder
  and excludes overflowing candidates. First and loop-start packets use filter 0
  so loop entry is independent of previous decoder history.
- Strict inputs, loop alignment and byte budgets. One-shots receive encoded
  zero padding; loops are never silently padded. Default 520,192 bytes fits an
  empty Synth. Existing allocations remain the caller's responsibility.
- Owned ADPCM plus lengths, loop metadata and JSON-safe raw reconstruction
  metrics. No resampling, gain normalization or pitch inference. Tuning is
  declared at `loadADPCM`. Conversion runs during preparation, outside Worklet.
- Third editable PS1 example `examples/ps1/ps1-pcm-adpcm.js` uses `livePrepare`
  to reuse its upload on live rerun. Previous starter/examples remain. No Mixer
  settings are applied by the example.
- Node `examples/nodejs/main_ps1_adpcm.js` emits original loop/one-shot ADPCM,
  tuning/metrics JSON and an actual SPU-rendered WAV. Main/Worker globals,
  Monaco navigation, Playground/npm types and package dependencies are wired.
  Changed preparation modules use cache revision `ps1-adpcm-encoder-1`.

## Verification

- Encoder **7**, actual decoder/core **4**, existing Synth **7** and raw SPU
  **15** tests pass (33 tests, zero skips). A bridge calls the real pinned C++
  decoder rather than a reimplementation. Raw metrics match native output for
  silence, full-scale data, transients and noise, with no overflow exploitation.
- Nonzero loop entry, unrelated prior history, single flags-7 packet loops and
  final-packet-only loops pass. Boundary loops repeat exactly for 64 periods.
  CH24/440 Hz/signed stereo/Stop/retrigger/one-shot END pass, with Native/WASM
  PCM, registers and RAM byte-identical.
- Main/Worker runtime **260** and catalog/declaration/Monaco **43** tests pass.
  All mode declaration fixtures, including negative codec options, pass.
- Isolated npm payload: **983 files**, **379 declarations**, **1,079 asset
  references**, 28 existing WASM engines and 15 renderer checks. Both codec
  subpaths, real SPU conversion/replay and NodeNext/Bundler/Browser positive and
  negative consumer types pass. Version remains 0.2.32; nothing was published.
- Source / actual Run ZIP × Chromium / WebKit × Main / Worker: **8 routes pass**.
  Checks include global/pg equivalence, eight invalid inputs, one-shot padding,
  CH24 audio, exact example twice, live rerun without duplicate uploads, exact
  Stop silence and authored-error recovery. Physical output stayed muted.
- Node preview `/private/tmp/ps1-adpcm.wav`: 44,100 Hz, 2 seconds, peak 0.500519,
  finite unclipped stereo and final 200 ms exact silence. Original loop:
  112 frames / 64 bytes / raw SNR 28.8166 dB. One-shot: 4,097 → 4,116 frames /
  2,352 bytes / raw SNR 43.9498 dB. These are raw errors, not listening scores.
- All three standard packaging commands pass. Full/Run Playground archives
  pass CRC, safe paths and equality with all staged bytes. Run has **918 entries**,
  below itch.io's 1,000 limit. Analyzer calibration guard and actionlint pass.

Run ZIP: `release/hello_ymfm_wasm_ps1-adpcm-encoder-dev_itch_playground_for_run.zip`
(SHA256 `3860c93c7153a8bbd46ff3b9bb41ef8ded8fcb48972ab8ecc874f4dbd3e37540`).
Hashes, captures and receipts: [ps1_adpcm_encoder_01.json](ps1_adpcm_encoder_01.json).

## Remaining scope

Sample Editor conversion/instrument saving, SDK adoption and the Tauri Native
adapter remain separate milestones. C++ core, generated WASM, existing playback
implementation and Mixer gains are unchanged. No periodic polling or encoder
work is added to audio rendering. Human listening/hardware comparison was not
performed. This remains a lossy greedy codec over the experimental SPU core.

No commit, push, tag, npm/SDK publication, Tauri import, remote CI run or itch.io
upload was performed. CI now includes the codec, Node example and packaged
Browser tests. Plan: [todo_ps1_01.md](todo_ps1_01.md).
