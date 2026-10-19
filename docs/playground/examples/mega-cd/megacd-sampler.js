// Edit /samples/sampler.sample.json in Sample Editor, then Run → open Keyboard.
// Sample Editor で音声を録音／読み込み・編集して、Keyboard で演奏します。
// RF5C164: eight voices, 8-bit PCM and 64 KiB shared sample RAM.
const audio = await inputAudio({asset: '/samples/sampler.sample.json', edit: false});
if (audio) {
  keyboard.bind('sampler', await createSampleInstrument(audio));
  log('Sampler ready. Open Keyboard to play. Edit /samples/sampler.sample.json to change the sound.');
}
