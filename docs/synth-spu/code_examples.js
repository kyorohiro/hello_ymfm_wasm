// A compact hardware timeline over the instrument already loaded above.
export const SPU_TIMED_EXAMPLE=`const ps1 = await useSoundChip("ps1");
setBpm(120);

// Record once. No PCM upload or live chip edit happens during build.
const state = await ps1.getState();
const channel = state.pmon.enabled ? CH2 : CH1;
const phrase = ps1.build(b => {
  b.atSample(0).noteOn(channel, "E3");
  b.atSample(11025).noteOff(channel);
  b.atSeconds(0.5).noteOn(channel, "G3");
  b.atSeconds(0.75).noteOff(channel);
});

// One detached baseline lets you compare register traces without changing sound.
const snapshot = await ps1.captureState();
console.table(await ps1.compile(phrase, { initialState: snapshot }));
await ps1.schedule(phrase, { name: "phrase", repeatSeconds: 1 });
// Stop cancels this Run's reservations. Apply replaces the same named phrase.
// Raw keyOff follows the SPU ADSR; noteOff also follows Synth Click guard.
`;

export const SPU_NOISE_EXAMPLE=`const ps1 = await useSoundChip("ps1");
// Hardware Noise: clock is shared by all 24 voices. It is not a note pitch.
// Uses the current looping sample as the core's voice backing; no RAM upload.
const noise = ps1.build(b => {
  b.setPreset(CH1, { volumeLeft: 0.15, volumeRight: 0.15 });
  b.setNoiseEnabled(CH1, true).setNoiseClock(18).noteOn(CH1);
  b.atSeconds(0.25).setNoiseClock(30);
  b.atSeconds(0.5).setNoiseClock(42);
  b.atSeconds(0.75).noteOff(CH1);
});
console.table(await ps1.compile(noise));
await ps1.schedule(noise, { name: "noise-clock", repeatSeconds: 1 });
// Stop restores the editor's sound. Other Noise voices share these clock changes.
`;

export const SPU_PMON_EXAMPLE=`const ps1 = await useSoundChip("ps1");
// Hardware PMON: CH1 modulates CH2. No automatic pairing or generated waveform.
// The source's output Volume may be zero: modulation uses its signal before pan.
// Use Sample mode for both voices. Hardware Noise would replace their PCM.
const pair = ps1.build(b => {
  b.setNoiseEnabled(CH1, false).setNoiseEnabled(CH2, false);
  b.setPreset(CH1, { volumeLeft: 0, volumeRight: 0 });
  b.setPreset(CH2, { volumeLeft: 0.35, volumeRight: 0.35 });
  b.setPmonEnabled(CH2, true);
  b.noteOn(CH1, "E2").noteOn(CH2, "E3");
  b.atSeconds(0.25).setFrequency(CH1, 55);
  b.atSeconds(0.5).setFrequency(CH1, 220);
  b.atSeconds(0.75).noteOff(CH2).noteOff(CH1);
});
console.table(await ps1.compile(pair));
await ps1.schedule(pair, { name: "hardware-pmon", repeatSeconds: 1 });
// PMON only enables the bit. This example explicitly starts/stops both voices.
`;
