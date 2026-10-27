import {WonderSwanAudioEngine} from '../js/wonderswanaudioengine.js';

const RATE=44100,MAX_FRAMES=RATE*10,MAX_BYTES=64*1024*1024;
const REGISTERS=new Set([9,16,17,20,30]);
const validInteger=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const gcd=(a,b)=>b?gcd(b,a%b):a;
const invalid=()=>{throw new Error('Invalid WonderSwan Voice PCM capture');};

/** Render only CH2 Voice PCM, retaining source timing, routing and DAC phase.
 * A bounded pre-roll restores the last held Voice value and fractional tick;
 * prior wavetable output and the outer playback Mixer are not included.
 */
export async function renderWonderSwanVoicePreview(sample,{getFactory,signal}={}) {
  const duration=sample.durationSamples,source=sample.sourceStartSample;
  const {times,registers,values,initial,clock}=sample;
  if(sample.kind!=='voice-pcm'||!validInteger(clock,100000000)||clock<128||
    !validInteger(duration,MAX_FRAMES)||duration===0||!validInteger(source,Number.MAX_SAFE_INTEGER)||
    !times||!registers||!values||times.length!==registers.length||times.length!==values.length||
    times.length*6>MAX_BYTES)invalid();
  for(const state of [initial?.registers,initial?.heldRegisters]) {
    if(state?.length!==32)invalid();
    for(const value of state)if(!validInteger(value,255))invalid();
  }
  let previous=0;
  for(let index=0;index<times.length;index++) {
    if(!validInteger(times[index],duration)||times[index]<previous||!REGISTERS.has(registers[index])||!validInteger(values[index],255))invalid();
    previous=times[index];
  }
  signal?.throwIfAborted();
  const factory=await getFactory?.('wonderswan');
  if(!factory)throw new Error('Missing sample factory: wonderswan');
  const chip=await WonderSwanAudioEngine.create({moduleFactory:factory,clock,outputSampleRate:RATE});
  try {
    const configure=state=>{
      for(const register of [9,20,17,30,16])chip.writeWonderSwan(register,
        register===16?(state[16]&32?state[16]&0x22:0):state[register]);
    };
    if(source>0) {
      const period=RATE/gcd(Math.floor(clock/128),RATE);
      configure(initial.heldRegisters);
      // At least one tick is needed even when the phase is exactly zero.
      chip.processFrames(source%period+period);
    }
    configure(initial.registers);
    const left=new Float32Array(duration),right=new Float32Array(duration);
    let position=0;
    const advance=end=>{
      if(end<=position)return;
      const pcm=chip.processFrames(end-position);
      left.set(pcm.left,position);right.set(pcm.right,position);position=end;
    };
    for(let index=0;index<values.length;index++) {
      advance(times[index]);
      const register=registers[index],value=values[index];
      chip.writeWonderSwan(register,register===16?(value&32?value&0x22:0):value);
      if((index&4095)===4095){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
    }
    advance(duration);signal?.throwIfAborted();
    return {left,right,sampleRate:RATE};
  } finally {chip.dispose();}
}
