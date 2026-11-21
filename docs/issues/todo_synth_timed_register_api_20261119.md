# Synth timed register API rollout

Recorded: 2026-11-19; implementation status updated 2026-11-21.
YM2149 ST and YM2612 provide the reference implementation. HuC6280 is implemented; SPU now has its first register-operation slice.
Later API-port order is not implied by the Files/UI rollout.

Priority correction (2026-11-21): the user explicitly prioritizes finishing
this timed API rollout and the remaining Code / Synth expanded workspaces over
additional Live highlights. Keep partial ports/backend exclusions explicit;
do not mistake ordinary Code playback or DSP compilation for timed operations.
See the [current alignment priority](todo_synth_fm2612_alignment_20261119.md#current-priority--user-correction-2026-11-21).

| Synth | Status / individual TODO |
|---|---|
| FM2612 / Genesis | YM2612 present; other chips separate: [TODO](todo_fm2612_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| YM2149 ST | Present; preserve and verify: [TODO](todo_ym2149_st_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| HuC6280 / PC Engine | Present: [TODO](todo_huc6280_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| PS1 SPU | Existing-sample note/pitch/ADSR/reverb plus hardware Noise/PMON implemented in Web Audio; see [verification](todo_spu_timed_register_api_20261120.md). Remaining scope: [TODO](todo_spu_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| DMG | Pulse / Wave / Noise register operations, notes and raw Gates implemented in Synth and shared Web Audio Main/Worker clients; Wave uploads preserve DAC-stop semantics. Native execution/capture remain unsupported; npm 0.2.46 is published: [verification](todo_dmg_timed_register_api_20261120.md), [TODO](todo_dmg_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up). |
| SID | 6581/8580 register-operation recorder/compiler, reusable snapshots and Web Audio sample-clock scheduling implemented in Synth and shared Main/Worker clients. Available in npm 0.2.46; Native execution/capture remain separate: [verification](todo_sid_timed_register_api_20261121.md). |
| FM2608 / PC-98 | FM/SSG/Rhythm/loaded-sample ADPCM-B recorder/compiler, detached snapshots and Web Audio scheduling implemented in source; standalone timed Mixer/Stop integration is verified. Memory transfer, Native execution and scheduled-state Live UI remain separate. [Verification](todo_fm2608_timed_api_20261121.md). [TODO](todo_fm2608_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| 2A03 / NES + FDS | Pulse/Triangle/Noise and prepared DMC playback are implemented in Synth and shared Web Audio clients, with detached snapshots, compact reservations and Code ownership. DMC memory/FDS/Native remain separate: [verification](todo_2a03_timed_register_api_20261121.md). Remaining scope: [TODO](todo_2a03_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| S-DSP / SNES | Planned: [TODO](todo_snes_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| SCSP / Saturn | Planned; distinct from DSP assembly: [TODO](todo_scsp_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| ASWAN | Synth Web Audio parameters, owned Synth notes and raw Gates implemented. Shared Playground/npm 0.2.45 supports hardware parameters and raw Gates; software Envelope notes remain Synth-only, RAM/PCM and Native scheduling remain separate: [public rollout](todo_wonderswan_timed_public_api_20261120.md), [Synth TODO](todo_aswan_synth_fm2612_alignment_20261119.md#timed-register-api-follow-up) |
| SMSGEAR / YM2413 | Source recheck 2026-11-21: Sega PSG / YM2413 shared timed clients are connected to borrowed Synth Code clients; preserve their existing scopes and backend exclusions. See [Synth TODO](todo_smsgear_synth_20261120.md). This records existing code, not new validation. |

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
## Deferred display follow-up

Executed schedules need a separate, rate-limited Synth Live view. See
[Scheduled performance Live UI](todo_synth_scheduled_live_view_20261121.md).
This display phase is deferred; build/compile do not change the live sound or UI.
