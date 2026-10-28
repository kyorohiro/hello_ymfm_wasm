/// <reference path="../../docs/playground/tetorica-playground-ps1.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
async function checkPs1ModeTypes() {
  const packetBytes = new Uint8Array(64);
  const sample = await spu.loadADPCM(packetBytes, {baseFrequencyHz:44100/112,loopStartSamples:0});
  sample.startAddress.toFixed(); sample.repeatAddress.toFixed(); sample.decodedFrames.toFixed();
  spu.setPreset(23, {sample,volumeLeft:0.7,volumeRight:-0.7,adsr1:15,adsr2:8});
  spu.setChannel(0,{sample:sample.id});spu.setPitch(0,4096);spu.setFrequency(0,440);spu.setNote(0,'A4');
  spu.keyOn(0);spu.keyOff(0);spu.noteOn(23,'C4');spu.noteOff(23);spu.allNotesOff();
  pg.spu.noteOn(0,60);await livePrepare('spu',async ({spu})=>{await spu.getState();});
  (await spu.getPreset(23)).adsr1.toFixed();(await spu.getState()).channels[23].envelope.toFixed();
  (await spu.snapshot()).registers.byteLength.toFixed();spu.reset();spu.reset({clearRam:true});
  const primary=await useSoundChip('ps1');primary.noteOn(23,'A4');
  // @ts-expect-error Primary lifetime belongs to this mode.
  primary.dispose();
  // @ts-expect-error The primary global cannot be disposed by a script.
  spu.dispose();
  // @ts-expect-error Exactly 24 zero-based physical voices.
  spu.keyOn(24);
  // @ts-expect-error Exactly 24 zero-based physical voices.
  spu.setPreset(-1,{sample});
  // @ts-expect-error Tuning must be declared.
  await spu.loadADPCM(packetBytes,{});
  // @ts-expect-error Tuning declarations are mutually exclusive.
  await spu.loadADPCM(packetBytes,{rootNote:60,baseFrequencyHz:440});
  // @ts-expect-error Loops use source sample indexes, not booleans.
  await spu.loadADPCM(packetBytes,{rootNote:60,loop:true});
  // @ts-expect-error Fixed native SPU rate has no configurable master clock.
  spu.setClock(44100);
  // @ts-expect-error Native RAM reset is explicitly boolean.
  spu.reset({clearRam:1});
  // @ts-expect-error SPU instruments accept encoded bytes, not musical note strings.
  await spu.loadADPCM('A4',{rootNote:60});
  // @ts-expect-error GetState is an async worklet readback.
  spu.getState().channels;
  // @ts-expect-error There is no primary FM convenience in PS1 mode.
  fm;
  // @ts-expect-error There is no OPN play shorthand in PS1 mode.
  play('C4');
  // @ts-expect-error The selected pg namespace has no FM section.
  pg.fm;
  // @ts-expect-error Other primary hardware is unavailable.
  snes;
  const extra=await createSoundChip('ps1',{id:'spu-extra'});extra.noteOn(23,69);extra.dispose();
  // @ts-expect-error Independent SPU also has no chip-clock controls.
  extra.setClock(44100);
  const independentFm=await useSoundChip('ym2612');independentFm.noteOn(0,'A4');independentFm.dispose();
}
