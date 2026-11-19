// Select Mode: PC Engine or PC Engine CD-ROM². Main and Worker share this API.
// Register reservations run in AudioWorklet, independently of beat()/BPM.
const chip = await useSoundChip('huc6280');
const pulse = chip.build(b => {
  b.atSample(0).noteOn(CH1, 'E3').setVolume(CH1, 24);
  b.atSeconds(0.05).setVolume(CH1, 12);
  b.atSeconds(0.1).setVolume(CH1, 6);
  b.atSeconds(0.15).setVolume(CH1, 12);
}, {referenceSampleRate:44100});

// Inspect exact register writes without changing or stopping the sound.
const snapshot = await chip.captureState();
console.table(await chip.compile(pulse, {initialState:snapshot}));
// initialState:'client' uses the local, possibly stale authoring shadow (no RPC).
// initialState:'reset' starts from hardware reset bytes without resetting audio.
await chip.schedule(pulse, {name:'volume-pulse', repeatSeconds:0.2});
// Apply atomically replaces this name. Stop cancels the pattern and its gates.
// await chip.clearSchedule('volume-pulse');
// Raw Wave RAM transfer is immediate-only; timed R6 requires DDA mode.
// Native output supports offline build/compile, not live scheduling/capture yet.
