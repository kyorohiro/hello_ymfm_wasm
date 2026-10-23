/** NES APU + FDS using the shared Native/WASM C++ core. No audio device. */
import {NES_APU_CLOCK,validateNesApuClock} from './nesapu.js?v=nes-wasm-1';

const FRAMES_MAX=1048576;
const frameCount=frames=>{if(!Number.isInteger(frames)||frames<0||frames>FRAMES_MAX)throw new RangeError('Invalid NES frame count');return frames;};
const address=value=>{if(!Number.isInteger(value)||!((value>=0x4000&&value<=0x4017)||value===0x4023||(value>=0x4040&&value<=0x407f)||(value>=0x4080&&value<=0x408a)))throw new RangeError('Unsupported NES/FDS address');return value;};

async function load(options){
  options.signal?.throwIfAborted();
  if(options.moduleFactory)return options;
  const base=new URL(options.assetBaseUrl??(import.meta.url.includes('/web/')?'../docs/generated/':'../generated/'),import.meta.url);
  const {default:moduleFactory}=await import(new URL('nesapu_wasm.js?v=nes-wasm-1',base).href),moduleOptions={...options.moduleOptions};
  if(moduleOptions.wasmBinary===undefined&&!moduleOptions.locateFile){
    const url=new URL('nesapu_wasm.wasm',base);
    if(url.protocol==='file:'&&typeof process!=='undefined'&&process.versions?.node){
      const {readFile}=await import('node:fs/promises');moduleOptions.wasmBinary=await readFile(url,{signal:options.signal});
    }else{
      const response=await fetch(url,{signal:options.signal});if(!response.ok)throw new Error(`Failed to load NES WASM: HTTP ${response.status}`);
      moduleOptions.wasmBinary=new Uint8Array(await response.arrayBuffer());
    }
  }
  options.signal?.throwIfAborted();return {...options,moduleFactory,moduleOptions};
}

export class NesApuWasm {
  /** @param {import('./soundchip.js?v=native-extra-okim6258-1').SoundChipOptions} [options] */
  static async create(options={}){
    const {clock=NES_APU_CLOCK,sampleRate=44100,fds=false}=options;validateNesApuClock(clock);
    if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('Invalid NES sample rate');
    const loaded=await load(options),module=await loaded.moduleFactory({...loaded.moduleOptions});
    options.signal?.throwIfAborted();
    const api={};for(const [key,name,result,count]of[
      ['create','native_nes_create','number',3],['destroy','native_nes_destroy',null,1],['reset','native_nes_reset',null,1],
      ['write','native_nes_write',null,3],['enable','native_nes_enable',null,3],['load','native_nes_load','number',4],
      ['mute','native_nes_set_mute',null,2],['state','native_nes_get_state',null,2],['read','native_nes_read_memory','number',2],
      ['generate','nesapu_generate',null,4],['stateSize','nesapu_state_size','number',0],
      ['stateOffset','nesapu_state_offset','number',1],['fieldCount','nesapu_state_field_count','number',0],
    ])api[key]=module.cwrap(name,result,Array(count).fill('number'));
    if(api.fieldCount()!==31||api.stateSize()<=0||api.stateSize()>4096)throw new Error('Unsupported NES WASM state ABI');
    const handle=api.create(sampleRate,clock,Boolean(fds));if(!handle)throw new Error('Could not allocate NES WASM core');
    let chip;try{chip=new NesApuWasm(module,handle,api,{clock,sampleRate,fds:Boolean(fds)});
      chip.uploadPtr=module._malloc(65536);if(!chip.uploadPtr)throw new Error('NES RAM upload allocation failed');chip.uploadCapacity=65536;
      chip.reserveStereoFrames(128);options.signal?.throwIfAborted();return chip;}
    catch(error){if(chip)chip.dispose();else api.destroy(handle);throw error;}
  }
  constructor(module,handle,api,{clock,sampleRate,fds}){
    this.backend='wasm';this.module=module;this.handle=handle;this.api=api;this.clock=clock;this.rate=sampleRate;this.fdsEnabled=fds;
    this.ptr=0;this.capacity=0;this.uploadPtr=0;this.uploadCapacity=0;this.buffer=null;this.views=new Map();this.muteMask=0;
    this.offsets=Array.from({length:31},(_,index)=>api.stateOffset(index));this.stateSize=api.stateSize();
    this.statePtr=module._malloc(this.stateSize);if(!this.statePtr)throw new Error('NES state buffer allocation failed');
  }
  check(){if(!this.handle)throw new Error('NES APU disposed');}
  refreshViews(){
    const buffer=this.module.HEAPF32.buffer;if(buffer===this.buffer)return;
    this.buffer=buffer;this.views.clear();this.stateView=new DataView(buffer,this.statePtr,this.stateSize);
  }
  snapshot(){this.check();this.refreshViews();this.api.state(this.handle,this.statePtr);return this.stateView;}
  get enableMask(){return this.snapshot().getUint32(this.offsets[20],true);}
  /** Applied state, copied once for observation. Reading never advances audio. */
  getState(){
    const view=this.snapshot(),bytes=(field,count)=>Array.from(new Uint8Array(view.buffer,view.byteOffset+this.offsets[field],count));
    const u32=field=>view.getUint32(this.offsets[field],true),words=(field,count)=>Array.from({length:count},(_,index)=>view.getUint32(this.offsets[field]+index*4,true));
    return {backend:'wasm',registers:bytes(0,144),wave:bytes(1,64),modulation:bytes(2,32),periods:words(3,5),lengths:words(4,4),volumes:words(5,4),
      dmcAddress:u32(6),dmcRemaining:u32(7),dmcOutput:u32(8),dmcFrequency:u32(9),fdsFrequency:u32(10),fdsModFrequency:u32(11),
      fdsModIndex:u32(12),fdsModClock:u32(13),fdsModCounter:view.getInt32(this.offsets[14],true),fdsGain:u32(15),fdsSweepGain:u32(16),
      fdsMaster:u32(17),fdsAccumulator:u32(18),fdsOutput:u32(19),enableMask:u32(20),muteMask:u32(21),fdsEnabled:!!u32(22),
      fdsIo:!!u32(23),fdsActive:!!u32(24),fdsWriteEnabled:!!u32(25),fdsModEnabled:!!u32(26),frameIrq:!!u32(27),dmcIrq:!!u32(28),
      clock:view.getFloat64(this.offsets[29],true),baseClock:view.getFloat64(this.offsets[30],true)};
  }
  writeRegister(register,value){
    this.check();address(register);if(!Number.isInteger(value)||value<0||value>255)throw new RangeError('NES value must be 0..255');
    if(register>=0x4023&&!this.fdsEnabled)throw new RangeError('FDS registers require the FDS header flag');this.api.write(this.handle,register,value);
  }
  setChannelEnabled(channel,enabled){
    this.check();if(!Number.isInteger(channel)||channel<0||channel>4||typeof enabled!=='boolean')throw new RangeError('Invalid NES channel enable');
    // Route through the public write so applied-register observers also see the
    // gate change. Keep a finished DMC sample off when another channel changes.
    const state=this.snapshot(),mask=state.getUint32(this.offsets[20],true),active=!!(mask&16)&&state.getUint32(this.offsets[7],true)>0;
    const current=channel===4?mask:(mask&15)|(active?16:0);
    this.writeRegister(0x4015,enabled?current|(1<<channel):current&~(1<<channel));
  }
  loadMemory(bytes,address=0xc000){
    this.check();if(!(bytes instanceof Uint8Array)||!Number.isInteger(address)||address<0||address+bytes.length>65536)throw new RangeError('Invalid NES RAM block');
    if(!bytes.length)return;
    // The full 64 KiB staging area is allocated before the first render.
    this.module.HEAPU8.set(bytes,this.uploadPtr);if(!this.api.load(this.handle,this.uploadPtr,address,bytes.length))throw new Error('NES RAM upload failed');
  }
  readMemory(address){this.check();if(!Number.isInteger(address)||address<0||address>65535)throw new RangeError('Invalid NES RAM address');return this.api.read(this.handle,address);}
  reset(){this.check();this.api.reset(this.handle);}
  sampleRate(){this.check();return this.rate;}
  setChannelMuted(channel,muted){
    this.check();if(!Number.isInteger(channel)||channel<0||channel>=(this.fdsEnabled?6:5))throw new RangeError('Invalid NES APU channel');
    this.muteMask=muted?this.muteMask|(1<<channel):this.muteMask&~(1<<channel);this.api.mute(this.handle,this.muteMask);
  }
  reserveStereoFrames(frames){
    this.check();frameCount(frames);if(frames>this.capacity){
      const capacity=Math.max(128,frames),ptr=this.module._malloc(capacity*8);if(!ptr)throw new Error('NES PCM allocation failed');
      if(this.ptr)this.module._free(this.ptr);this.ptr=ptr;this.capacity=capacity;this.buffer=null;
    }
    this.refreshViews();for(let count=0;count<=Math.min(128,this.capacity);count++)this.pcmView(count);
  }
  pcmView(frames){
    this.refreshViews();let view=this.views.get(frames);if(!view){
      view={left:new Float32Array(this.buffer,this.ptr,frames),right:new Float32Array(this.buffer,this.ptr+this.capacity*4,frames)};
      if(this.views.size>=256)for(const key of this.views.keys())if(key>128){this.views.delete(key);break;}
      this.views.set(frames,view);
    }return view;
  }
  /** Scratch PCM remains valid until another generation, resize or disposal. */
  generateStereoView(frames){
    this.check();frameCount(frames);if(frames>this.capacity)this.reserveStereoFrames(frames);const pcm=this.pcmView(frames);
    this.api.generate(this.handle,this.ptr,this.ptr+this.capacity*4,frames);return pcm;
  }
  /** Returned copies survive later generation, buffer growth and disposal. */
  generateStereo(frames){const pcm=this.generateStereoView(frames);return {left:pcm.left.slice(),right:pcm.right.slice()};}
  dispose(){
    if(this.ptr)this.module._free(this.ptr);if(this.uploadPtr)this.module._free(this.uploadPtr);if(this.statePtr)this.module._free(this.statePtr);
    if(this.handle)this.api.destroy(this.handle);this.ptr=this.uploadPtr=this.statePtr=this.handle=this.capacity=this.uploadCapacity=0;this.views.clear();this.buffer=null;
  }
}
