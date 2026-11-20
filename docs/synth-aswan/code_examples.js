// SPDX-License-Identifier: BSD-3-Clause
export const ASWAN_TIMED_EXAMPLE = `const ws = await useSoundChip("wonderswan");
setBpm(120);

// A wave note on CH3, with a separate hardware Sweep / pan clock.
// Noise uses CH4. These reservations edit registers, not Wave RAM or Voice PCM.
await ws.setSweep({ enabled: false, step: 0, time: 0 });
const motion = ws.build(b => {
  b.atSeconds(0).setVolume(CH3, 12, 4);
  b.atSeconds(0).setSweep({ enabled: true, step: 1, time: 8 });
  b.atSeconds(0.25).setVolume(CH3, 4, 12);
  b.atSeconds(0.5).setSweep({ enabled: true, step: -1, time: 8 });
  b.atSeconds(0.75).setVolume(CH3, 8, 8);
});

// Compare detached register traces without resetting the playing instrument.
const baseline = await ws.captureState();
console.table(await ws.compile(motion, { initialState: baseline }));
await ws.schedule(motion, { name: "sweep-pan", repeatSeconds: 1 });

liveLoop("melody", async () => {
  await ws.noteOn(CH3, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.24);
  await ws.noteOff(CH3);
  await beat(0.26);
});
// Stop clears reservations. Apply replaces the named pattern atomically.
// await ws.clearSchedule("sweep-pan");
`;

export const ASWAN_SCHEDULED_NOTES_EXAMPLE = `const ws = await useSoundChip("wonderswan");
const bpm = 120;
setBpm(bpm);
const secondsPerBeat = 60 / bpm;

// Build records this phrase once. Change bpm above and Apply to retime it.
// Unlike liveLoop / beat(), an admitted sample-clock pattern has fixed offsets.
const notes = scale("E3", "minorPentatonic", 2);
const phrase = ws.build(b => {
  for (let i = 0; i < 8; i++) {
    b.atSeconds(i * secondsPerBeat / 2).noteOn(CH1, notes[i % notes.length]);
    b.atSeconds((i / 2 + 0.3) * secondsPerBeat).noteOff(CH1);
  }
});
await ws.schedule(phrase, { name: "phrase", repeatSeconds: 4 * secondsPerBeat });

// Synth noteOff uses the current software Envelope release to soften the edge.
// compile() cannot predict software envelope or ownership from registers alone.
// Use raw hardware Gate operations to inspect a register trace instead:
const hardware = ws.build(b => {
  b.setNote(CH1, "E3").keyOn(CH1);
  b.atSeconds(secondsPerBeat * 0.3).keyOff(CH1);
});
console.table(await ws.compile(hardware));
// Stop / stopLoop release only their owned notes. A later keyboard note wins.
// await ws.clearSchedule("phrase");
`;
