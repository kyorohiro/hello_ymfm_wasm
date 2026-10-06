// Fixed physical voices: CH4 is the lead, CH1 is the bass.
// Press Stop to end. Compare with the automatic chord demo.
await midi.enableSoundChip("tetorica-ym2612", {roundRobin: false});
setBpm(120);
const lead = midi.output("tetorica-ym2612", {channel: CH4});
const bass = midi.output("tetorica-ym2612", {channel: CH1});
await lead.setVoice(FM_PRESETS["two-op-organ"]);
await bass.setVoice(FM_PRESETS["two-op-organ"]);
await lead.cc(7, 100);  // Volume
await bass.cc(7, 70);
const phrases = [["C4"], ["A3"], ["F3"], ["G3"]];
const roots = ["C3", "A2", "F2", "G2"];
let phrase = 0;
liveLoop("midi-fixed-motion", async () => {
  const notes = phrases[phrase % phrases.length];
  const root = roots[phrase % roots.length];
  phrase++;
  await lead.pitchBend(0);
  await lead.cc(11, 100); // Expression: changes volume, not pitch.
  await bass.noteOn(root, {velocity: 75});
  try {
    await Promise.all(notes.map(note => lead.noteOn(note, {velocity: 90})));
    // Bend affects the held lead note; the bass stays in tune.
    // Both engines default to a +/-2-semitone bend range.
    for (let step = 0; step < 32; step++) {
      const phase = step / 32;
      await lead.pitchBend(0.2 * Math.sin(phase * Math.PI * 8));
      await lead.cc(11, Math.round(85 + 25 * Math.sin(phase * Math.PI * 2)));
      if (step % 8 === 0) await lead.cc(10, [0, 64, 127, 64][step / 8]);
      await beat(1 / 16);
    }
  } finally {
    await Promise.allSettled(notes.map(note => lead.noteOff(note)));
    await bass.noteOff(root);
  }
  await lead.pitchBend(0);
  await lead.cc(10, 64);
  await beat(0.5);
});
