// Pure text: importing or restoring a project never starts audio.
export const FM2608_TIMED_EXAMPLE = `const opna = await useSoundChip("ym2608");
const bpm = 120;
setBpm(bpm);

// Use the current FM patch. One reservation shares the FM and SSG clock.
opna.ssg.setMixer(CH1, { tone: true, noise: false });
opna.ssg.setVolume(CH1, 10);
const phrase = opna.build(b => {
  b.atSample(0).noteOn(CH1, "E3");
  b.ssg.noteOn(CH1, "E4");
  b.atSeconds(0.15).setOperator(CH1, OP4, { tl: 30 });
  b.atSeconds(0.20).noteOff(CH1);
  b.ssg.keyOff(CH1);
});

// Inspection never writes to the chip. current captures applied audio state;
// client uses the optimistic JS shadow, reset uses hardware defaults.
const snapshot = await opna.captureState();
console.table(await opna.compile(phrase, { initialState: snapshot }));

// BPM sets the musical repeat interval when Run/Apply evaluates this script.
// AudioWorklet executes offsets precisely, with no setTimeout audio loop.
await opna.schedule(phrase, { name: "fm-ssg", repeatSeconds: 60 / bpm });
// Stop cancels Code reservations; Apply replaces this name atomically.
// await opna.clearSchedule("fm-ssg");
`;
