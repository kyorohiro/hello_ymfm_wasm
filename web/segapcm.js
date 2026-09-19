export const SEGAPCM_CLOCK = 4000000;
export function validateSegaPcm({clock=SEGAPCM_CLOCK,sampleRate=44100}={}) {
  if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff||!Number.isInteger(sampleRate)||sampleRate<=0||sampleRate>384000)
    throw new RangeError('Invalid Sega PCM clock or sample rate');
}
export class SegaPcm {
  static async create({moduleFactory,moduleOptions,clock=SEGAPCM_CLOCK,sampleRate=44100,bankShift=0,bankMask=0}={}) {
    validateSegaPcm({clock,sampleRate});
    if(typeof moduleFactory!=='function')throw new Error('moduleFactory is required');
    const module=await moduleFactory({...moduleOptions});
    const api={};
    for(const [name,ret,args] of [
      ['create','number',4],['destroy',null,1],['reset',null,1],['write',null,3],
      ['load_memory','number',5],['clear_memory',null,1],
      ['sample_rate','number',1],['set_mute_mask',null,2],['generate',null,4]])
      api[name]=module.cwrap(`segapcm_${name}`,ret,Array(args).fill('number'));
    const handle=api.create(sampleRate,clock,bankShift,bankMask);
    if(!handle)throw new Error('Could not create Sega PCM');
    return new SegaPcm(module,handle,api);
  }
  constructor(module,handle,api){this.module=module;this.handle=handle;this.api=api;this.ptr=0;this.capacity=0;this.sampleMemorySize=0;}
  assertAlive(){if(!this.handle)throw new Error('SegaPcm is disposed');}
  reset(){this.assertAlive();this.api.reset(this.handle);}
  // offset is the flat 0-0xFFFF window addressed by VGM's 0xC0 command.
  writeRegister(offset,value){
    this.assertAlive();
    if(!Number.isInteger(offset)||offset<0||offset>0xffff||!Number.isInteger(value)||value<0||value>255)
      throw new RangeError('Invalid Sega PCM register write');
    this.api.write(this.handle,offset,value);
  }
  loadSampleMemory(data,offset=0,memorySize=offset+data.length){
    this.assertAlive();
    if(!(data instanceof Uint8Array)||!Number.isInteger(offset)||!Number.isInteger(memorySize)||
        offset<0||memorySize<offset||memorySize>0x200000||data.length>memorySize-offset)
      throw new RangeError('Invalid sample memory range');
    const ptr=this.module._malloc(data.length||1);
    try {
      this.module.HEAPU8.set(data,ptr);
      if(!this.api.load_memory(this.handle,ptr,data.length,offset,memorySize))throw new RangeError('Invalid sample memory');
      this.sampleMemorySize=memorySize;
    } finally { this.module._free(ptr); }
  }
  clearSampleMemory(){this.assertAlive();this.api.clear_memory(this.handle);this.sampleMemorySize=0;}
  setMuteMask(mask){this.assertAlive();this.api.set_mute_mask(this.handle,mask);}
  sampleRate(){this.assertAlive();return this.api.sample_rate(this.handle);}
  generateStereo(frames){
    this.assertAlive();
    if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
    if(frames>this.capacity){
      const ptr=this.module._malloc(frames*8);
      if(!ptr)throw new Error('Sega PCM audio buffer allocation failed');
      if(this.ptr)this.module._free(this.ptr);
      this.ptr=ptr;this.capacity=frames;
    }
    const rightPtr=this.ptr+this.capacity*4;
    this.api.generate(this.handle,this.ptr,rightPtr,frames);
    return {left:new Float32Array(this.module.HEAPF32.subarray(this.ptr/4,this.ptr/4+frames)),
      right:new Float32Array(this.module.HEAPF32.subarray(rightPtr/4,rightPtr/4+frames))};
  }
  dispose(){if(this.ptr)this.module._free(this.ptr);if(this.handle)this.api.destroy(this.handle);this.ptr=0;this.handle=0;this.capacity=0;}
}
