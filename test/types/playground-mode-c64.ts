/// <reference path="../../docs/playground/tetorica-playground-c64.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkC64ModeTypes() {
  sid.initialize();
  sid.setVoice(0, {waveform:'pulse',pulseWidth:2048,attack:2,decay:6,sustain:12,release:5});
  sid.setVoice(1, {sync:true,ring:true,test:false});
  sid.setFilter({mode:'bandpass',cutoff:1000,resonance:6,routing:7,volume:8,voice3off:false});
  sid.setFilter({mode:'lowpass+bandpass'});
  sid.setFilter({mode:'bandpass+highpass'});
  sid.setFilter({mode:'lowpass+bandpass+highpass'});
  const hz:number = sid.setNote(0, 'C4');
  sid.setFrequency(1, hz * 2); sid.keyOn(1); sid.noteOff(1);
  sid.noteOn(2, 67); sid.keyOff(2); pg.sid.allNotesOff();
  sid.writeRegister(24, 8);
  (await sid.readRegister(27)).toFixed();
  const state:PlaygroundSidState = await sid.getState();
  state.channels[0].waveforms.includes('triangle');
  const primary = await useSoundChip('sid');
  const acknowledged:boolean = await primary.setClock(985248);
  void acknowledged;
  const extra = await createSoundChip('sid', {id:'sid:ntsc',clock:1022727,model:'6581'});
  extra.reset(); extra.initialize(); extra.noteOn(0, 'A4'); extra.dispose();
  await livePrepare('sid-types', ({sid}) => sid.allNotesOff());
  // @ts-expect-error Only three physical voices.
  sid.keyOn(3);
  // @ts-expect-error The initial prototype models only 6581.
  await createSoundChip('sid', {model:'8580'});
  // @ts-expect-error The waveform API uses explicit hardware waveform names.
  sid.setVoice(0, {waveform:'sine'});
  // @ts-expect-error A borrowed mode primary has no disposal method.
  primary.dispose();
  // @ts-expect-error C64 mode has no implicit FM convenience.
  fm;
  // @ts-expect-error The mode uses sid.noteOn, not the OPN play helper.
  play('C4');
  // @ts-expect-error There is no implicit OPN channel constant.
  CH1;
}
