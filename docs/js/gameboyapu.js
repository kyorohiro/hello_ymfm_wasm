export const GAMEBOY_APU_CLOCK = 4194304;
export function validateGameboyApu({clock=GAMEBOY_APU_CLOCK,sampleRate=44100}={}) {
  if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff||!Number.isInteger(sampleRate)||sampleRate<=0||sampleRate>384000)
    throw new RangeError('Invalid Game Boy APU clock or sample rate');
}
export class GameboyApu {
  static async create({moduleFactory,moduleOptions,clock=GAMEBOY_APU_CLOCK,sampleRate=44100}={}) {
    validateGameboyApu({clock,sampleRate});
    if(typeof moduleFactory!=='function')throw new Error('moduleFactory is required');
    const module=await moduleFactory({...moduleOptions});
    const api={};
    for(const [name,ret,args] of [
      ['create','number',2],['destroy',null,1],['reset',null,1],['write',null,3],
      ['sample_rate','number',1],['set_mute_mask',null,2],['generate',null,4]])
      api[name]=module.cwrap(`gameboy_apu_${name}`,ret,Array(args).fill('number'));
    const handle=api.create(sampleRate,clock);
    if(!handle)throw new Error('Could not create Game Boy APU');
    return new GameboyApu(module,handle,api);
  }
  constructor(module,handle,api){this.module=module;this.handle=handle;this.api=api;this.ptr=0;this.capacity=0;}
  assertAlive(){if(!this.handle)throw new Error('GameboyApu is disposed');}
  reset(){this.assertAlive();this.api.reset(this.handle);}
  // offset is relative to GB I/O 0xFF10 (0x00-0x2F): see third_party/mame-gameboy/README.md.
  writeRegister(offset,value){
    this.assertAlive();
    if(!Number.isInteger(offset)||offset<0||offset>0xff||!Number.isInteger(value)||value<0||value>255)
      throw new RangeError('Invalid Game Boy APU register write');
    this.api.write(this.handle,offset,value);
  }
  setMuteMask(mask){this.assertAlive();this.api.set_mute_mask(this.handle,mask);}
  sampleRate(){this.assertAlive();return this.api.sample_rate(this.handle);}
  generateStereo(frames){
    this.assertAlive();
    if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
    if(frames>this.capacity){
      const ptr=this.module._malloc(frames*8);
      if(!ptr)throw new Error('Game Boy APU audio buffer allocation failed');
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
