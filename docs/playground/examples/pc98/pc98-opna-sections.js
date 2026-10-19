// Select Mode: PC-98 (YM2608 / OPNA). Works in Main and Worker.
// fm, ssg, rhythm and adpcm share the default YM2608; no useSoundChip needed.
setBpm(120);

// FM: one operator sine.
fm.setPreset(0, FM_PRESETS['one-op-basic']);
await play('C4', {channel: CH1, beats: 1});

// SSG: tone, then shared noise on channel 0.
ssg.tone(0, {frequency: 440, volume: 10});
await beat(1);
ssg.noise(0, {period: 16, volume: 8});
await beat(1);
ssg.keyOff(0);

// Rhythm: the bundled synthetic sounds are ready to use.
rhythm.setVolume(48);
for (const voice of ['bassDrum', 'snare', 'hiHat']) {
  rhythm.setVoice(voice, {volume: 24, left: true, right: true});
}
for (let step = 0; step < 8; step++) {
  rhythm.keyOn([step % 2 ? 'snare' : 'bassDrum', 'hiHat']);
  await beat(0.5);
}

// ADPCM-B: encode and upload an original PCM tone before starting playback.
const sampleRate = 8000;
const wave = new Float32Array(4000);
for (let i = 0; i < wave.length; i++) {
  const fade = Math.min(1, i / 80, (wave.length - 1 - i) / 80);
  wave[i] = 0.6 * fade * Math.sin(2 * Math.PI * 330 * i / sampleRate);
}
const adpcmSample = await adpcm.loadSample({channels: [wave], sampleRate});
adpcm.setVolume(180);
adpcm.setPan(true, true);
adpcm.keyOn();
await sleep(adpcmSample.duration + 0.05);
adpcm.keyOff();
