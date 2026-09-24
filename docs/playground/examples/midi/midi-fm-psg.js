// YM2612 mode. channel selects a MIDI part (CH1..CH16); the sound engine allocates physical voices automatically.
setBpm(120);
const lead = midi.output("tetorica-ym2612", {channel: CH1});
const bass = midi.output("tetorica-sega-psg", {channel: CH2});
await lead.setVoice(FM_PRESETS["two-op-bell"]);
await lead.cc(7, 100);  // Volume
await lead.cc(10, 64);  // Center (FM: left/center/right)
await lead.cc(64, 127); // Sustain pedal down
// FILES alternative: await lead.loadVoice("./lead.tfi");
await Promise.all([
  lead.play("C4", {velocity: 100, duration: 1}),
  lead.play("E4", {velocity: 90, duration: 1}),
  lead.play("G4", {velocity: 90, duration: 1}),
  bass.play("C3", {velocity: 80, duration: 1}),
]);
await lead.cc(11, 80); // Expression while the chord is sustained
await beat(1);
await lead.cc(64, 0);  // Release the sustained notes
