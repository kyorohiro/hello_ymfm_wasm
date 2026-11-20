# Synth timed register API rollout

Recorded: 2026-11-19; implementation status updated 2026-11-20.
YM2149 ST and YM2612 provide the reference implementation. HuC6280 is implemented; SPU now has its first register-operation slice.
Later API-port order is not implied by the Files/UI rollout.

| Synth | Status / individual TODO |
|---|---|
| FM2612 / Genesis | YM2612 present; other chips separate: [TODO](todo_fm2612_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| YM2149 ST | Present; preserve and verify: [TODO](todo_ym2149_st_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| HuC6280 / PC Engine | Present: [TODO](todo_huc6280_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| PS1 SPU | Existing-sample note/pitch/ADSR/reverb plus hardware Noise/PMON implemented in Web Audio; see [verification](todo_spu_timed_register_api_20261120.md). Remaining scope: [TODO](todo_spu_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| DMG | Planned: [TODO](todo_dmg_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| SID | Planned: [TODO](todo_sid_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| FM2608 / PC-98 | Planned: [TODO](todo_fm2608_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| 2A03 / NES + FDS | Planned: [TODO](todo_2a03_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| S-DSP / SNES | Planned: [TODO](todo_snes_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| SCSP / Saturn | Planned; distinct from DSP assembly: [TODO](todo_scsp_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| ASWAN | Synth Web Audio parameter slice (`setVolume`/`setPan`, frequency/note, Noise/Sweep) implemented; scheduled gates, RAM/PCM and general Playground/npm remain separate: [TODO](todo_aswan_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |

## Shared acceptance contract for each port

- [ ] `build()` records serializable high-level operations and absolute offsets
  without copying/changing the live chip or UI. Its JS callback runs once.
  Reuse the chip's operation resolver rather than duplicating immediate APIs.
- [ ] `schedule()` resolves partial updates against the state at application
  time, preserving same-time order and all event/retrigger writes, even when
  the value repeats. Preserve each chip's register widths and ports.
- [ ] Execute on the AudioWorklet sample clock; no JS timer fallback or JS
  callback on the audio thread. Keep repeats compact. Retain named replacement,
  cancellation, atomic rejection, Performance Queue/ownership/generation and
  Run/Apply/Stop behavior; manual and reserved writes follow actual order.
- [ ] Support `atSeconds()` and `atSample()` as absolute offsets, with a
  configurable reference sample rate (default 44100), independent of device
  rate. Do not change existing `await beat()`/`sleep()` or add builder beat time.
- [ ] `compile()` uses the same resolver on isolated working state and returns
  structured times/registers/values/ports, including repeated writes and only
  writes produced by the operations. It is a prediction, not a playback log.
- [ ] Support `initialState: "current"` (default, coherent asynchronous renderer
  capture without stopping audio), `"client"` (no capture request, explicitly
  limited JS shadow), `"reset"`, and a reusable captured snapshot. Reject
  incompatible chips/configurations and explicitly handle incomplete shadows.
  Snapshots include resolver metadata, stay detached from later playback, and
  are not mutated by compilation. Follow existing `captureState()` naming.
- [ ] Preserve immediate APIs and YM2612 `scheduleWrites()` compatibility.
  Reflect supported ports in JavaScript, declarations/completion and examples,
  Main/Worker and existing Native routes where applicable; no silent fallback.
- [ ] Verify partial packed-register updates, repeated event writes, same-time
  ordering, snapshot reuse/immutability, compilation/execution agreement,
  interleaved manual writes, rejected reservations and 44.1/48 kHz timing.
  Use muted source/readable-ZIP browser checks and record actual backend limits.

PCM RAM transfers, streaming payloads and DSP programs are separate work. For
chips that need them, first define a bounded supported-operation list; do not
imply that arbitrary PCM/DSP content can be placed in a register schedule.
Existing ordinary `liveLoop` performance is not equivalent to this API.

This index does not authorize npm publication, release, commit, push or remote CI.
Individual implementation notes distinguish verified slices from remaining work.
