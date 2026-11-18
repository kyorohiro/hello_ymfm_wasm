# SCSP Synth output level and New Cassette — 2026-11-18

Base `db1e739d5bf8dac68bf93aa3aea34ef098153b25`; initially clean worktree.
User reported that Master 380% was still quiet and requested New → Cassette
above Import. These changes precede the multi-slot Capture / DSP roadmap.

## Output level

The application had a private 0.125 gain before Code FX and independently on
the song input. Even Master 380% therefore produced only 0.475 times native
output. This was not duplicate serial attenuation or the separately measured
common Mixer factory policy.

One shared compensation gain of 8 now follows Code FX / Stop fade and the
song-input merge, before the final Master. Dry native output therefore has
unity application gain at Master 100%. Keyboard, Code, native DSP, SSF / VGM
and paused audition use that same route. The post-Master output node still
feeds the visualizer / Desktop capture and the single physical destination.
Disposal disconnects the extra gain.

The 0.125 Code-FX input drive is preserved: moving the increase before FX
would change nonlinear processing. Raw core rendering, samples, hardware
mix/envelope/modulation settings and common calibrated Mixer gains are
unchanged. The existing 60% startup, 0–380% range, orange boost indication and
smooth Master changes remain. This is an intentional +18.06 dB application
output change, not a limiter or per-instrument normalization.

Twenty-four actual-WASM offline cases cover default PCM/FM, 44.1/48 kHz,
DSP FIR/IIR, Cycle2, native SSF, full-scale PCM and polyphony. The initial Sine
native peak is 0.1489258. At Master 100%, its peak changes from −34.60 to
−16.54 dBFS; at 380%, from −23.01 to −4.94 dBFS. Single initial notes remain
below full scale. Dense polyphony, full-scale imports, simultaneous routes
and boosts can exceed full scale; existing native sum clipping is not repaired
or hidden. Offline multiplication retains overrange floats for measurement.

## New Cassette

Menu now places **New → Cassette…** above **Import**. Existing Import / Export
remain available. The dialog offers Cancel, export current and create, or
create without export. The detached candidate contains the default instrument,
the original host starter `index.js`, five bundled examples and a fresh project
identity. The new project opens in Keyboard mode and never executes Code.

One operation-time sound read supplies both the optional backup and rollback,
including current v11 / Code edits beyond the portable cache. Unavailable or
invalid reads fall back explicitly to the cached instrument. Preparation and
backup finish before old performance owners retire. Cancellation and export /
Apply / editor failures retain the previous files, settings and identity;
failure after performance retirement does not restart old playback.
Successful replacement commits local persistence; save failure offers export.
The dialog wraps at 390 px and uses existing file-dialog styling.

## Verification

- **501 SCSP unit tests pass.** Coverage includes exactly-once output gain,
  nonlinear FX drive, Master zero/default/max, independent song routing,
  Stop fade / disposal, detached new-project construction and transactional
  backup / cancellation / rollback / storage failures.
- **22 existing Code browser regression checks pass** across Chromium and
  WebKit at 48 kHz with physical output permanently muted. Code / manual
  coexistence, actual native FX, Stop, delayed startup Master edits, fractional
  pitch, PCM drafts, portable files / Cassette and narrow layouts are retained.
- **14 focused source-browser checks pass** across Chromium and WebKit at
  48 kHz. Passive PCM taps verify native / pre-FX / compensation / post-Master
  ratios for keyboard, real Code FX, native SSF and paused audition at
  0 / 60 / 100 / 380% Master. Each engine has one AudioContext and one permanently
  muted destination route. Real UI checks cover New above Import, cold Cancel
  without audio, Escape during Code / SSF, PCM draft retention, current Code
  edits in the backup, fresh defaults / examples, local reload and valid /
  invalid Import. Desktop and 390 px dialogs were visually inspected.
- **Two package tests pass**, and the actual CLI archive has 388 files / four
  dependency bundles. Its fresh extraction passes the same **14 focused
  browser checks** through the root `index.html` with the frozen source checker.
  All 117 shared served assets are byte-identical; entry differences match
  existing packaging URL/link rewrites. Packaged dialogs were visually reviewed.
- **13 exact proof tests and two source recorders pass**, including all
  21 predecessor contexts. Receipt object pin:
  `c4bb5bb488a3aad7da5be5723a8dfa0d5ca486c17228570c457813525ff756e6`.
  The receipt explicitly records the changed application output gain and
  separately preserves the common Mixer / raw-core scope.
- Both actual Mixer freshness generators pass. Historical measurement reports
  and generated common Mixer defaults retain their original bytes.

Evidence directory: `build/scsp-output-level-20261118/`.
Verification ZIP:
`release/tetorica_scsp_synth_output-level-new-cassette-db1e739d_itch.zip`.
The [machine record](verification_scsp_output_level_new_cassette_20261118.json)
binds final sources, measurements, proofs, browser results and archive bytes.

Physical listening was not performed. No Capture/DSP feature addition,
public sound-chip API/core/WASM/calibrated Mixer change, npm/version/publication,
commit/push/tag or Tauri work.
