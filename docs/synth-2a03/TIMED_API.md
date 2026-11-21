# Timed NES Pulse / Triangle / Noise

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
available without an audio device. DMC playback/memory, FDS wave/modulation,
frame-counter `$4017` writes, reset and scheduled-state Live UI are follow-ups.
No JavaScript timer fallback, background synchronization or npm publication is
introduced by this source change.
