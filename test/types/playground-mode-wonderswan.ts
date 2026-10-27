/// <reference path="../../docs/playground/tetorica-playground-wonderswan.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
async function checkWonderSwanModeTypes() {
  ws.setWaveform(0,new Uint8Array(32)); ws.setVolume(0,12,8);
  pg.ws.noteOn(3,'C4'); ws.setNoise({enabled:true,type:7});
  ws.setSweep({enabled:true,step:-1,time:8}); ws.setVoiceMode(false);
  await ws.setClock(ws.clock); ws.allNotesOff();
  await livePrepare('ws',({ws}) => {ws.noteOn(0,'C4');});
  const primary=await useSoundChip('wonderswan'); primary.setPan(3,15);
  // @ts-expect-error borrowed chip lifetime belongs to this mode
  primary.dispose();
  // @ts-expect-error four physical channels
  ws.noteOn(4,'C4');
  // @ts-expect-error noise type is a three-bit hardware field
  ws.setNoise({enabled:true,type:8});
  // @ts-expect-error no FM shorthand in WonderSwan mode
  play('C4');
  // @ts-expect-error no primary FM
  fm;
  // @ts-expect-error pg follows the selected mode
  pg.fm;
  // @ts-expect-error no primary Game Boy
  gameboy;
  const extra=await createSoundChip('wonderswan'); extra.reset(); extra.adoptRegisterState(); extra.setVolume(0,9,9); extra.dispose();
  const score=primary.createTimeline({clock:3072000,pcmData:new Uint8Array([0,128,4,192])});
  score.writeRegister(0x90,0x22); score.adoptRegisterState(); score.setVolume(0,9);
  score.at(10).pcm(0,4,2,14);
  await primary.prepareTimeline(score.finish(44100));
  await primary.playTimeline(); await primary.stopTimeline();
}
