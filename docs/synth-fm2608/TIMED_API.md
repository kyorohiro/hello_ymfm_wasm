# Timed FM / SSG operations

Open `examples/timed-fm-ssg.js` in Files, choose Code and Run. It is included
in fresh projects (Menu → New → Cassette). Restoring an existing Cassette does
not insert or replace its files. No code runs during import or restoration.

```js
const opna = await useSoundChip('ym2608');
const phrase = opna.build(b => {
  b.atSample(0).noteOn(CH1, 'E3');
  b.ssg.setMixer(CH1, {tone: true, noise: false});
  b.ssg.setVolume(CH1, 10);
  b.atSeconds(0.2).noteOff(CH1);
  b.ssg.keyOff(CH1);
});
console.table(await opna.compile(phrase));
await opna.schedule(phrase, {name: 'phrase', repeatSeconds: 0.5});
// await opna.clearSchedule('phrase');
```

`build` runs its synchronous callback once and records serializable operations.
It does not inspect or alter a chip. Seconds and reference samples are absolute
reservation offsets; offsets must not decrease. `referenceSampleRate` defaults
to 44100, independent of the output device. `b.ssg` shares the parent cursor.

`compile` returns `{offsetSeconds, port, register, value, operationIndex,
writeIndex}` rows, preserving order and repeated writes. It virtually applies
operations to temporary state, without sending writes or resetting audio:

- Default / `initialState: 'current'`: asynchronous AudioWorklet capture.
- `'client'`: optimistic JS register/control shadow; no state request. Excludes
  renderer-only reservations, timeline writes and native changes. Incomplete
  adopted state rejects explicitly.
- `'reset'`: hardware reset values, without the high-level Synth initialization.
- A previous `await opna.captureState()`: reusable detached snapshot; a different
  chip instance, clock or engine is rejected. Includes FM pitch latches/key masks
  and SSG levels retained through key-off, not oscillator/envelope phases.

`compile` is a prediction from that baseline, not a live write-history logger.
`setOperator` preserves packed companion fields; SSG mixer edits preserve other
channels and I/O bits. `setMixer` requires both Tone and Noise for the addressed
channel, matching the immediate API. Envelope shape writes always retrigger.

`schedule` resolves operations against the actually applied state on the audio
sample clock. Named patterns are compact and replacement is atomic. Limits and
ownership follow the existing Performance Queue: 4096 operations per pattern,
128 pattern names, 65536 stored commands, and 48000 expanded writes/second.
No user callback or JavaScript audio timer runs on the audio thread. Run/Apply
stage reservations; failed Apply preserves accepted reservations; Stop cancels
Code reservations. A stale scheduled key-off cannot release a newer manual note.

The standalone Synth's FM/SSG monitor runs on the same audio thread for immediate,
reserved and keyboard writes. Channel Mute keeps the latest authored levels;
unmute restores those levels, and Stop suppresses FM tails until the next Gate.
A new reserved Key On restores its authored FM levels at that exact audio frame.
A Key On-only Run after Stop therefore needs no explicit preset rebuild.

This is software monitoring, not a hardware feature. `captureState()` / current
compilation still see the physical register bytes (FM TL=127 or SSG level=0
while muted). The monitor's private authored-level cache is separate. Compiled
chip operations do not include the Synth's extra mute/restoration writes;
Master/source gains and scheduled-state UI remain separate from compilation.

Available on shared Web Audio Main/Worker clients, the primary Worker client and
`YM2608RuntimeSynth.fm`, borrowed by this Synth. Immediate methods are unchanged.
Native authoritative capture/execution, Rhythm, ADPCM transfers, timers/CSM
and nonstandard prescaler authoring are outside this slice. Raw timed writes are
restricted to FM/SSG registers; SSG I/O ports are excluded. This source change is
not an npm publication. Continuous scheduled-state UI display is deferred to the
[shared visible-panel plan](../issues/todo_synth_scheduled_live_view_20261121.md).
