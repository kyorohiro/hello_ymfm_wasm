// SPDX-License-Identifier: BSD-3-Clause
import {validateResearchSid} from './parser.js';
import {concatenateRoms} from '../sid-player/roms.js';
const integer=(n,min,max,label)=>{if(!Number.isInteger(n)||n<min||n>max)throw new RangeError(`${label} must be ${min}..${max}`);return n;};
export function profileBits(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Research profiles must be an object');
  const {resonance=false,cutoff=false}=options;
  if(typeof resonance!=='boolean'||typeof cutoff!=='boolean')throw new TypeError('Research profile choices must be booleans');
  return Number(resonance)|(Number(cutoff)<<1);
}
export class Sid8580MachineCore {
  static async create({sampleRate=48000,endpointBinary,machineBinary,profiles={},signal}={}){
    integer(sampleRate,8000,96000,'Sample rate');const bits=profileBits(profiles);signal?.throwIfAborted();
    const fetchBytes=async(name,provided)=>{
      if(provided)return provided;
      const response=await fetch(new URL(`../generated/sid8580-machine/${name}.wasm`,import.meta.url),{signal});
      if(!response.ok)throw new Error(`Research ${name} WASM load failed (${response.status})`);return response.arrayBuffer();
    };
    const [endpointBytes,machineBytes]=await Promise.all([fetchBytes('sid8580-endpoint',endpointBinary),fetchBytes('sid8580-machine',machineBinary)]);
    signal?.throwIfAborted();
    const {instance:endpoint}=await WebAssembly.instantiate(endpointBytes,{}),module=await WebAssembly.compile(machineBytes);
    const imports={env:{emscripten_notify_memory_growth(){}},wasi_snapshot_preview1:{proc_exit(code){throw new Error(`Research machine exited (${code})`);}}};
    const linked=[];
    for(const item of WebAssembly.Module.imports(module)){
      if(item.module==='env'&&item.name.startsWith('sid8e_')){
        if(item.kind!=='function'||typeof endpoint.exports[item.name]!=='function')throw new Error(`Missing research SID function ${item.name}`);
        // Pass the WebAssembly function itself. There is no JavaScript closure
        // in the per-cycle CPU/SID path and no foreign-memory pointer access.
        imports.env[item.name]=endpoint.exports[item.name];linked.push(item.name);
      }else if(item.kind!=='function'||typeof imports[item.module]?.[item.name]!=='function')throw new Error(`Unexpected research import ${item.module}.${item.name}`);
    }
    if(!linked.includes('sid8e_tick'))throw new Error('The research machine is not linked to the actual SID clock');
    const instance=await WebAssembly.instantiate(module,imports);instance.exports._initialize?.();signal?.throwIfAborted();
    return new Sid8580MachineCore(instance.exports,sampleRate,bits,endpoint,linked);
  }
  constructor(api,rate,bits,endpoint,linked){this.api=api;this.sampleRate=rate;this.bits=bits;this.endpoint=endpoint;this.linked=linked;this.handle=0;this.positionFrames=0;this.parsed=null;}
  get exports(){return this.api;}
  assertOpen(){if(!this.api)throw new Error('Research machine is disposed');}
  nativeError(handle){
    const a=this.api,p=a.sid8m_error(handle),memory=new Uint8Array(a.memory.buffer);let end=p;
    while(end<Math.min(p+1024,memory.length)&&memory[end])end++;
    const error=new Error(String.fromCharCode(...memory.subarray(p,end))||'Research C64 execution failed');
    error.code=a.sid8m_error_code(handle);error.address=a.sid8m_error_address(handle);
    if(error.address)error.message+=` (at $${error.address.toString(16).toUpperCase().padStart(4,'0')})`;
    return error;
  }
  load(bytes,options={}){
    this.assertOpen();const parsed=validateResearchSid(bytes,options),a=this.api;
    const roms=parsed.environment==='rom'?concatenateRoms(options.roms):null;
    const candidate=a.sid8m_create(this.sampleRate,this.bits);if(!candidate)throw new Error('Research machine allocation failed');
    try{
      new Uint8Array(a.memory.buffer,a.sid8m_input(candidate),parsed.program.length).set(parsed.program);
      if(roms)new Uint8Array(a.memory.buffer,a.sid8m_rom_input(candidate),roms.length).set(roms);
      const loaded=parsed.format==='PSID'?
        a[parsed.timing==='vbi'?'sid8m_load_psid_vbi':'sid8m_load_psid'](candidate,parsed.program.length,parsed.loadAddress,parsed.initAddress,parsed.playAddress,parsed.subtune-1,Number(!!roms),parsed.driverPage):
        a.sid8m_load(candidate,parsed.program.length,parsed.loadAddress,parsed.initAddress,parsed.subtune-1,Number(parsed.basic),Number(!!roms));
      if(!loaded){
        const error=this.nativeError(candidate);error.nativeState=this.stateFor(candidate,parsed);error.nativeState.positionFrames=0;
        error.sidReads=this.sidReadsFor(candidate);error.trace=this.traceFor(candidate);
        error.ram=Object.fromEntries([...Array.from({length:32},(_,i)=>0x330+i),0x400,0xd419,0xd41a].map(address=>[address,a.sid8m_ram_read(candidate,address)]));
        throw error;
      }
      if(a.sid8m_model(candidate)!==8580||a.sid8m_profiles(candidate)!==this.bits)throw new Error('Research machine target/profile mismatch');
    }catch(error){a.sid8m_destroy(candidate);throw error;}
    if(this.handle)a.sid8m_destroy(this.handle);
    this.handle=candidate;this.parsed=parsed;this.positionFrames=0;return this.getState();
  }
  renderInto(output){
    this.assertOpen();if(!(output instanceof Float32Array))throw new TypeError('Expected Float32Array');
    if(!this.handle){output.fill(0);return output;}
    try{for(let offset=0;offset<output.length;offset+=4096){const n=Math.min(4096,output.length-offset);
      if(!this.api.sid8m_render(this.handle,n))throw this.nativeError(this.handle);
      output.set(new Float32Array(this.api.memory.buffer,this.api.sid8m_output(this.handle),n),offset);
      if(this.api.sid8m_state(this.handle)===1)this.positionFrames+=n;}}
    catch(error){output.fill(0);throw error;}return output;
  }
  render(frames){integer(frames,0,this.sampleRate*600,'Frames');return this.renderInto(new Float32Array(frames));}
  stop(){this.assertOpen();if(this.handle)this.api.sid8m_stop(this.handle);return this.getState();}
  stateFor(h,p=this.parsed){
    const a=this.api,get=name=>h?a[`sid8m_${name}`](h):0,state=get('state'),mask=get('sid_observable_mask');
    return {loaded:!!h,playing:state===1,state,errorCode:get('error_code'),errorAddress:get('error_address'),
      backend:'research-c64',model:h?get('model'):8580,clockHz:985248,sampleRate:this.sampleRate,
      profiles:{resonance:!!(this.bits&1),cutoff:!!(this.bits&2)},profileBits:h?get('profiles'):this.bits,
      declaredModel:p?.model??null,declaredClock:p?.clock??null,selectedModel:'8580',selectedClock:'pal',
      selection:p?.selection??null,format:p?.format??null,timing:p?.timing??null,subtune:p?.subtune??null,environment:p?.environment??'minimal',
      positionFrames:this.positionFrames,cycles:get('cycles'),sidCycles:get('sid_cycles'),bootCycles:get('boot_cycles'),
      initCycles:get('init_cycles'),initReturned:!!get('init_returned'),initPending:!!get('init_pending'),initCycleLimit:get('init_limit'),initReturnCycle:get('init_return_cycle'),
      irqCount:get('irq_count'),nmiCount:get('nmi_count'),playCalls:get('play_calls'),driverAddress:get('driver_address'),
      readCount:get('read_count'),writeCount:get('write_count'),pc:get('pc'),hostDcHz:h?get('host_dc_hz'):12,
      registers:Array.from({length:32},(_,r)=>h?a.sid8m_register(h,r):0),
      voices:Array.from({length:3},()=>({envelope:null,phase:null})),
      lastCpuReads:[27,28].filter((_,i)=>mask&(1<<i)).map(register=>({register,value:a.sid8m_sid_observable_value(h,register),cycle:a.sid8m_sid_observable_cycle(h,register)})),
      bridge:'direct-wasm-function-imports',linkedSidFunctions:[...this.linked],perCycleJavaScriptCallbacks:0};
  }
  getState(){this.assertOpen();return this.stateFor(this.handle);}
  readRam(address){this.assertOpen();integer(address,0,65535,'RAM address');if(!this.handle)throw new Error('No loaded research SID');return this.api.sid8m_ram_read(this.handle,address);}
  traceFor(h){const a=this.api,n=h?a.sid8m_trace_count(h):0,words=h?new Uint32Array(a.memory.buffer,a.sid8m_trace(h),n*4):[];
    return {writes:Array.from({length:n},(_,i)=>({cycle:words[i*4]+words[i*4+1]*2**32,register:words[i*4+2],value:words[i*4+3]})),dropped:h?a.sid8m_dropped_trace(h):0,cycleConvention:'host bus-start; add one for completed SID tick'};}
  readTrace({clear=false}={}){this.assertOpen();const trace=this.traceFor(this.handle);if(clear&&this.handle)this.api.sid8m_clear_trace(this.handle);return trace;}
  sidReadsFor(h){const a=this.api,n=h?a.sid8m_sid_read_trace_count(h):0,words=h?new Uint32Array(a.memory.buffer,a.sid8m_sid_read_trace(h),n*6):[];
    return {reads:Array.from({length:n},(_,i)=>({cycle:words[i*6]+words[i*6+1]*2**32,address:words[i*6+2],register:words[i*6+3],value:words[i*6+4],error:words[i*6+5]})),dropped:h?a.sid8m_sid_read_trace_dropped(h):0,cycleConvention:'completed SID ticks'};}
  readSidReads({clear=false}={}){this.assertOpen();const reads=this.sidReadsFor(this.handle);if(clear&&this.handle)this.api.sid8m_sid_read_trace_clear(this.handle);return reads;}
  dispose(){if(this.api&&this.handle)this.api.sid8m_destroy(this.handle);this.handle=0;this.api=null;this.endpoint=null;}
}
