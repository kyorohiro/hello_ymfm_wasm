# Timed NES Pulse / Triangle / Noise / DMC

Fresh Cassettes include `examples/timed-apu.js`. Existing Cassettes are restored
unchanged. Open the example in Files, choose Code, then Run. The default index
and immediate instrument APIs keep their existing behavior.

```js
const nes = await useSoundChip('nes');
const phrase = nes.build(b => {
  b.pulse.setVoice(CH1, {duty: 0.5, volume: 8});
  b.noteOn(CH1, 'C4');
  b.atSample(4410).noteOff(CH1);
});
const snapshot = await nes.captureState();
console.table(await nes.compile(phrase, {initialState: snapshot}));
await nes.schedule(phrase, {name: 'pulse', repeatSeconds: 0.5});
```

`build` records data and runs its synchronous callback once without reading or
changing the live chip. Seconds and reference samples (44100 Hz by default) are
absolute, nondecreasing offsets. `compile` uses the existing `NesApuSynth`
converter on isolated working state and returns ordered
`{offsetSeconds,register,value,operationIndex,writeIndex}` rows. Duplicate
length/envelope/timer-high writes remain, including writes of the same value.
This is a predicted bus trace; concurrent manual writes can change execution.

`compile` defaults to asynchronous `initialState: 'current'` capture at an audio
boundary. `'reset'` uses hardware register defaults, not the Synth preset.
A captured snapshot can be reused and is never mutated. `'client'` uses a complete
optimistic JS register/enable shadow when available; it excludes unapplied or
renderer-only edits. The borrowed standalone Synth facade has no complete JS
shadow and explicitly rejects `'client'`; use current/reset/a captured snapshot.
Snapshots omit PCM RAM, phases, length counters and envelope progress; they are
not engine save states. Incompatible instance, clock or engine is rejected.

## Supported first slice

Root `writeRegister`, `setFrequency`, `setNote`, `noteOn`, `keyOn`, `keyOff` and
`noteOff`; Pulse and Triangle child helpers; Noise `setVoice`, `noteOn` and
`noteOff`. Root tone helpers use CH1..CH3; Noise uses its child or CH4 Off.
Nested Pulse helpers accept only CH1/CH2. Noise setVoice retains the immediate
API defaults for omitted options; it is not a new partial-patch API.

Raw writes are restricted to `$4000..$4008`, `$400A..$400C`, `$400E/$400F`.
Use high-level gates for `$4015` updates; they resolve against current enables
and preserve companion channels, including a currently playing DMC voice.
Current snapshots retain physical register bytes and separate enable metadata;
its DMC bit follows actual remaining playback so an ended one-shot is not
accidentally restarted by a Pulse gate. Client snapshots remain optimistic. Repeated
`$4003/$4007/$400B/$400F` writes retain their hardware trigger side effects.
Even `setNote` can write timer-high and retrigger; the immediate converter is
preserved rather than replaced with a software envelope.

AudioWorklet executes on the output sample clock at 44.1/48 kHz independently
of the reference rate. Repeats remain compact. Names replace atomically; invalid
replacements retain the accepted pattern. Code Apply/failed Apply/Stop and loop
ownership use the shared reservation lifecycle. Off/cancellation cannot stop a
newer manual or scheduled Gate; a new timed trigger retires stale manual key-up.
Manual parameter edits and scheduled writes follow actual application order.
Standalone click guards and raw hardware Gate semantics are unchanged.

Shared Web Audio Main/Worker NES clients expose the same first-slice API.
Native capture/execution explicitly reject; reset/client compilation remains
available without an audio device. DMC memory transfer, FDS wave/modulation,
frame-counter `$4017` writes, reset and scheduled-state Live UI are follow-ups.
No JavaScript timer fallback, background synchronization or npm publication is
introduced by this source change.

## Prepared DMC playback

Fresh Cassettes also include `examples/timed-dmc.js`. The example reuses a
prepared sample, or uploads a short self-authored alternating-bit DPCM demo
**outside** `build` when none exists. It is not PCM-to-DPCM conversion.
Restoring an existing Cassette does not insert new examples.

Record `dmc.play({rate,loop,level})` and `dmc.stop()`. Options keep the immediate
API defaults: rate 15 (hardware index 0..15), loop false, initial DAC level 64
(7-bit code 0..127). Larger rate indices play faster; this changes sample speed,
not a note-tuned instrument. Root `noteOff(CH5)` / `keyOff(CH5)` also stop DMC.
Raw `$4010` rate/loop/IRQ and `$4011` DAC writes are supported while playing;
raw `$4012/$4013/$4015` stay outside recording. `play` writes the selected
address/length using the existing converter, with explicit disable/config/enable
writes retained even when repeated. This does not reset the entire APU or its
DMC output-unit pipeline.

`captureState().sample` is a detached `{address,length}` selection, or null.
It contains no audio bytes. Address is 64-byte aligned in `$C000..$FFFF`, length
is `16*n+1` bytes up to 4081 and must fit without wrapping. Web Audio
`dmc.loadSample()` publishes this selection only after its padded RAM upload is
acknowledged. The standalone Synth also retains its loaded preset's full sample
range. Raw RAM upload/reset invalidate prepared selection; superseded uploads
cannot publish stale selections. Memory transfer is never part of a recorded
operation and is not rolled back by failed Code Apply.

Admission rejects `play` when no sample is prepared. Execution resolves the
then-current selection, so replacing a loaded sample after admission changes
what plays; a prior snapshot still compiles its prior range. Losing selection
before execution reports a recoverable reservation error before that operation
writes anything. It does not retire the audio engine. `'reset'` has no prepared
sample and cannot compile `play`; use current, a loaded client shadow, or a
captured snapshot. The borrowed Synth still rejects incomplete `'client'` state.

New DMC retriggers intentionally acquire the physical voice, including their
first disable write. Old Off/cancellation and stale manual key-up cannot stop a
newer Gate, and Pulse/Triangle/Noise enable bits remain intact. The standalone
Synth applies its existing optional output click guard to timed DMC edges;
chip register stops remain immediate. Disable the guard for raw output. The
shared generic Worklet keeps its existing raw behavior and adds no software fade.

Compilation predicts register operations, not DMC decoding or elapsed hardware
counters. A one-shot can end between operations; its current enable metadata at
execution may then differ from a previously compiled virtual pass. Capture again
for its applied state, or use explicit stops/looping while comparing traces.
Snapshots do not freeze RAM or restore decoder/shift-buffer phase. These limits
are separate from sample-accurate scheduling of the authored writes.

## FDS control reservations

With FDS enabled, `b.fds.setVolume(volume, master)`, `setFrequency(hz)`,
`setNote(note)`, `noteOn(note)`, `noteOff()`, `keyOn()` and `keyOff()` use
the existing immediate converter. Root CH6 helpers are also supported.
Raw control writes to $4023, $4080, $4082..$4087, $4089 and $408A permit
hardware volume/depth envelopes, frequency, bias and halt control. Same-value
writes are retained. These raw writes keep the immediate API's metadata semantics.
Wave RAM and $4088 modulation-table writes remain rejected. Load tables before
scheduling; snapshots do not contain table RAM or envelope/phase progress.
`examples/timed-fds.js` demonstrates pitch and gates on the currently loaded wave.
FDS-disabled endpoints reject these operations before accepting a reservation.
