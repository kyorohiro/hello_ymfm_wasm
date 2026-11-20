# SID timed register API — 2026-11-21

Authorized after Files and Code-workspace alignment. Implement the existing
build / schedule / compile / captureState contract for the selected SID model.
Preserve immediate APIs and C64 song playback. No npm publication, release,
Tauri import, commit/push/tag or remote CI is requested.

- [x] Define a bounded, serializable recorder for existing raw register,
  waveform/voice, filter, frequency/note and Gate operations. Reuse SidSynth
  conversion/validation on isolated state instead of duplicating register math.
  Exclude reset/initialize/clock/disposal from operation programs.
- [x] Build callbacks run once without reading/changing live state. Support
  absolute atSeconds and atSample offsets, configurable reference rate (44100
  default), stable same-time order and repeated event writes.
- [x] Resolve packed waveform/Gate/Sync/Ring/Test, ADSR, Pulse width and shared
  filter/routing/volume fields against state at actual application time. Keep
  6581/8580 model and clock compatibility explicit.
- [x] Add detached captureState snapshots and compile current / client / reset /
  supplied snapshot, including necessary initialized/resolver metadata. Captures
  do not pause audio and do not claim to be full SID/C64 save states. Explicitly
  reject incomplete client shadows or incompatible snapshots.
- [x] Reuse Performance Queue for sample-clock Worklet execution, compact
  repeats, named replacement/cancel, atomic validation and staged transactions.
  Preserve Run/Apply/Stop, loop-generation and ownership; old Off/cancel must
  not release a later manual Gate. No JS timer or audio-thread callback fallback.
- [x] Wire shared Web Audio Main/Worker clients and Synth's borrowed SID,
  model/session lifecycle, manual controls and accepted author checkpoint. Keep
  song/Code mutual exclusion and ordinary view/save behavior. Unsupported Native
  capture/execution must reject explicitly rather than imply support.
- [x] Add declarations/completion/source navigation and editable Files examples
  without overwriting existing edits. Keep the regular beat-based starter.
- [x] Verify both actual SID cores, partial updates/interleaving/repeated Gates,
  snapshot reuse, compile/execution agreement and 44.1/48 kHz timing; Run/Apply/
  Stop and source/readable ZIP in physically muted Chromium/WebKit + Monaco /
  fallback. Preserve ordinary inactive-timing PCM and measured gains.
- [x] Sync canonical runtime/generated mirrors using existing tools, complete
  package/type/artifact checks, and record actual capabilities and limitations.

Reference: [shared contract](todo_synth_timed_register_api_20261119.md),
[SID alignment](todo_sid_synth_fm2612_alignment_20261119.md),
[DMG implementation](todo_dmg_timed_register_api_20261120.md).


## Verification record

- SID Node suites: **442/442** passed, including both actual cores, compilation
  and execution, packed updates, repeated Gate On/Off, parameter/manual Gate
  interleaving, failed/staged Apply, model replacement and physical Stop faults.
- Common Performance Queue/ownership regression set: **116/116** passed.
  Main primary / createSoundChip / useSoundChip and transferred logic Worker
  routes have actual runtime staging/owner tests; no timer-based execution.
- `node scripts/check_fm2612_types.mjs` passed: **404 modules, 465 checked
  declarations**, installed NodeNext/Bundler and browser-without-Node consumers,
  including positive/negative SID timed calls. Local package version unchanged.
- `node scripts/check_web_runtime.mjs dist/fm2612` passed; runtime artifact
  verification passed **33 SDK builds, 68 outputs and 75 mirrors**. No core,
  native build receipt or measured mixer gain changed.
- Ordinary playback parity: **282 conditions / 1,155,072 stereo frames**, actual
  pre-change/current SID clients and Worklets plus primary YM2612/shared
  Performance Processor. 6581 PAL/NTSC and 8580 PAL at 44.1/48 kHz, YMFM/Nuked
  primary paths, irregular render partitions: every PCM sample bit-identical.
  See `sid_timed_default_pcm_01.json` and its pinned exact-source revision.
  Current mixer preset generation `--check` and **54 focused resolver/source
  guard tests** passed; historical measurement records remain untouched.
- Browser matrix: **8/8 cases, 56 app-stage checks**, current source and actual
  extracted readable ZIP × Chromium/WebKit × Monaco/fallback. Both SID models,
  Run/Apply rollback, context retention, manual parameters/Gate ownership,
  stopLoop, Stop/restoration, model-snapshot rejection, source navigation and
  narrow layouts passed. Public Main/Worker routes additionally passed for both
  models in source cases. All output was physically muted before AudioContext;
  no listening is claimed. No unexpected network/page/unhandled/console errors.
  Evidence: `build/sid-timed-20261121/verified3/browser-matrix.json`; every served
  file's hash was rechecked against the final source/extracted ZIP.
- Verified readable ZIP: **357 files, 3,686,639 bytes**, SHA-256
  `c3f67d4635921e7456125d17240c801869d05a7eb89d9fd4e2a6c8073f22dfda`,
  at `build/sid-timed-20261121/package/tetorica_sid_synth_timed-verified-20261121_itch.zip`.
  Its editable-module/source-provenance packaging tests passed **2/2**.

Try after reloading the app: Files → `examples/timed-voice.js` → Code → Run.
The original starter is preserved. Existing edited examples are not overwritten.
`node scripts/check_sid_timed_browser.cjs` reruns the focused browser checker;
its root/entry/editor options can target an extracted standalone ZIP.

## Intentional limits and follow-up

- The Synth's borrowed SID has no complete client shadow: `initialState:
  "client"` rejects with a clear message. Its `current`, `reset` and supplied
  snapshot modes work. Shared Main/Worker clients support local `client`
  compilation but do not claim to include later scheduled/other-writer edits.
- Reset is uninitialized hardware state. High-level operations preserve their
  existing initialize requirement; raw register operations can compile from it.
- Snapshots contain resolver registers/model/clock/initialization metadata,
  not SID oscillator/envelope phase or a C64 machine save state.
- Successful model replacement clears reservations; failed allocation retains
  the old live model and reservations. Immediate borrowed `dispose()` retains
  its existing patch-restore meaning; only host Stop retires that Code lease.
- Recorders cover existing register-only methods. Initialization, reset, clock
  changes, disposal, PCM transfer and DSP are not recorded operations.
- Native timed execution and authoritative capture remain explicitly
  unsupported. SID songs and Code remain exclusive. Human listening, npm
  publication, Tauri import and optional UI alignment remain separate work.
- Some broader historical calibration fixture tests already fail at pre-task
  HEAD `8f1b7563ea1d845e67f4fbdfd06aaf597936bc33` (including ASWAN navigation
  and YM2608 source-mix-history fixtures). A read-only clean-HEAD projection
  reproduced those failures. Their guards were not weakened; the current mixer
  generator and the new/preceding source-revision guard tests pass.

No commit, push, tag, npm publication, remote CI or Tauri import was performed.
