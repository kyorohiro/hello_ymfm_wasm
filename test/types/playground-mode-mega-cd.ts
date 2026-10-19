/// <reference path="../../docs/playground/tetorica-playground-mega-cd.d.ts" />
/// <reference path="./playground-mode-common.ts" />
/// <reference path="./playground-mode-without-opna.ts" />

async function checkMegaCDModeTypes() {
  onKeyboardPressKey('typed-input', event => {
    const editable: boolean = event.editable;
    const code: string = event.code;
  });
  fm.setPan(CH6, true, false);
  fm.setDacEnabled(true);
  await pg.fm.dac.stop();
  await play('C4', {channel: CH6});
  pg.psg.noteOn(pg.PSG1, 'C4');
  pg.psgTone(pg.PSG2, 400);
  const lastMidiChannel: 15 = pg.CH16;
  await livePrepare('mega-cd', ({fm, psg}) => {
    fm.setDacEnabled(false);
    psg.off(0);
  });
  const primary = await useSoundChip('ym2612');
  await primary.dac.stop();
  const pcm = await useSoundChip('rf5c164');
  const audio = await inputAudio({title: 'Choose a sound'});
  const saved = await inputAudio({asset:'/samples/voice.sample.json',edit:false});
  const contextAudio: PlaygroundAudioInput | null = await pg.inputAudio();
  if (audio) {
    const kind: 'file' | 'microphone' = audio.source;
    const channel: Float32Array = audio.channels[0];
    await pcm.loadSample(audio,{endGuardBytes:32});
    const instrument = await createSampleInstrument(audio,{target:'rf5c164',volume:72});
    keyboard.bind('sampler',instrument);
    const contextInstrument: PlaygroundSampleInstrument = await pg.createSampleInstrument(audio,{target:'auto'});
    pg.keyboard.bind('sample-events',{
      noteOn(event) {const pitch: number = event.midi; const identity: string = event.id;},
      noteOff(event) {const velocity: number = event.velocity;},
      allNotesOff() {},
    });
    // @ts-expect-error sample targets are explicit supported adapters
    await createSampleInstrument(audio,{target:'nes'});
  }
  await pcm.loadMemory(new Uint8Array([128, 180, 128, 52, 255]));
  await pcm.setChannel(7, {start: 0, loopStart: 0, step: 1000, volume: 80, pan: {left: 15, right: 15}});
  await pcm.keyOn(7);
  await pcm.setClock(12500000);
  // @ts-expect-error the selected mode owns its built-in PCM device
  pcm.dispose();
  const independent = await createSoundChip('rf5c164');
  independent.dispose();
}
