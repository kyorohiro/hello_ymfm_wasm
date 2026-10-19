// Edit /samples/sampler.sample.json in Sample Editor, then Run → open Keyboard.
// YM2610/B ADPCM-B: one pitched PCM voice. Memory ranges use 256-byte units.
const audio = await inputAudio({asset: '/samples/sampler.sample.json', edit: false});
if (audio) {
  keyboard.bind('sampler', await createSampleInstrument(audio));
  log('ADPCM-B sampler ready. Open Keyboard to play. Edit /samples/sampler.sample.json to change the sound.');
}
