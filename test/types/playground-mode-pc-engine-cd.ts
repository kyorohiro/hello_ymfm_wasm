/// <reference path="../../docs/playground/tetorica-playground-pc-engine-cd.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkPcEngineCDModeTypes() {
  pce.setWaveform(0,new Uint8Array(32));pce.setVolume(0,24);pce.noteOn(0,'C4');
  await adpcm.loadMemory('/samples/voice.adpcm');
  const info=await adpcm.loadSample({channels:[new Float32Array(8000)],sampleRate:8000},{rate:12});
  const frames:number=info.frames,rate:PlaygroundMsm5205Rate=info.rate;
  await adpcm.loadSample('/samples/voice.wav',{signal:new AbortController().signal,decodeAudio:async()=>({channels:[[0,1,0]],sampleRate:8000})});
  await adpcm.play({offset:0,length:frames,loop:true,rate,at:1});
  await adpcm.writeRegister(0,1);await adpcm.stop();await adpcm.reset({at:2});
  const state=await adpcm.getState();const cursor:number=state.positionNibbles;
  pg.pce.keyOff(0);await pg.adpcm.play();await pg.msm5205.loadMemory(new Uint8Array([0x12]));
  await cdda.load('/audio.wav');await pg.cdda.play();
  await livePrepare('cd',async({pce,adpcm,cdda,msm5205})=>{pce.keyOff(0);await adpcm.stop();await msm5205.reset();await cdda.stop();});
  const primary=await useSoundChip('huc6280');primary.setMasterVolume(15);
  // @ts-expect-error primary PSG has a borrowed lifetime in both PCE modes
  primary.dispose();
  // @ts-expect-error no primary FM shorthand
  play('C4');
  // @ts-expect-error no FM chip in PC Engine CD mode
  fm;
  // @ts-expect-error no FM chip in PC Engine CD mode
  pg.fm;
  // @ts-expect-error rate is the hardware register 0..15, not Hz
  adpcm.play({rate:8000});
  // @ts-expect-error nibble offset is numeric
  adpcm.play({offset:'2'});
  // @ts-expect-error MSM5205 is a system source, not a generic sound-chip factory kind
  createSoundChip('msm5205');
  // @ts-expect-error mono MSM5205 has no OPN hardware pan API
  adpcm.setPan(true,false);
  // @ts-expect-error no owned endpoint disposal in the public system API
  adpcm.dispose();
  void cursor;
}
