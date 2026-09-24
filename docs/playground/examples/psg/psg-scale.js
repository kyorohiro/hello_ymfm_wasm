// Sega PSG (SN76489-compatible) tone on channel 0, mixed into the same
// output as fm. psg.write(...) remains available for raw register experiments.
psg.reset();

const notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];

for (const note of notes) {
  psg.tone(PSG1, { note, volume: 0.8 });
  await sleep(0.15);
}

psg.off(PSG1);
