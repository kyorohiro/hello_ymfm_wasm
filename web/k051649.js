export function validateK051649({clock, sampleRate=44100}={}) {
  if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff||!Number.isInteger(sampleRate)||sampleRate<=0||sampleRate>384000)
    throw new RangeError('Invalid K051649 clock or sample rate');
}
export class K051649 {
  static async create({moduleFactory,moduleOptions,clock,sampleRate=44100}={}) {
    validateK051649({clock,sampleRate});
    if(typeof moduleFactory!=='function')throw new Error('moduleFactory is required');
    const module=await moduleFactory({...moduleOptions});
    const api={};
    for(const [name,ret,args] of [
      ['create','number',2],['destroy',null,1],['reset',null,1],['write',null,4],
      ['sample_rate','number',1],['set_mute_mask',null,2],['generate',null,4]])
      api[name]=module.cwrap(`k051649_${name}`,ret,Array(args).fill('number'));
    const handle=api.create(sampleRate,clock);
    if(!handle)throw new Error('Could not create K051649');
    return new K051649(module,handle,api);
  }
  constructor(module,handle,api){this.module=module;this.handle=handle;this.api=api;this.ptr=0;this.capacity=0;}
  assertAlive(){if(!this.handle)throw new Error('K051649 is disposed');}
  reset(){this.assertAlive();this.api.reset(this.handle);}
  // port selects the register group (0=SCC waveform, 1=frequency, 2=volume,
  // 3=key on/off, 4=SCC+/052539 waveform, 5=test); see the VGM 0xD2 command.
  writeRegister(port,register,value){
    this.assertAlive();
    if(!Number.isInteger(port)||port<0||port>7||!Number.isInteger(register)||register<0||register>255||!Number.isInteger(value)||value<0||value>255)
      throw new RangeError('Invalid K051649 register write');
    this.api.write(this.handle,port,register,value);
  }
  setMuteMask(mask){this.assertAlive();this.api.set_mute_mask(this.handle,mask);}
  sampleRate(){this.assertAlive();return this.api.sample_rate(this.handle);}
  generateStereo(frames){
    this.assertAlive();
    if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
    if(frames>this.capacity){
      const ptr=this.module._malloc(frames*8);
      if(!ptr)throw new Error('K051649 audio buffer allocation failed');
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
