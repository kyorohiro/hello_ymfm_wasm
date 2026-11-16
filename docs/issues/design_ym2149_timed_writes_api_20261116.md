# YM2149 timed register API — revised second proposal

Status: design and TODO only, updated on 2026-11-16. **Not implemented.** No runtime, declarations, defaults, DSP or WASM changes belong to this step.

Tetorica should make both a SoundChip operation and its resulting register writes understandable. Record high-level operations without reading chip state, resolve them when they execute, and expose that same conversion separately for inspection. This revision withdraws the earlier build-time state copy and eager fixed-write compilation inside `build()`. Reusable state snapshots extend compilation so different operation lists can be compared from exactly the same baseline.

## 1. Public roles and compatibility

Keep `build`, `schedule` and `compile` as the proposed names: record, execute and inspect. Existing immediate `noteOn`, `noteOff`, `setOperator` and other methods retain their signatures, return values and behavior.

```javascript
// Proposed API; not executable yet.
const ym = await useSoundChip("ay8910");
const operations = ym.build(b => {
  b.atSample(0).setMixer(CH1, { tone: true });
  b.atSample(100).setMixer(CH2, { noise: false });
  b.atSample(200).setEnvelope({ shape: 8 });
}, { referenceSampleRate: 44100 });

await ym.schedule(operations, {
  name: "buzzer",
  repeatSeconds: 1 / 110,
});

// Awaitable compile is recommended for an authoritative Worklet snapshot.
// Its return contract is the open decision in section 4.
const writes = await ym.compile(operations);
console.table(writes);
await ym.clearSchedule("buzzer");
```

Use actual existing AY authoring names in the first recorder:

| Conceptual example | Existing AY method to record |
| --- | --- |
| `setToneEnabled(CH1, true)` | `setMixer(CH1, { tone: true })` |
| `setNoiseEnabled(CH2, false)` | `setMixer(CH2, { noise: false })` |
| `setEnvelopeShape(8)` | `setEnvelope({ shape: 8 })` |

Those descriptive aliases are not currently AY methods; adding immediate aliases is outside this revision. Builder calls use a separate receiver `b`: `fm.noteOn(...).build()` would execute the live method first.

Preserve existing YM2612 `scheduleWrites(entries)` / `clearScheduledWrites()` signatures, absolute AudioContext-time semantics and behavior. New `schedule(operations, options)` accepts operation data with relative offsets and must not reinterpret legacy entries. Compiled rows are inspection data, not implicitly legacy scheduling arguments; that API still requires its existing absolute-time format.

Keep `initialState` as the proposed compile option name: default `"current"`, `"reset"`, or a previously captured state snapshot. Add the proposed asynchronous `captureState()` name for obtaining reusable compilation snapshots. Existing `getState()` behavior is unchanged; section 4 explains the distinction. Use `referenceSampleRate` for authoring sample units to distinguish them from device `sampleRate`.

## 2. `build()` is a lightweight operation recorder

- Execute the JavaScript callback synchronously once on the authoring side. It never runs again at submission, compilation, repetition or audio rendering.
- Record operation names, copied arguments, time and authored order. Do not read or copy live registers, retained levels, channel settings or UI state. Do not calculate final register bytes, send writes or notify live observers.
- Return bounded serializable data transferable through Main / Worker / AudioWorklet. No functions, promises, closures, transports or chip instances enter the data. Later mutation of argument objects must not alter it.
- Support existing high-level register operations through a chip-specific allowlist, plus explicit raw full writes. Preserve the distinction between full writes, semantic partial updates and action writes; do not resolve masks against state here.
- Reuse state-independent validation. Complete state-dependent conversion later, sharing existing chip validation / packing logic instead of duplicating it in the recorder or scheduler.
- Recorder mutators may return the recorder for chaining. They do not return state-derived immediate-method results: a period / frequency returned by immediate `setNote()` is unavailable during recording. State getters and callbacks dependent on such results are outside this recorder.
- Reject asynchronous callbacks and unsupported asynchronous / non-register actions explicitly. Do not silently omit operations. PCM transfers, readbacks, resource loading and software-effect routines are outside this register-operation scope.
- Add no builder `beat()` or `sleep()`. Existing awaited timing helpers remain unchanged outside it.

An illustrative data shape is enough; no universal SoundChip IR is required:

```javascript
{
  version: 1,
  chip: "ay8910",
  referenceSampleRate: 44100,
  operations: [
    {
      time: { unit: "sample", value: 0 },
      order: 0,
      method: "setMixer",
      args: [CH1, { tone: true }]
    }
  ]
}
```

Dispatch only known method tags. The plan contains no baseline snapshot. Configuration needed for conversion comes from the execution / compilation state, and neither scheduling nor compilation mutates the plan.

## 3. Resolve partial operations immediately before application

The common scheduler owns time, stable order, repetition, names and lifecycle. The chip-specific resolver owns parameter validation, register formats, partial updates, command semantics and required authoring metadata.

For each operation, resolve its complete ordered write batch from authoritative current state, then apply that batch contiguously at its frame. Later operations see earlier changes; do not interleave another operation inside a batch. This also preserves OPN frequency high/low pairs and shared latch behavior.

Use the same chip conversion path for immediate operations, scheduled operations and compilation with different state / write sinks. Extract or reuse existing validation and conversion helpers as appropriate. Avoid constructing a Synth or cloning complete state for each high-rate event; execution-side scratch state can be reused. This is chip-side reuse, not a new framework for every SoundChip.

### Full writes, partial updates and commands

- Raw full writes deliberately replace writable register contents according to existing chip rules.
- Partial operations preserve omitted fields from actual current state. Resolve them again on each repetition, rather than caching the first cycle's bytes.
- Preserve action / strobe semantics. YM2149 R13 retriggers even when unchanged. YM2612 Key On/Off uses port 0, register `0x28`, with channel / operator command encoding; it is not one persistent shared Gate value.
- Preserve all emitted writes, including equal-value writes. Do not deduplicate, coalesce same-register writes or reorder them.
- Retain chip-specific registers, ports, physical operator mapping and access order. Do not flatten all chips into AY-style register bytes.

From AY R7 = `0xC9`:

| Operation | R7 after the operation |
| --- | --- |
| `setMixer(CH1, { tone: true })` | `0xC8` |
| `setMixer(CH2, { noise: false })` | `0xD8` |

Other channels and upper I/O-direction bits survive. If manual `setMixer(CH3, { tone: false })` occurs between these operations, the second scheduled result must be `0xDC`, retaining the manual change. A build-time copy would miss it.

For YM2612 CH1 / OP1, current register `0x30 = 0x53` followed by `{ multi: 7 }` produces `0x57`; then `{ dt: 2 }` produces `0x27`. From `0x50 = 0x85`, `{ ar: 12 }` produces `0x8C`, preserving RS. AM/D1R and SL/RR need the same treatment.

### Authoritative state is a prerequisite

Every applied path, including raw writes, legacy scheduling, manual edits and new operations, must update the resolver's authoritative state. Include semantic metadata such as AY retained key-on levels. A UI snapshot or unmodified client shadow is insufficient.

Current `YM2612Synth.write()` explicitly does not synchronize `channels`. Replaying current high-level methods against that stale shadow would fail partial updates after raw writes. Later implementation must synchronize / decode the authoritative register mirror while reusing existing packing logic.

Immediate API semantics remain the reference. Audit existing partial-operator Key Off behavior before exposing it in recording; this revision does not redefine it. The validation cases below cover whole-channel Key On/Off.

## 4. `compile()` generates a virtual write trace

Requested interface:

```javascript
const writes = fm.compile(operations); // Current state baseline.
const resetWrites = fm.compile(operations, { initialState: "reset" });
```

- Default / `initialState: "current"`: use a coherent snapshot of authoritative chip state and required metadata associated with the compilation request.
- `initialState: "reset"`: construct the chip's defined reset registers and semantic metadata, retaining the instance clock / model configuration. Do not substitute the current preset, Synth starter patch or `initialize()` sound.
- `initialState: snapshot`: use the compatible snapshot returned by `captureState()` as the complete baseline. Do not recapture current state or merge live values into it.
- Resolve sequentially against temporary work state using the same chip resolver as scheduling. Virtual changes affect later operations but never live registers, retained levels, UI, clock or reservations.
- Emit only operation-generated writes. Baseline construction contributes no rows and forwards no live reset or constructor / initialization writes.
- Retain repeated values, commands and write order. Simulate register / control state only; do not render audio or emulate a complete machine.

Reset descriptors need a per-chip audit: AY has retained-level metadata, and OPN authoring defaults are not a complete hardware reset register image. Deriving reset compilation blindly from constructor defaults would be incorrect.

### Reusable snapshots through `captureState()`

```javascript
// Proposed API; not implemented.
const snapshot = await fm.captureState();

const writesA = await fm.compile(operationsA, {
  initialState: snapshot,
});
const writesB = await fm.compile(operationsB, {
  initialState: snapshot,
});
```

Choose `captureState()` rather than changing `getState()`. Existing YM2612 / OPN `getState()` synchronously returns a copy of authoring state; it is not an authoritative Worklet snapshot and can omit applied raw-register changes. The AY Synth Code wrapper also has a display / instrument `getState()` with different contents. None of those existing methods gains new timing, return types or snapshot guarantees. Their results are not implicitly accepted as compilation snapshots.

The snapshot contract is deliberately limited to repeatable register-operation resolution:

- Include authoritative register contents and all internal control / authoring state needed by supported operations: AY retained key-on levels, decoded OPN operator / channel / mode state and any relevant register-latch metadata. Include the clock / model / configuration used by conversion. Registers alone are insufficient.
- Capture registers, metadata and conversion configuration coherently between complete operation / write batches, never halfway through an OPN high/low frequency pair or before matching metadata is committed.
- Use the same ordered asynchronous AudioWorklet request / response mechanism proposed for current-state compilation. The capture point is its audio-side processing position, not the JS invocation instant. Copy bounded state there and return independent data; continue rendering without pause, reset, seek, draining future reservations or stopping playback.
- Expose a detached read-only value with no shared mutable references to the live chip, client, UI or later captures. Copy nested data / buffers; do not transfer ownership of live audio buffers. Subsequent playing, manual writes, reset or UI updates do not change an already returned snapshot.
- For each `compile()`, create separate working state from the snapshot. Never consume or mutate it, including during failed compilation. Compiling A then B, B then A, or both independently must start each from the same captured state. Changes made virtually by A must not leak into B.
- Supplied-snapshot compilation needs no new live-state readback. It checks target compatibility and uses captured resolution state; output does not depend on later live register values. `"current"` still obtains a fresh ordered snapshot for each compile request, and `"reset"` still constructs its own isolated reset baseline.
- Snapshot capture / reuse emits no chip writes and changes no live registers, retained metadata, UI, schedules or ownership. Data access never grants permission to bypass existing client lifecycle / ownership guards.

These are compilation snapshots, not complete audio-emulator save states. Include internal fields required to resolve supported register operations, not unrelated oscillator phase, full PCM memory, DSP state, pending reservations or loop ownership. This addition creates no state-restore API, snapshot editor or persistence / interchange format.

#### Identity and compatibility

Validate the snapshot before compiling. Require a supported snapshot format / resolver version, the same underlying chip instance, the same chip kind and concrete model / variant, and a compatible conversion configuration. Check clock, register / port layout, channel / operator mapping and any flags affecting supported operation conversion. Reject wrong kinds, incompatible configuration, malformed or incomplete snapshots explicitly; do not reinterpret them or fill missing fields from live state.

The initial scope is reuse with the same underlying chip instance, as in the example. Cross-instance snapshot portability is not introduced. Instance identity is stable across wrappers / Run generations for that chip; it is not a loop owner or Run-generation token. A historical snapshot remains a valid baseline after live register changes or Run changes while that same instance and compatible configuration remain. Existing rules for stopped / disposed clients still apply. Changing clock / model to an incompatible configuration rejects reuse without altering the snapshot or retuning the live chip.

Capture frame / state-version provenance can document the snapshot point. Output device sample rate and capture frame describe provenance, not conversion compatibility; authoring `referenceSampleRate` remains a property of the operation list. Changing output rate alone must not change compiled register results. Keep validation chip-specific and bounded rather than introducing a general state-portability framework.

### Compiled write rows

Return ordered flat records suitable for `console.table()` and analyzer use:

```javascript
[
  { offsetSeconds: 0, register: 7, value: 0xC8, operationIndex: 0, writeIndex: 0 },
  { offsetSeconds: 100 / 44100, register: 7, value: 0xD8, operationIndex: 1, writeIndex: 0 },
  { offsetSeconds: 200 / 44100, register: 13, value: 8, operationIndex: 2, writeIndex: 0 }
]
// OPN rows additionally carry port, e.g. port: 0, register: 0x30, value: 0x57.
```

Times are relative offsets independent of device rate; the input retains original units and reference rate. Indices explain one-to-many conversion and order. Compile one pass; repetition belongs to scheduling options.

This is a prediction from one baseline, **not actual playback history**. Manual interleaving can correctly change scheduled partial-write results from previously compiled rows. Snapshot reuse does not change `schedule()`: it still resolves against actual state at execution, and neither accepts nor restores a compilation snapshot. Playback-history recording is not added here.

### Open return-contract decision: current state across threads

The requested synchronous result is straightforward with local authoritative state. Main / Worker cannot synchronously read exact Worklet state through an ordinary MessagePort. A cached mirror can lag actual writes and must not be called current state.

Recommend a consistently awaitable public API:

```javascript
const writes = await fm.compile(operations);
const resetWrites = await fm.compile(operations, { initialState: "reset" });
```

For live connections, current-state compilation uses the same coherent snapshot acquisition as `captureState()` and compiles on a copy. Define the snapshot point as the audio-side processing position of that request, before later operations, with internal frame / state-version provenance for verification. This does not claim to read the exact JavaScript wall-clock instant of invocation. With `initialState: snapshot`, reuse its earlier capture point; do not take another snapshot.

**Settle this return / snapshot contract before implementation.** It is a proposed adjustment to the synchronous example, not permission to silently use a stale authoring copy. Reset compilation can be local, but one awaitable contract avoids backend-dependent return types. No timer fallback may approximate snapshot ordering or execution.

## 5. Seconds and reference samples are absolute offsets

```javascript
const operations = ym.build(b => {
  b.atSeconds(0.1).noteOn(CH1, "C4");
  b.atSample(4410).noteOff(CH1);
});
// Both operations are at 0.1 seconds; noteOn precedes noteOff.
```

- Start at offset zero. Both setters select an absolute offset from the reservation start; neither accumulates time nor advances the musical clock.
- Seconds must be finite and nonnegative; samples must be nonnegative safe integers. `referenceSampleRate` is a validated positive reference rate, default 44,100 Hz, independent of output device rate.
- Preserve the previous nondecreasing logical-offset rule. Compare mixed units by logical time and reject backwards offsets rather than silently sorting. Preserve authored order for equal times and different times quantized to one output frame.
- Convert to output frames at execution. Reference sample 4,410 maps to frame 4,410 at 44.1 kHz or 4,800 at 48 kHz. Offset 4,800 with `referenceSampleRate: 48000` means the same time.
- Anchor once to an audio-clock start frame. Each occurrence maps from ideal time: `startFrame + round((cycle * repeatSeconds + offsetSeconds) * outputRate)`. Never repeatedly add a rounded period; 110 Hz repetition must not accumulate rounding drift.
- Preserve audio-side order when repeat boundaries collide on a frame. One-frame, 128-frame and irregular render partitions must agree.
- Precision is output-sample timing, not original ST CPU / MFP cycle accuracy. No builder `beat()` and no changes to existing `await beat()`, `await sleep()` or `sleepSamples()`.

## 6. Scheduling and ownership contract retained

- AudioWorklet executes operations at sample boundaries, splitting rendering at events. No `setTimeout()` fallback or arbitrary audio-thread callbacks.
- Keep one bounded repeating pattern, not an expanded infinite queue. Do not precompile one fixed byte list for every future live state.
- Omitted `repeatSeconds` means one finite pass. A repeat interval must be finite, positive and exceed the final logical offset. Reject empty repeats and unsupported rates instead of clamping. Numeric rate / capacity limits remain to be measured and specified.
- Reserve the start once from the audio clock with a documented small lead applied once. Immediate methods retain their behavior. The acceptance receipt can identify start / phase; numeric lead and any explicit-start interface remain implementation decisions.
- `await schedule()` resolves on acceptance, not playback completion. Waiting for infinite repetition would block existing live-loop Apply adoption.
- Names identify reservations per physical chip and Run. Validate then replace atomically; rejection retains the previous reservation. Owner / loop-generation metadata is internal, and stale cleanup cannot cancel a newer replacement.
- Successful Apply commits staged top-level replacements / removals; failed Apply retains previous work. Live-loop calls update named reservations without waiting for playback completion. Removed / stopped loops lose owned reservations; Run / Stop invalidate retired sessions.
- `clearSchedule(name)` cancels future operations only. Current registers and running hardware envelopes continue until another write or cleanup. Code Stop retains existing guarded release / fade behavior.
- Envelope / Noise remain shared chip resources. Manual and scheduled conflicts follow actual audio-side acceptance / application order, not a fictitious channel lock or JS wall-clock total order. Preserve newer manual Gate ownership during cleanup; audit audition guards so held keys do not suppress shared modulation.
- Submission never mutates current state or UI. Display applied state through bounded / throttled snapshots.
- Preserve Main / Worker, borrowed-client and Performance Queue lifecycle. Explicitly reject unsupported backends. Offline / Native require render-clock adapters and tests before support is claimed.

### Atomic admission without freezing future state

Validate the entire plan before committing: cloneability, known methods, arguments / ranges, time order, repeats, chip compatibility and capacity. This does not pre-resolve future partial updates.

Supported operations must resolve for every valid state of their supported configuration. If a state-dependent failure remains, finish and validate an operation's complete write batch on temporary state before emission, report failure and stop its remaining reservation work. Detect configuration invalidation explicitly. No partial batch may leak out; already rendered audio cannot be rolled back. Verify these cases before admitting an operation. Existing Performance Queue dispatch does not provide general mutation rollback.

## 7. Design validation and later acceptance tests

These checks establish representability against current code. They are design reasoning, **not completed runtime tests**.

| Case | Expected resolution / acceptance condition |
| --- | --- |
| AY R7 partial updates | From `0xC9`, CH1 Tone On → `0xC8`, CH2 Noise Off → `0xD8`. Interleaved manual CH3 Tone Off makes the latter `0xDC`. Preserve unrelated bits. |
| Equal-value writes | Retain emitted R7 writes even when unchanged. Never remove an unchanged R13 retrigger. |
| AY R13 repeats | Emit Shape 8 at each 110 Hz occurrence. Resolve the same recorded operation each time. |
| OPN Operator partial fields | From port 0 / `0x30 = 0x53`, MULT 7 → `0x57`, DT 2 → `0x27`. Also verify RS/AR, AM/D1R, SL/RR and preceding raw writes. |
| YM2612 Key On/Off | Keep port 0 / `0x28` values `0xF0`, `0xF1`, `0x00`, `0xF0` in order: CH1 On, CH2 On, CH1 Off, CH1 On. Reuse existing channel / operator mapping. |
| Same-time operations | Preserve operation order and contiguous write batches. Later operations see earlier changes. |
| Compile current / reset | For the R7 example, current `0xC9` gives `0xC8` / `0xD8`; AY's zeroed reset register baseline gives `0x00` / `0x10`. No baseline writes or live mutations. |
| One snapshot, different operations | Capture AY R7 = `0xC9`. From that same snapshot, A = CH1 Tone On gives `0xC8`; B = CH1 Tone Off gives `0xC9`. Compiling A first must not affect B, even after live R7 changes. Repeating A gives identical rows. |
| Snapshot includes semantic state | With raw AY volume zero but retained level 9, compile Key On from the snapshot and obtain level 9. Preserve relevant OPN packed fields / mode / latch metadata coherently too. A register-only or existing display `getState()` object is rejected. |
| Snapshot isolation / concurrent reuse | Capture state, keep a copy and advance live playing / editing. Snapshot remains unchanged. Compile A / B independently, including failures; neither snapshot nor live state changes and virtual writes do not leak between runs. |
| Asynchronous capture during playback | Capture between complete batches while audio and reservations continue. No reset, pause, skipped writes, draining future work or mismatched raw / semantic state. Returned data owns independent buffers. |
| Snapshot identity / configuration | Reject another chip instance, wrong chip / model / clock / layout, incompatible version and malformed or missing state without changing live state or reservations. Compatible historical state is not invalidated merely by later register writes, Run generation or output sample rate. |
| Compile / schedule agreement | Same baseline / configuration without interference gives identical compiled and instrumented applied writes. Manual interleaving intentionally changes dependent fields. |
| Mixed time / output rates | `atSeconds(0.1)` and `atSample(4410)` tie at frames 4,410 / 4,800 at 44.1 / 48 kHz, retaining order. Configurable reference rate describes equivalent times. |
| Repetition / render blocks | Long 110 Hz repeats remain within half an output frame of ideal anchored times without accumulated drift. One-frame, 128-frame and irregular blocks agree; storage stays bounded. |
| Atomic reservations / owners | Invalid / oversized / unsupported replacement keeps prior work. Failed Apply preserves it; stale generations cannot execute / cancel replacements; Stop / stopLoop cancel owned future work. |
| Build / compile isolation | Callback runs once. Argument mutation cannot change the plan. Compile changes no live state, UI, input data or reservation. Verify authoritative snapshot ordering across Main / Worker / Worklet. |

## 8. Existing infrastructure and scoped TODO

- `tetorica_src/runtime/ay8910synth.js`: R7 masks, retained levels, validation and `_getState()` / `_adoptState()`.
- `playground_ay8910_inspector.js`: isolated-state staging and collecting writes is a resolver / compiler precedent, not state-free recording.
- `ym2612synth.js` / `opn_fm_synth.js`: packed operator fields, ports / slots, key commands and frequency-write batches. Raw / shadow synchronization needs work.
- `playground_performance_queue.js`: seconds-to-frame conversion, stable same-frame ordering, 65,536-command capacity and session / owner cancellation. New bounded-pattern limits still need definition.
- `playground_performance_processor.js`: render splitting and current audition / note ownership guards.
- `playground_performance_sender.js` / `host.js`: Main / Worker lookahead. Compact repeating operation reservations do not exist yet; do not apply lead twice.
- `playground_code_runtime.js`: Run / Apply / Stop, loop-generation and borrowed-client fences. Reuse ownership rather than adding a second system.
- `docs/synth-ym2149-st/code_audio.js` / `code_host.js`: borrowed immediate client and shared Code runtime; new methods need later integration.
- Existing WonderSwan / POKEY Timeline builders eagerly resolve against private authoring state. Their reset / prepare / replay semantics are not the new `build()` contract.

Scope remains AY first, with YM2612 as a concrete design witness and compatibility constraint. Reusable snapshots add same-state compilation comparison, without snapshot restore, cross-instance portability or a save-state format. Do not add PCM transfers, DSP, complete-machine emulation, playback-history recording, Looper / Event Rec or a giant all-chip abstraction. Other chips need explicit capability decisions and validation.

### Design work in this step

- [x] Withdraw build-time copying / eager compilation; specify state-free operation recording.
- [x] Specify shared chip resolution, execution-time partial updates, strobe writes and isolated compilation.
- [x] Preserve timing, compact repeats, Main / Worker, Performance Queue and ownership contracts.
- [x] Review requested AY / OPN / timing cases and record reset, raw-state synchronization and snapshot gaps.
- [x] Add reusable asynchronous `captureState()` snapshots and `initialState: snapshot`, including required semantic state, independent working copies, coherent capture, compatibility validation and comparison acceptance cases; preserve existing `getState()` behavior.
- [ ] Settle `compile()` return / snapshot contract; recommend an awaitable authoritative snapshot.

### Implementation after design agreement — not started

- [ ] Finalize operation allowlists / schema, naming, start anchor and measured limits without changing immediate APIs or legacy `scheduleWrites()`.
- [ ] Share chip validation / conversion; synchronize authoritative state and define reset descriptors / required metadata. Cover R7, R13, packed OPN fields, raw writes and key commands.
- [ ] Implement lightweight recording and isolated compilation with snapshot ordering and no live side effects.
- [ ] Add coherent non-stopping `captureState()` acquisition and reusable read-only state values; validate chip identity / configuration and compile each call on its own work copy. Verify same-baseline comparison, historical / concurrent reuse, rejection and no live mutations.
- [ ] Implement compact sample-accurate reservations, atomic admission / replacement and fresh resolution at every occurrence.
- [ ] Connect AY Worklet, Main / Worker, client and Synth Code ownership; retain Run / Apply / Stop and manual Gate guards.
- [ ] Execute the acceptance matrix, including applied-write comparison, state-dependent failure and both output rates.
- [ ] Add declarations, completion descriptions, source navigation and supported-transport documentation where the API is exposed.
- [ ] Measure actual PCM for periodic R13 writes, then make a separately verified Sync-buzzer example. Label host scheduling as software; Envelope / register effects are chip behavior.

Related: [YM2149 ST TODO](todo_ym2149_st_synth_20261116.md).
