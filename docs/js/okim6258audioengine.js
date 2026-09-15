// MAME-derived OKIM6258 decoder. Source and license: third_party/mame-okim6258/.
export function validateOki6258Header(header) {
  if (header.okim6258Clock & 0xc0000000) throw new Error('Dual/variant OKIM6258 playback is not supported');
  if (!(header.okim6258Flags & 4)) throw new Error('OKIM6258 3-bit ADPCM playback is not supported (4-bit required)');
}
export class Oki6258AudioEngine {
  static async create({moduleFactory,clock,flags=4,outputSampleRate=44100,masterVolume=1}) {
    validateOki6258Header({okim6258Clock:clock,okim6258Flags:flags});
    if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff||!Number.isInteger(outputSampleRate)||outputSampleRate<8000)throw new RangeError('Invalid OKIM6258 clock/sample rate');
    const module=await moduleFactory();return new Oki6258AudioEngine(module,clock,flags,outputSampleRate,masterVolume);
  }
  constructor(module,clock,flags,rate,volume){
    this.module=module;this.rate=rate;this.volume=volume;this.ptr=0;this.capacity=0;
    this.handle=module._okim6258_create(clock,flags,rate);if(!this.handle)throw new Error('OKIM6258 initialization failed');
  }
  sampleRate(){return this.rate;}
  setMasterVolume(v){if(!Number.isFinite(Number(v)))throw new RangeError('Invalid volume');this.volume=Math.max(0,Math.min(3.8,Number(v)));}
  getMasterVolume(){return this.volume;}
  writeOki6258(r,v){this.module._okim6258_write(this.handle,r,v);}
  reset(){this.module._okim6258_reset(this.handle);}
  dispose(){if(this.ptr)this.module._free(this.ptr);if(this.handle)this.module._okim6258_destroy(this.handle);this.ptr=this.handle=this.capacity=0;}
  processFrames(frames){
    if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
    if(!frames)return {left:new Float32Array(),right:new Float32Array()};
    if(frames>this.capacity){if(this.ptr)this.module._free(this.ptr);this.ptr=this.module._malloc(frames*8);this.capacity=frames;}
    const r=this.ptr+this.capacity*4;this.module._okim6258_generate(this.handle,this.ptr,r,frames);
    return {left:Float32Array.from(this.module.HEAPF32.subarray(this.ptr/4,this.ptr/4+frames),v=>v*this.volume),right:Float32Array.from(this.module.HEAPF32.subarray(r/4,r/4+frames),v=>v*this.volume)};
  }
}
// Player renders through processFrames. Keep the primary engine's monitor hooks
// and channel controls; advance ADPCM over exactly the same output interval.
export function attachOki6258(engine, oki) {
  const render=engine.processFrames.bind(engine),reset=engine.reset.bind(engine),dispose=engine.dispose.bind(engine);
  engine.writeOki6258=(r,v)=>oki.writeOki6258(r,v);
  engine.processFrames=frames=>{const pcm=render(frames),extra=oki.processFrames(frames),volume=engine.getMasterVolume();for(let i=0;i<frames;i++){pcm.left[i]+=extra.left[i]*volume;pcm.right[i]+=extra.right[i]*volume;}return pcm;};
  engine.reset=()=>{reset();oki.reset();};engine.dispose=()=>{dispose();oki.dispose();};
  return engine;
}
