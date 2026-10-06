// Explicit note lengths: beats follow BPM; seconds stay fixed.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);

await play('C4', { channel: CH1, beats: 1 });    // 0.5 seconds at 120 BPM
await play('E4', { channel: CH1, seconds: 0.3 }); // always 0.3 seconds

setBpm(240);
await play('G4', { channel: CH1, beats: 1 });    // now 0.25 seconds
await play('C5', { channel: CH1, seconds: 0.3 }); // still 0.3 seconds

// Choose only one: beats, seconds, or legacy duration.
// Global play({duration: 1}) remains 1 second.
// midi.output(...).play() also accepts beats/seconds; its legacy duration remains beats.
