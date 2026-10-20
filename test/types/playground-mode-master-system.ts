/// <reference path="../../docs/playground/tetorica-playground-master-system.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkMasterSystemModeTypes() {
  psg.tone(PSG1, {note: 'C4', attenuation: 8});
  pg.psg.setPeriod(PSG2, 254); psg.off(PSG3);
  psg.noise({type: 'periodic', rate: 'high'}); psg.noiseOff();
  await psg.setClock(psg.clock);
  opll.setUserPatch(OPLL_USER_PRESETS.sine);
  opll.setInstrument(0,0,4);opll.noteOn(0,'A4');opll.noteOff(0);
  pg.opll.setVoice(8,{instrument:3,attenuation:6,sustain:true});
  const instrumentName:string = OPLL_INSTRUMENTS[3];
  opll.setUserOperator(0,{tl:30,multi:2,waveform:1});
  opll.setUserOperator(1,{multi:1,ar:15,rr:8});
  opll.setRhythmLevels({bassDrum:4,snare:5,hiHat:7});
  opll.setRhythm({enabled:true,bassDrum:true});opll.allNotesOff();
  const primaryOpll=await useSoundChip('ym2413');primaryOpll.setSustain(0,false);
  // @ts-expect-error borrowed OPLL lifetime belongs to the mode
  primaryOpll.dispose();
  // @ts-expect-error nine physical FM channels
  opll.noteOn(9,'C4');
  // @ts-expect-error builtin instrument numbers are 0..15
  opll.setInstrument(0,16);
  // @ts-expect-error carrier level is per channel, not a shared patch TL
  opll.setUserOperator(1,{tl:0});
  // @ts-expect-error OPLL operators have two waveforms
  opll.setUserOperator(0,{waveform:2});
  await livePrepare('psg', ({psg, sample}) => {
    psg.tone(PSG1, {frequency: 440}); sample.isLoaded('drum');
  });
  await livePrepare('psg-opll',({psg,opll})=>{psg.off(PSG1);opll.keyOff(0);});
  const primary = await useSoundChip('segapsg'); primary.noiseOff();
  // @ts-expect-error borrowed PSG lifetime belongs to the mode
  primary.dispose();
  // @ts-expect-error Master System has no Game Gear stereo register
  psg.setStereo(0xff);
  // @ts-expect-error pg follows the selected mono PSG
  pg.psg.setStereo(0xff);
  // @ts-expect-error cached primary is also mono
  primary.setStereo(0xff);
  // @ts-expect-error native modes have no FM shorthand
  play('C4');
  // @ts-expect-error native modes have no global FM
  fm;
  // @ts-expect-error native modes have no OPN channel constants
  CH1;
  // @ts-expect-error native modes have no operator constants
  OP1;
  // @ts-expect-error pg follows the selected mode
  pg.play;
  // @ts-expect-error no global FM write alias
  write(0x28, 0xf0);
  // @ts-expect-error another primary APU is unavailable
  pce;
  const extra = await createSoundChip('segapsg'); extra.setStereo(0xff); extra.dispose();
  const extraOpll = await createSoundChip('ym2413');extraOpll.setInstrument(0,1);extraOpll.dispose();
}
