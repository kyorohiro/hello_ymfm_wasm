// Select Mode: MSX Audio. Y8950 plays nine FM channels plus one mono ADPCM stream.
// Web Audio / Native and Main / Worker use the same code.
setBpm(120);

await livePrepare('msx-audio-original-drum', async () => {
  const sampleRate = 16000;
  const pcm = Float32Array.from({length: 4800}, (_, index) => {
    const seconds = index / sampleRate;
    const phase = 2 * Math.PI * (70 * seconds + 3 * (1 - Math.exp(-seconds * 40)));
    return 0.65 * Math.sin(phase) * Math.exp(-seconds * 20);
  });
  // loadSample encodes PCM, uploads it and selects its range/rate without playing.
  // To use your own WAV from FILES instead:
  // const wav = await file('./samples/voice.wav', {type: 'arrayBuffer'});
  // return opl.adpcm.loadSample(wav, {sampleRate});
  return opl.adpcm.loadSample({channels: [pcm], sampleRate}, {sampleRate});
});
opl.adpcm.setVolume(160);
opl.setPreset(0, OPL_PRESETS.sine);
opl.setOperator(0, 1, {tl: 22});

liveLoop('msx-audio-fm-and-adpcm', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4']) {
    try {
      opl.adpcm.keyOn();
      opl.noteOn(0, note);
      await beat(0.75);
    } finally {
      opl.keyOff(0);
      opl.adpcm.keyOff();
    }
    await beat(0.25);
  }
});

// loadMemory() takes encoded ADPCM-B bytes; setSample() uses byte range [start, end).
// To add another independent Y8950 in any mode: await createSoundChip('y8950').
