// Select one cycle in Sample Editor; Game Boy stores 32 four-bit wave samples.
// Sample Editor で1周期を選択して、Run → Keyboard で演奏します。wave RAM は同時1音です。
const audio = await inputAudio({asset: '/samples/sampler.sample.json', edit: false});
if (audio) {
  keyboard.bind('sampler', await createSampleInstrument(audio));
  log('Wave RAM ready. Open Keyboard to play. Edit /samples/sampler.sample.json to redraw the wave.');
}
