// Select Mode: DX7. Six operators, 32 algorithms and 16 allocated voices.
// This original one-carrier preset needs no SysEx file. MIDI notes are 0..127.
await dx7.setPreset({
  name: 'MODE KEYS', algorithm: 31, feedback: 0,
  operators: {
    1: {
      coarse: 1, outputLevel: 85,
      envelope: {rates: [99, 75, 65, 75], levels: [99, 85, 75, 0]},
    },
  },
});
await mixer.set(dx7.id, {volume: 0.5});
setBpm(120);

liveLoop('dx7-melody', async () => {
  for (const note of [60, 64, 67, 71, 72, 67, 64, 62]) {
    dx7.noteOn(note, 100);
    await beat(0.4);
    dx7.noteOff(note);
    await beat(0.1);
  }
});

// Open examples/dx7/dx7-keyboard.js to play from the shared Keyboard.
// For your own bank: await dx7.loadSysex(await file('/presets/my-bank.syx', {type:'arrayBuffer'}));
