/// <reference path="../../docs/playground/tetorica-playground-huc6280.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkPcEngineModeTypes() {
  pce.setWaveform(0,new Uint8Array(32)); pce.setVolume(0,24); pce.setPan(0,15,8);
  pg.pce.noteOn(0,'C4'); pce.setNoise(5,{enabled:true,frequency:20});
  pce.setLfo({frequency:8,depth:1}); pce.setDda(3,true); pce.writeDda(3,16);
  await pce.setClock(pce.clock); pce.allNotesOff();
  await livePrepare('pce', ({pce,sample}) => { pce.noteOn(5,'C3'); sample.isLoaded('drum'); });
  const primary = await useSoundChip('huc6280'); primary.setMasterVolume(15);
  // @ts-expect-error borrowed PSG lifetime belongs to the mode
  primary.dispose();
  // @ts-expect-error PC Engine has six physical channels
  pce.noteOn(6,'C4');
  // @ts-expect-error noise only exists on channels 4 and 5
  pce.setNoise(3,{enabled:true});
  // @ts-expect-error LFO depth is a two-bit hardware field
  pce.setLfo({frequency:8,depth:4});
  // @ts-expect-error native modes have no FM shorthand
  play('C4');
  // @ts-expect-error native modes have no global FM
  fm;
  // @ts-expect-error pg follows the selected mode
  pg.fm;
  // @ts-expect-error no primary Sega PSG in PC Engine mode
  psg;
  // @ts-expect-error no primary ADPCM in PC Engine mode
  adpcm;
  const extra = await createSoundChip('huc6280'); extra.dispose();
  const independentOki = await useSoundChip('okim6258'); independentOki.setPan(true,true); independentOki.dispose();
}
