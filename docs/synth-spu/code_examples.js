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
