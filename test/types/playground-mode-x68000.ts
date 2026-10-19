/// <reference path="../../docs/playground/tetorica-playground-x68000.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkX68000ModeTypes() {
  opm.setOperator(7,3,{mul:1,tl:30,ar:31,rr:8}); opm.setAlgo(7,7); opm.setPan(7,true,true);
  pg.opm.noteOn(7,'A4'); await opm.setClock(opm.clock);
  const info = await adpcm.loadSample({channels:[new Float32Array(100)],sampleRate:15625});
  const frames:number = info.paddedFrames;
  adpcm.setDivider(512); adpcm.setPlaybackRate(15625); adpcm.setPan(true,false);
  pg.adpcm.play({repeat:true}); adpcm.stop();
  await livePrepare('x68', ({opm,adpcm,noise}) => { opm.setNoise(true,8); adpcm.keyOff(); noise.stopAll(); });
  const primaryOpm = await useSoundChip('ym2151'); primaryOpm.keyOff(7);
  const primaryOki = await useSoundChip('okim6258'); await primaryOki.setClock(4000000);
  // @ts-expect-error borrowed OPM lifetime belongs to the mode
  primaryOpm.dispose();
  // @ts-expect-error borrowed ADPCM lifetime belongs to the mode
  primaryOki.dispose();
  // @ts-expect-error OPM has eight physical channels
  opm.noteOn(8,'C4');
  // @ts-expect-error no OPN preset API is implemented on OPM
  opm.setPreset(0,{});
  // @ts-expect-error only actual OKI hardware dividers are valid
  adpcm.setDivider(256);
  // @ts-expect-error OKI streams have no ADPCM-B memory-range registers
  adpcm.setSample({start:0,end:32});
  // @ts-expect-error no OPN FM shorthand in X68000 mode
  play('C4');
  // @ts-expect-error OPM uses its own namespace
  fm;
  // @ts-expect-error native modes have no MIDI/FM convenience object
  pg.midi;
  // @ts-expect-error OPN operator constants are absent
  OP1;
  const extra = await createSoundChip('okim6258'); extra.dispose();
  const extraOpm = await createSoundChip('ym2151'); extraOpm.dispose();
}
