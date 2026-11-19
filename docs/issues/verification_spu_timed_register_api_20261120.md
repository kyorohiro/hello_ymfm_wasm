# SPU timed operations — 2026-11-20

Implemented and locally verified. No commit, push, tag, npm publication, Tauri
import or remote CI was performed by this task. All browser output was muted
before audio startup; no human listening test is claimed.

## Supported path

`useSoundChip('ps1')` in SPU Synth Code and Playground Main/Worker supports:

- `build(b => …, {referenceSampleRate:44100})`, synchronous state-free recording.
- `schedule(program, {name,repeatSeconds})` and `clearSchedule(name)` on the
  existing AudioWorklet Performance Queue. Named replacements and staged entry
  evaluations retain the existing Run/Apply/Stop and loop owner lifecycle.
- `compile(program, {initialState})`: current (default), reset or captured snapshot.
  It returns ordered `{offsetSeconds,register,value,operationIndex,writeIndex}`
  rows without changing the live chip. Register addresses are byte offsets from
  `0x1f801c00`; values are 16-bit words.
- `captureState()`: detached instance-checked resolver metadata, without PCM/RAM,
  native decoder/oscillator phase or an audio save-state restore operation.

Recorded methods: setPreset/setChannel/setEnvelope/setReverb, setPitch,
setFrequency/setNote, keyOn/keyOff, noteOn/noteOff and allNotesOff. Samples must
already be assigned. Reset compilation starts without assigned samples.
`client` compilation rejects explicitly because the browser mirror is incomplete.
Native exposes recording/reset compilation, with explicit AudioWorklet-required
errors for scheduling and authoritative capture; no timer fallback was added.

The Synth dispatches semantic calls through its existing Code path. Guarded
noteOff and raw keyOff keep their existing distinction, including manual key
ownership. A compiled hardware trace does not claim to include Synth-only
click-guard fades, PMON helper voices or software output routing.

A new Cassette seeds `examples/timed-phrase.js`; saved projects are retained.
Monaco types and source navigation cover the recorder, compiler and snapshot.

## Local checks

- `npm run test:spu-synth`: **484 passed**, including real SPU/WASM register timing
  at 44.1/48 kHz, same-time retriggers, mixed sample/seconds offsets, custom
  reference rate, compile/schedule hardware traces, partial updates after manual
  edits, immutable snapshot reuse, rejected replacement, stage/commit and Stop.
- Additional runtime integration suite: **138 passed** (PS1 clients/Worklet,
  Native immediate controls, shared performance sender and lifecycle).
- Distribution/calibration/source-history/ZIP tests: **156 passed**.
- `node scripts/check_spu_timed_browser.cjs`: Chromium and WebKit; Synth
  Run/Apply/rejected Apply/Stop, actual Main/Worker clients with shared instance,
  existing 0.5-second Worker lead and performance session. Physical mute asserted.
- The same Synth checks passed against the generated readable SPU distribution
  using `SPU_TEST_ROOT` and `SPU_TEST_SYNTH_ONLY=1`.

## Fresh Mixer evidence

Shared transport imports changed, so four complete raw measurements and their
complete generated-policy verification were rerun. The original reports and
153-route baseline remain unchanged; production source freshness was not waived.
All eight reports have complete coverage, physical mute and continuous pilot PCM:

| Kind | Raw report | Verification | Measured routes per run |
|---|---|---|---|
| PS1 | [raw](ps1_spu_timed_chip_levels_01.json) | [verify](ps1_spu_timed_chip_levels_verify_01.json) | 48 + 8 YM2612 anchors |
| WonderSwan | [raw](wonderswan_spu_timed_chip_levels_01.json) | [verify](wonderswan_spu_timed_chip_levels_verify_01.json) | 48 + 8 YM2612 anchors |
| SCSP | [raw](scsp_spu_timed_chip_levels_01.json) | [verify](scsp_spu_timed_chip_levels_verify_01.json) | 48 + 8 YM2612 anchors |
| POKEY | [raw](pokey_spu_timed_chip_levels_01.json) | [verify](pokey_spu_timed_chip_levels_verify_01.json) | 96 + 8 YM2612 + 8 PSG + 8 dual checks |

The common target stays 0.12881777435541153. PS1 and WonderSwan gains are unchanged.
SCSP and POKEY round by one 0.000001 gain step in the fresh measurements. No new
loudness policy was introduced. Both policy generators now use these fresh reports.
Historical stale-source negative tests retain rejection, including the earlier
pinned SPU CSS mismatch that can be encountered before the older expected guard.

## Packaging

- `sh scripts/package_itch_spu_synth.sh timed-spu-final-20261120`: source/SDK
  checks passed; readable frontend modules and corresponding source retained.
- `sh scripts/package_itch_playground.sh spu-timed-ready-20261120`: complete and
  `_for_run.zip` distributions passed. The four new SPU modules are in the explicit
  runtime list. Browser upload retains the 1,000-entry limit and exact-byte checks.
- Finder `.DS_Store` is excluded from browser traversal/ZIPs. One duplicate SDK
  license is archived with the corresponding sources while its identical
  `sources/LICENSE` copy remains readable. No original license/source is lost.

Remaining: public Noise/PMON timed controls, safe raw-register authoring, Native
queue execution, and optional human listening / real PSF interaction checks.
