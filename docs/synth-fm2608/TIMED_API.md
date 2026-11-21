# Timed FM / SSG / Rhythm operations

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
to 44100, independent of the output device. `b.ssg` and `b.rhythm` share the parent cursor.

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
Native authoritative capture/execution, ROM/ADPCM transfers, timers/CSM
and nonstandard prescaler authoring are outside this slice. Raw timed writes are
restricted to FM/SSG/Rhythm registers; SSG I/O ports are excluded. This source change is
not an npm publication. Continuous scheduled-state UI display is deferred to the
[shared visible-panel plan](../issues/todo_synth_scheduled_live_view_20261121.md).


## Fixed-ROM Rhythm

Fresh Cassettes also include `examples/timed-rhythm.js`. The Synth already loads
its standard replacement Rhythm ROM. `build` and `compile` never fetch or upload
a ROM; other hosts must load theirs before playing. Recorded methods are
`rhythm.setVolume(0..63)`, `rhythm.setVoice(voice,{volume:0..31,left,right})`,
`rhythm.keyOn(voiceOrArray)` and `rhythm.keyOff(voiceOrArray)`. Physical voices
are 0 bassDrum, 1 snare, 2 cymbal, 3 hiHat, 4 tom, 5 rimShot. Either numbers or
those names are accepted. These drum indices are independent of FM/SSG CHs.

Rhythm global volume writes `0x11`; individual pan/level writes `0x18..0x1D`; trigger
and stop masks write `0x10` (stop adds bit 7). Repeated same-value triggers are
retained. A simultaneous event remains one register write unless playback must
exclude a stale Off for a voice acquired by someone else. Stop/owner cancellation
releases only that owner's drums; ordinary non-timed APIs retain their behavior.

Snapshots now include detached `rhythmLevels` authoring metadata so a partial
volume edit preserves pan even while the standalone monitor physically clears
its stereo gates. `registers` still contains the physical bytes. Older v1
snapshots without this metadata use their captured physical `0x18..0x1D` values. The reset baseline uses the core’s `0xDF`
Rhythm voice defaults (both pans, maximum level); the optimistic client baseline
also retains its existing immediate helper state.
The audio-thread Rhythm monitor restores the latest authored pan/volume on
unmute, without introducing a UI poll or replaying old Main-thread values.
`loadRom` and `reset` are not recorded methods. ADPCM remains separate.
