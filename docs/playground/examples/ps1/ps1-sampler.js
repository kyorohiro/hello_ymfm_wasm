// Edit /samples/sampler.sample.json in Sample Editor, then Run → Keyboard.
// ファイル／マイク／描いた波形をPS1の楽器にして、Guitar／PCキーで演奏します。
// PS1 conversion uses mono 44,100 Hz and shows applied 28-frame loop boundaries.
const audio = await inputAudio({
  asset:'/samples/sampler.sample.json', edit:false, target:'ps1',
});
if (audio) {
  keyboard.bind('ps1-sampler', await createSampleInstrument(audio, {target:'ps1'}));
  log('PS1 sampler ready: open Keyboard to play. Edit the saved sample to change its loop or root note.');
}
