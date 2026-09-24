// Sega PSG noise channel. "tone3" follows PSG3's frequency.
psg.reset();

/** @type {Array<{ type: "white" | "periodic", rate: "low" | "medium" | "high" | "tone3", volume: number, duration: number }>} */
const bursts = [
  { type: "white", rate: "low", volume: 0.7, duration: 0.08 },
  { type: "white", rate: "medium", volume: 0.65, duration: 0.08 },
  { type: "white", rate: "high", volume: 0.7, duration: 0.08 },
  { type: "periodic", rate: "tone3", volume: 0.8, duration: 0.14 },
];

for (const burst of bursts) {
  psg.noise(burst);
  await sleep(burst.duration);
  psg.noiseOff();
  await sleep(0.05);
}
