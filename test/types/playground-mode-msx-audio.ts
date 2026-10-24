/// <reference path="../../docs/playground/tetorica-playground-msx-audio.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkMsxAudioModeTypes() {
  ay.tone(0,{note:'A4',volume:9}); ay.setVoice(2,{tone:true,noise:true,volume:10});
  ay.setEnvelope({period:2000,shape:10});ay.setVolume(1,12,true);ay.setNoisePeriod(16);
  pg.ay.setMixer(0,{noise:false});ay.noteOn(0,'C4');ay.keyOff(0);
  opll.setUserPatch(OPLL_USER_PRESETS.sine);opll.setVoice(8,{instrument:0,attenuation:5});
  pg.opll.setInstrument(0,3);opll.noteOn(8,'A4');opll.noteOff(8);
  opl.setPreset(8,OPL_PRESETS.sine);pg.opl.noteOn(8,'A4');opl.noteOff(8);
  const name:string=OPLL_INSTRUMENTS[3];void name;
  await livePrepare('msx',({ay,opll,opl})=>{ay.allNotesOff();opll.allNotesOff();opl.allNotesOff();});
  const primaryAy=await useSoundChip('ay8910');primaryAy.setVoice(0,{volume:9});
  const primaryOpll=await useSoundChip('ym2413');primaryOpll.setSustain(0,false);
  const primaryAudio=await useSoundChip('y8950');primaryAudio.setPreset(0,OPL_PRESETS.bell);
  await pg.opl.adpcm.loadMemory(new Uint8Array(32));
  const sample=await opl.adpcm.loadSample({channels:[new Float32Array(128)],sampleRate:16000});
  const rate:number=primaryAudio.adpcm.setPlaybackRate(sample.sampleRate);
  opl.adpcm.setSample({start:sample.start,end:sample.end});
  opl.adpcm.setVolume(160);opl.adpcm.keyOn();opl.adpcm.keyOff();void rate;
  // @ts-expect-error OPLL does not have the Y8950 ADPCM stream
  opll.adpcm;
  // @ts-expect-error AY's lifetime belongs to the mode
  primaryAy.dispose();
  // @ts-expect-error OPLL's lifetime belongs to the mode
  primaryOpll.dispose();
  // @ts-expect-error Y8950's lifetime belongs to the mode
  primaryAudio.dispose();
  // @ts-expect-error AY has three channels
  ay.noteOn(3,'A4');
  // @ts-expect-error AY tone/noise mixer uses booleans
  ay.setVoice(0,{noise:1});
  // @ts-expect-error OPLL has nine FM channels
  opll.noteOn(9,'A4');
  // @ts-expect-error Y8950 has nine FM channels
  opl.noteOn(9,'A4');
  // @ts-expect-error Y8950 is not an OPL3 four-operator device
  opl.setFourOp(0,true);
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
  const extraAudio=await createSoundChip('y8950');await extraAudio.adpcm.clearMemory();extraAudio.dispose();
}
