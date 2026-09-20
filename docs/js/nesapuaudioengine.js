import PAPU from './nes_apu_vendor/index.js';

// VGM provides the CPU's recorded writes and DMC memory. CPU IRQs and DMA
// stalls must not delay this already-recorded timeline.
export function validateNesApuClock(clock) {
  if (!Number.isFinite(clock) || clock < 1780000 || clock > 1800000) throw new RangeError('NES APU currently supports NTSC clocks only');
}

export class NesApuAudioEngine {
  constructor({clock=1789773, outputSampleRate=44100, masterVolume=1}={}) {
    validateNesApuClock(clock);
    if (!Number.isInteger(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 192000) throw new RangeError('Invalid NES sample rate');
    this.clock=clock; this.rate=outputSampleRate; this.mask=0;
    this.setMasterVolume(masterVolume); this.reset();
  }
  sampleRate(){return this.rate;}
  reset(){
    this.memory=new Uint8Array(65536); this.samples=[];
    const nes={opts:{sampleRate:this.rate,onAudioSample:(l,r)=>this.samples.push([l,r])},
      cpu:{dataBus:0,instrBusCycles:0,apuCatchupCycles:0,IRQ_NORMAL:0,requestIrq(){},haltCycles(){}},
      mmap:{load:address=>this.memory[address & 65535]}};
    this.apu=new PAPU(nes);
    this.apu.sampleTimerMax=Math.floor(1024*this.clock/this.rate);
    this.apu.setPanning([128,128,128,128,128]);
    this.apu.muteMask=this.mask;
  }
  dispose(){this.apu=null;this.memory=null;this.samples=[];}
  writeNesApu(register,value){
    if (!Number.isInteger(register) || register<0 || register>0x1f) throw new RangeError('FDS/extended NES APU registers are not supported');
    this.apu.writeReg(0x4000+register,value & 255);
  }
  loadNesMemory(data,offset){
    if (!(data instanceof Uint8Array) || !Number.isInteger(offset) || offset<0 || offset+data.length>65536) throw new RangeError('Invalid NES RAM block');
    this.memory.set(data,offset);
  }
  setChannelMuted(channel,muted){
    if (!Number.isInteger(channel)||channel<0||channel>=5) throw new RangeError('Invalid NES APU channel');
    this.mask=muted?this.mask|(1<<channel):this.mask&~(1<<channel);
    this.apu.muteMask=this.mask;
  }
  setMasterVolume(value){if(!Number.isFinite(value))throw new RangeError('Invalid volume');this.volume=Math.max(0,Math.min(3.8,value));}
  getMasterVolume(){return this.volume;}
  process(left,right,frames){
    if(!Number.isInteger(frames)||frames<0||frames>1048576||!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length<frames||right.length<frames)throw new RangeError('Invalid NES output buffers');
    for(let i=0;i<frames;i++){
      while(!this.samples.length)this.apu.clockFrameCounter(1);
      const [l,r]=this.samples.shift();left[i]=l*this.volume;right[i]=r*this.volume;
    }
  }
  processFrames(frames){const left=new Float32Array(frames),right=new Float32Array(frames);this.process(left,right,frames);return {left,right};}
}
export const createNesApuAudioEngine=async options=>new NesApuAudioEngine(options);
