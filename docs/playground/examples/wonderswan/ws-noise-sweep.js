// CH3 can sweep its frequency register. CH4 can replace its waveform with noise.
const wave = Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i);
ws.setWaveform(2, wave);
ws.setVolume(2, 9, 9);
ws.setVolume(3, 5, 5);
ws.setSweep({enabled: true, step: -1, time: 12});
ws.setNoise({enabled: true, type: 3, reset: true});
setBpm(120);
liveLoop('sweep-and-noise', async () => {
  ws.noteOn(2, 'C4');
  for (let hit = 0; hit < 4; hit++) {
    ws.noteOn(3, 'C3');
    await beat(0.1);
    ws.keyOff(3);
    await beat(0.4);
  }
  ws.keyOff(2);
  await beat(0.5);
});
