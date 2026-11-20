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
