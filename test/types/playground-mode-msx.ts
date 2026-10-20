/// <reference path="../../docs/playground/tetorica-playground-msx.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkMsxModeTypes() {
  ay.tone(0,{note:'A4',volume:9}); ay.setVoice(2,{tone:true,noise:true,volume:10});
  ay.setEnvelope({period:2000,shape:10});ay.setVolume(1,12,true);ay.setNoisePeriod(16);
  pg.ay.setMixer(0,{noise:false});ay.noteOn(0,'C4');ay.keyOff(0);
  opll.setUserPatch(OPLL_USER_PRESETS.sine);opll.setVoice(8,{instrument:0,attenuation:5});
  pg.opll.setInstrument(0,3);opll.noteOn(8,'A4');opll.noteOff(8);
  const name:string=OPLL_INSTRUMENTS[3];void name;
  await livePrepare('msx',({ay,opll})=>{ay.allNotesOff();opll.allNotesOff();});
  const primaryAy=await useSoundChip('ay8910');primaryAy.setVoice(0,{volume:9});
  const primaryOpll=await useSoundChip('ym2413');primaryOpll.setSustain(0,false);
  const addedAudio=await useSoundChip('y8950');addedAudio.setFrequency(0,440);addedAudio.dispose();
  // @ts-expect-error AY's lifetime belongs to the mode
  primaryAy.dispose();
  // @ts-expect-error OPLL's lifetime belongs to the mode
  primaryOpll.dispose();
  // @ts-expect-error AY has three channels
  ay.noteOn(3,'A4');
  // @ts-expect-error AY tone/noise mixer uses booleans
  ay.setVoice(0,{noise:1});
  // @ts-expect-error OPLL has nine FM channels
  opll.noteOn(9,'A4');
  // @ts-expect-error MSX Audio's Y8950 is not part of the two-chip MSX mode
  opl;
  // @ts-expect-error pg also has no implicit Y8950
  pg.opl;
  // @ts-expect-error OPL presets belong to MSX Audio; independent chips accept explicit presets
  OPL_PRESETS;
  // @ts-expect-error MSX has no implicit OPN fm
  fm;
  // @ts-expect-error MSX exposes AY as ay, not Sega PSG
  psg;
  // @ts-expect-error no OPN convenience play in MSX
  play('C4');
  // @ts-expect-error no OPN constants in MSX
  CH1;
  // @ts-expect-error pg follows the native composite environment
  pg.fm;
  const extra=await createSoundChip('ay8910');extra.dispose();
  const extraOpll=await createSoundChip('ym2413');extraOpll.dispose();
  const extraAudio=await createSoundChip('y8950');extraAudio.dispose();
}
