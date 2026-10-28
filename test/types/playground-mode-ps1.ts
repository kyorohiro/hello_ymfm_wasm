/// <reference path="../../docs/playground/tetorica-playground-ps1.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
async function checkPs1ModeTypes() {
  const savedAudio=await inputAudio({asset:'/samples/sampler.sample.json',edit:false,target:'ps1'});
  if(savedAudio){
    savedAudio.alignment?.applied.startFrame.toFixed();
    savedAudio.adpcm?.byteLength.toFixed();
    const sampler=await createSampleInstrument(savedAudio,{target:'ps1',volume:192});
    keyboard.bind('ps1-sampler',sampler);
    await sampler.noteOn({id:'press',midi:69,velocity:127});
    await sampler.noteOff({id:'press',midi:69,velocity:127});
    await sampler.allNotesOff();
  }
  // @ts-expect-error Only supported editor targets may be requested.
  inputAudio({target:'psf'});
  const encoded = encodePs1Adpcm(new Float32Array(112), {loopStartSamples:0, maxBytes:64});
  encoded.metrics.snrDb?.toFixed(); encoded.paddingFrames.toFixed();
  const encodedSample = await spu.loadADPCM(encoded.adpcm, {baseFrequencyHz:44100/112,loopStartSamples:encoded.loopStartSamples!});
  pg.encodePs1Adpcm(new Float32Array(1)).metrics.exact.valueOf();
  spu.setPreset(23,{sample:encodedSample});
  // @ts-expect-error Encoder requires normalized Float32 PCM, not encoded bytes.
  encodePs1Adpcm(new Uint8Array(28));
  // @ts-expect-error Loop positions are source sample indexes.
  pg.encodePs1Adpcm(new Float32Array(28), {loop:true});
  // @ts-expect-error The encoder does not perform resampling.
  encodePs1Adpcm(new Float32Array(28), {sampleRate:44100});
  const packetBytes = new Uint8Array(64);
  const sample = await spu.loadADPCM(packetBytes, {baseFrequencyHz:44100/112,loopStartSamples:0});
  sample.startAddress.toFixed(); sample.repeatAddress.toFixed(); sample.decodedFrames.toFixed();
  spu.setPreset(23, {sample,volumeLeft:0.7,volumeRight:-0.7,adsr1:15,adsr2:8});
  spu.setChannel(0,{sample:sample.id});spu.setPitch(0,4096);spu.setFrequency(0,440);spu.setNote(0,'A4');
  spu.setEnvelope(23,{attackRate:40,attackExponential:true,decayRate:4,sustainLevel:8,sustainRate:127,sustainDecrease:true,sustainExponential:false,releaseRate:8,releaseExponential:true});
  spu.setPreset(23,{reverb:true});spu.setReverb({preset:'hall',volumeLeft:.25,volumeRight:.3});
  (await spu.getState()).reverb.preset.toUpperCase();(await spu.getState()).channels[23].envelopeParameters.attackRate.toFixed();
  (await spu.getState()).channels[23].waveform?.pcm[0].toFixed();
  (await spu.getState()).samples[0].editorChannel?.toFixed();
  // @ts-expect-error Direct PCM drawing belongs to the SPU-tab inspector; scripts use encodePs1Adpcm/loadADPCM.
  spu.setWaveform(23,new Float32Array(112));
  // @ts-expect-error Only implemented named reverb approximations are exposed.
  spu.setReverb({preset:'delay'});
  // @ts-expect-error Per-voice reverb routing is boolean.
  spu.setPreset(23,{reverb:1});
  // @ts-expect-error ADSR fields use numeric table indexes, not seconds strings.
  spu.setEnvelope(23,{attackRate:'100ms'});
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
