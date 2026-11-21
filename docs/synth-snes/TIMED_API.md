# S-DSP timed operations

Fresh Cassettes contain `examples/timed-sdsp.js`; existing Cassettes are restored
unchanged. Choose Code, open the example and Run. No npm publication is required
for these repository-source changes.

```js
const snes = await useSoundChip('snes');
const phrase = snes.build(b => {
  b.setChannel(CH1, {adsr1: 0, gain: 100});
  b.noteOn(CH1, 'C4');
  b.atSample(4410).noteOff(CH1);
});
const snapshot = await snes.captureState();
console.table(await snes.compile(phrase, {initialState: snapshot}));
await snes.schedule(phrase, {name: 'voice', repeatSeconds: 0.5});
```

The recorder targets **physical DSP CH1–CH8**. The Synth's existing immediate
`noteOn`/`noteOff` retain their performance-lane allocator and adjacent PMON pairs.
Timed operations never infer or allocate a PMON group. Configure its physical
voices and shared PMON mask explicitly. A timed attack can replace a manual
voice; old Off/cancellation and stale manual key-up cannot release a newer owner.

`build` runs its synchronous callback once and stores detached serializable data.
It does not read or alter the live instrument. `atSeconds` and `atSample` specify
nondecreasing absolute offsets from reservation start; samples default to a
44100 Hz reference independent of the output device. No beat method is added.
AudioWorklet applies operations at output-sample boundaries, including 44100 and
48000 Hz devices; S-DSP audio still runs natively at 32000 Hz. No JS timer fallback.

Supported: `setPreset`/`setChannel`, `setPitch`/`setFrequency`/`setNote`,
`noteOn`/`noteOff`/`keyOn`/`keyOff`, bounded `writeDsp` and prepared `setEcho`.
Existing SnesSynth validation and register conversion are reused. Voice patches
resolve from applied DSP bytes, preserving intervening raw/manual parameter edits.
Repeated writes and KON/KOFF effects are retained; same-native-frame KON calls
accumulate as in the existing immediate API. Cancellation has hardware release
semantics; Code Stop retains the Synth's existing output fade.

Raw voice fields $x0..$x7, master/Echo volumes, PMON, Noise, EON, KON/KOFF, FLG,
feedback and FIR are supported. ENVX/OUTX, directory/ESA/EDL and sample RAM raw
writes are excluded. `setEcho` and raw Echo/FIR edits require **already reserved
Echo RAM**, including when disabling. First enabling Echo may move the directory
and BRR and must be done through the normal API/UI before scheduling. Later
`setEcho` edits retain normal hardware delay/feedback/FIR side effects. No extra
memory transfer, soft envelope, crossfade or limiter is introduced.

`compile` returns `{offsetSeconds,register,value,operationIndex,writeIndex}` rows
without touching live DSP/RAM or UI. Baseline setup writes are omitted. It models
one virtual reservation pass on a fresh native tick after capture; simultaneous
operations share that virtual tick. It does not emulate envelopes, voices,
resampler fractional phase or elapsed sample playback. Sub-native-tick boundary
coalescing, external edits, changed banks or actual timing can change execution.
This is a predicted register trace, not a recorded bus log or SPC save state.

- Default/current: async capture from the renderer without stopping audio.
- Reset: fresh instrument register defaults and no BRR resources. It does not
  call the live reset API; musical pitch/gates need a loaded sample snapshot.
- Snapshot: detached reusable sample tuning/selection, applied bytes, authored
  Echo reservation and KON/KOFF/native-frame metadata. No RAM or decoder state.
  Instance/engine/clock compatibility is checked; compile leaves it unchanged.
- Client: explicitly rejected when the existing optimistic client lacks a full
  raw DSP/KON shadow. Its channel/sample/Echo bookkeeping alone is insufficient.
  No always-on synchronization was added. Use current/reset/a captured snapshot.

Named reservations are compact and replace atomically. Invalid calls/capacity
failures retain the previous reservation. Run/Apply/failed Apply/Stop and loop
ownership use the shared Code lifecycle. BRR upload, first Echo reservation,
reset and captured-timeline preparation are not recordable or rolled back by
failed Apply. Raw captured-timeline playback remains exclusive. Native scheduling
and authoritative capture reject explicitly; reset compilation remains local.
Scheduled-state UI/highlighting and BRR/Echo RAM transfers remain separate work.
