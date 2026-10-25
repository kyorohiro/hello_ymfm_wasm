/** Compare two real OKIM6258 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Oki6258AudioEngine} from '../web/okim6258audioengine.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_okim6258_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[4000000,8192000,24000000],flags=[4,5,6,7,12,13,14,15],rates=[8000,44100,96000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const checkpointFrame=2345,totalFrames=6144;
const requiredExports=['okim6258_create','okim6258_destroy','okim6258_reset','okim6258_write','okim6258_generate','okim6258_save_state','okim6258_load_state','malloc','free'];

function argumentsFor(argv){
  const values={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--help'){assert.equal(argv.length,1,'--help cannot be combined with other arguments');return null;}
    const equal=arg.indexOf('='),name=equal<0?arg:arg.slice(0,equal);
    assert(['--legacy-dir','--sdk-dir','--out'].includes(name),`Unknown argument: ${arg}\n${usage}`);
    assert(!Object.hasOwn(values,name),`Duplicate argument: ${name}`);
    const value=equal<0?argv[++i]:arg.slice(equal+1);
    assert(value&&!value.startsWith('--'),`${name} needs a value`);
    values[name]=resolve(value);
  }
  assert(values['--legacy-dir']&&values['--sdk-dir'],usage);
  assert.notEqual(values['--legacy-dir'],values['--sdk-dir'],'Use two distinct build directories');
  if(values['--out'])for(const dir of [values['--legacy-dir'],values['--sdk-dir']]){
    assert(!['okim6258_wasm.js','okim6258_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'okim6258_wasm.js'),wasm=resolve(directory,'okim6258_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  const create=(settings,kind)=>createActor(module,settings,kind);
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='okim6258');assert(artifact,'OKIM6258 build receipt entry');
    for(const [name,record] of [['okim6258_wasm.js',metadata.javascript],['okim6258_wasm.wasm',metadata.wasm]]){
      const output=artifact.outputs?.find(o=>o.path===name);assert(output,`Missing build receipt output: ${name}`);
      assert.equal(output.sha256,record.sha256,`Build receipt ${name} SHA`);assert.equal(output.size,record.bytes,`Build receipt ${name} size`);
    }
    metadata.buildInfo={...await inputFile(buildInfoPath),artifact};
  }
  return {directory,module,create,metadata};
}
function sameBytes(actual,expected,label){
  const a=ArrayBuffer.isView(actual)?Buffer.from(actual.buffer,actual.byteOffset,actual.byteLength):Buffer.from(actual);
  const b=ArrayBuffer.isView(expected)?Buffer.from(expected.buffer,expected.byteOffset,expected.byteLength):Buffer.from(expected);
  assert.equal(a.length,b.length,`${label}: byte length`);
  assert.equal(a.compare(b),0,`${label}: byte content differs`);
}
function nativeSave(chip){
  const module=chip.module,size=module._okim6258_save_state(chip.handle,0);
  assert(Number.isInteger(size)&&size>0&&size<1048576,'Valid bounded serialized state size');
  const ptr=module._malloc(size);assert(ptr);
  try{assert.equal(module._okim6258_save_state(chip.handle,ptr),size);return new Uint8Array(module.HEAPF32.buffer,ptr,size).slice();}
  finally{module._free(ptr);}
}
function nativeLoad(chip,bytes,size=bytes.length){
  const module=chip.module,ptr=module._malloc(Math.max(1,bytes.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,bytes.length).set(bytes);return module._okim6258_load_state(chip.handle,ptr,size);}
  finally{module._free(ptr);}
}
// Harness-only C ABI owner. It deliberately adds no public chip/read/status API.
class RawOki {
  constructor(module,{clock,flags,rate}){this.module=module;this.rate=rate;this.raw=true;this.ptr=0;this.capacity=0;this.handle=module._okim6258_create(clock,flags,rate);assert(this.handle);}
  write(r,v){return this.module._okim6258_write(this.handle,r,v);}
  reset(){this.module._okim6258_reset(this.handle);}
  processFrames(n){
    assert(Number.isInteger(n)&&n>=0&&n<=0x1000000);
    if(n>this.capacity){if(this.ptr)this.module._free(this.ptr);this.ptr=this.module._malloc(n*8);assert(this.ptr);this.capacity=n;}
    const right=this.ptr+this.capacity*4;this.module._okim6258_generate(this.handle,this.ptr,right,n);
    return {left:this.module.HEAPF32.slice(this.ptr/4,this.ptr/4+n),right:this.module.HEAPF32.slice(right/4,right/4+n)};
  }
  dispose(){if(this.ptr)this.module._free(this.ptr);if(this.handle)this.module._okim6258_destroy(this.handle);this.ptr=this.handle=this.capacity=0;}
}
function decodeState(bytes){
  // Exact field encoding from the unchanged Oki6258::state and ChipStateIO.
  // This is an in-process WASM-build format, not a portable interchange format.
  assert.equal(bytes.length,73);const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0;
  const read=(method,size)=>{const v=view[method](offset,true);offset+=size;return v;};
  const u32=()=>read('getUint32',4),i32=()=>read('getInt32',4),u8=()=>read('getUint8',1);
  const state={initialClock:u32(),clock:u32(),clockBuffer:u32(),rate:u32(),initialFlags:u8(),data:u8(),shift:u8(),pan:u8(),divider:i32(),outputBits:i32(),signal:i32(),step:i32(),playing:Boolean(u8()),phase:read('getFloat64',8),last:read('getFloat32',4)};
  state.fifo=Array.from(bytes.subarray(offset,offset+8));offset+=8;
  Object.assign(state,{fifoHead:i32(),fifoTail:i32(),fifoCount:i32(),nibblesLeft:i32()});assert.equal(offset,bytes.length);return state;
}
const writeActor=(actor,r,v)=>{const result=actor.raw?actor.write(r,v):actor.writeOki6258(r,v);assert(!result?.then,'Register writes are synchronous');};
async function createActor(module,settings,kind){
  const actor=kind==='raw'?new RawOki(module,settings):await Oki6258AudioEngine.create({moduleFactory:()=>module,clock:settings.clock,flags:settings.flags,outputSampleRate:settings.rate,masterVolume:1});
  // reset() intentionally retains inactive FIFO storage. Normalize only those
  // otherwise uninitialized bytes through actual writes, before the timeline.
  const before=decodeState(nativeSave(actor));
  assert.equal(before.initialClock,settings.clock);assert.equal(before.clock,settings.clock);assert.equal(before.rate,settings.rate);assert.equal(before.initialFlags,settings.flags);assert.equal(before.divider,[1024,768,512,512][settings.flags&3]);assert.equal(before.outputBits,settings.flags&8?12:10);
  for(const key of ['fifoHead','fifoTail','fifoCount','nibblesLeft','phase','last'])assert.equal(before[key],0,`Constructor ${key}`);assert.equal(before.playing,false);
  for(let i=0;i<8;i++)writeActor(actor,1,0);actor.reset();const after=decodeState(nativeSave(actor));
  const active=state=>Object.fromEntries(Object.entries(state).filter(([key])=>key!=='fifo'));
  assert.deepEqual(active(after),active(before),'FIFO priming/reset does not change active constructor state');assert(after.fifo.every(v=>v===0));
  return actor;
}
const hostSettings=actor=>actor.raw?null:{volume:actor.volume,muted:actor.muted};
function restoreHost(actor,saved){if(!actor.raw){actor.setMasterVolume(saved.volume);actor.setOkiMuted(saved.muted);}}
const inputBytes=Uint8Array.from({length:257},(_,i)=>((i*73)^((i>>2)*19)^0x97)&255);
function scenarios(){
  const out=[];
  function scenario(name,build,{engine=false,allowSilent=false,engineOnly=false}={}){
    let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v)=>add('write',r,v);
    const bytes=(values=inputBytes.subarray(0,8))=>{for(const value of values)write(1,value);};
    const clock=value=>{for(let i=0;i<4;i++)write(8+i,(value>>>(i*8))&255);};
    const stream=(start=17,end=5500,step=17)=>{for(let f=start;f<end;f+=step){frame=f;bytes(inputBytes.subarray(f%249,f%249+4));}};
    build({add,write,bytes,clock,stream,at:value=>{assert(Number.isInteger(value)&&value>=0&&value<totalFrames);frame=value;}});
    events.sort((a,b)=>a.frame-b.frame);assert(!events.some(e=>e.frame===checkpointFrame));out.push({name,events,engine,allowSilent,engineOnly,frames:totalFrames});
  }
  scenario('stream/all-nibbles/low-high/fractional-output-phase',({write,bytes,stream})=>{write(0,2);bytes();stream();},{engine:true});
  scenario('control/prequeued-start/playing-rewrite/stop/restart-priority',({write,bytes,stream,at})=>{bytes();write(0,2);bytes();stream();for(const [f,value] of [[701,2],[1703,1],[2101,2],[2801,3],[3901,0],[4501,2],[5101,0xff],[5501,2]]){at(f);write(0,value);bytes();}});
  scenario('FIFO/overflow-drop-new/underflow-hold/later-refill',({write,bytes,at})=>{write(0,2);for(let i=0;i<64;i++)write(1,inputBytes[i]);at(1703);bytes(inputBytes.subarray(81,89));at(2801);bytes(inputBytes.subarray(121,129));at(3901);bytes(inputBytes.subarray(171,179));});
  scenario('FIFO/partial-consumption/queue-wrap/late-write',({write,bytes,stream,at})=>{write(0,2);bytes();stream(101,5500,29);at(2309);bytes(inputBytes.subarray(211,219));at(2801);write(1,0x17);});
  scenario('pan/four-gates/high-bits-masked',({write,bytes,stream,at})=>{write(0,2);bytes();stream();for(let i=0;i<8;i++){at(101+i*701);write(2,i);}});
  scenario('clock/pending-byte-latch/commit-register11',({write,bytes,stream,at})=>{write(0,2);bytes();stream();at(701);write(8,1);at(1703);write(9,0x7d);at(2309);write(10,0xf4);at(2801);write(11,0);at(3901);write(8,0x80);write(9,0xbb);at(5101);write(11,0xc0);},{engine:true});
  scenario('divider/all-codes/upper-bits/phase-preserved',({write,bytes,stream,at})=>{write(0,2);bytes();stream();for(let i=0;i<8;i++){at(101+i*701);write(12,i);}} ,{engine:true});
  scenario('clock/zero-hold/full-commit/top2-bit-mask',({write,bytes,clock,stream,at})=>{write(0,2);bytes();stream();at(701);clock(0);at(1703);clock(8192000);at(2801);clock(0x40000000|16384000);at(3901);clock(0);at(5101);clock(4000000);});
  scenario('reset/clock-divider-pan-FIFO/predictor/reprogram',({add,write,bytes,clock,stream,at})=>{write(0,2);bytes();stream();at(701);clock(16000000);write(12,2);write(2,1);at(1703);add('reset');at(2101);write(0,2);bytes();at(2801);write(2,2);at(3901);add('reset');at(5101);write(0,2);bytes();},{engine:true});
  scenario('register/byte-truncation/ignored-addresses',({write,bytes,stream,at})=>{write(0,2);bytes();stream();at(701);write(0x101,0x1ff);at(1703);for(const r of [3,4,5,6,7,13,15,127,255])write(r,0xff);at(2801);write(0x102,0x100);at(3901);write(0x10c,0x102);at(5101);write(0x100,0x102);bytes();});
  scenario('clock/divider/bounds/fast-multiple-nibbles/slow-holds',({write,bytes,clock,stream,at})=>{write(0,2);bytes();stream();for(const [f,value] of [[701,100000],[1703,100000000],[2801,100001],[3901,24000000],[5101,8192000]]){at(f);clock(value);write(12,f%4);}});
  scenario('reset/stopped-zero-output/queued-input-discard',({add,write,bytes,at})=>{bytes();at(701);add('reset');at(1703);bytes();at(2801);write(0,1);at(3901);write(2,3);at(5101);add('reset');},{allowSilent:true});
  scenario('engine/mute/master-volume/clamping/predictor-retained',({add,write,bytes,stream,at})=>{write(0,2);bytes();stream();for(const [f,op,value] of [[701,'mute',true],[1703,'mute',false],[2101,'volume',.5],[2801,'volume',2],[3901,'volume',99],[4501,'volume',-1],[5101,'volume',1]]){at(f);add(op,value);}},{engine:true,engineOnly:true});
  return out;
}
function observation(actor,frame){const bytes=nativeSave(actor);return {frame,stateSha256:sha256(bytes),host:hostSettings(actor)};}
function execute(actor,scenario,layout,{start=0,saveCheckpoint=false}={}){
  const left=new Float32Array(scenario.frames-start),right=new Float32Array(scenario.frames-start),observations=[],writes=[];
  let frame=start,index=0,next=0,saved;while(next<scenario.events.length&&scenario.events[next].frame<start)next++;
  const initialObservation=observation(actor,start);
  while(frame<scenario.frames){
    while(next<scenario.events.length&&scenario.events[next].frame===frame){const {op,args}=scenario.events[next++];
      if(op==='write'){writeActor(actor,...args);writes.push({frame,register:args[0],data:args[1]});}
      else if(op==='reset')actor.reset();else if(op==='mute')actor.setOkiMuted(args[0]);else if(op==='volume')actor.setMasterVolume(args[0]);else throw Error(op);
    }
    if(saveCheckpoint&&frame===checkpointFrame){const bytes=nativeSave(actor),opaque=actor.raw?null:actor.saveState();if(opaque)assert.equal(opaque.byteLength,bytes.length);saved={bytes,opaque,host:hostSettings(actor)};}
    let end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity);if(saveCheckpoint&&frame<checkpointFrame)end=Math.min(end,checkpointFrame);const count=end-frame;assert(count>0);
    const pcm=actor.processFrames(count);assert(!pcm?.then);left.set(pcm.left,frame-start);right.set(pcm.right,frame-start);frame=end;observations.push(observation(actor,frame));
  }
  for(const values of [left,right])for(const value of values)assert(Number.isFinite(value));return {left,right,initialObservation,observations,writes,saved,endState:nativeSave(actor),endHost:hostSettings(actor)};
}
function compareResult(actual,expected,label,{offset=0,observations=true}={}){
  for(const name of ['left','right'])sameBytes(actual[name],expected[name].subarray(offset),`${label}/${name}`);sameBytes(actual.endState,expected.endState,`${label}/end-state`);assert.deepEqual(actual.endHost,expected.endHost,`${label}/host-settings`);
  if(observations){assert.deepEqual(actual.initialObservation,expected.initialObservation,`${label}/initial-state`);assert.deepEqual(actual.observations,expected.observations,`${label}/state-observations`);assert.deepEqual(actual.writes,expected.writes,`${label}/synchronous-writes`);}
}
function compareContinuation(actual,expected,label){
  compareResult(actual,expected,label,{offset:checkpointFrame,observations:false});assert.deepEqual(actual.initialObservation,expected.observations.find(o=>o.frame===checkpointFrame),`${label}/immediate-restore`);assert.deepEqual(actual.observations,expected.observations.filter(o=>o.frame>checkpointFrame),`${label}/continued-state`);assert.deepEqual(actual.writes,expected.writes.filter(o=>o.frame>=checkpointFrame),`${label}/continued-writes`);
}
function pcmDigest(result){const hash=createHash('sha256');for(const array of [result.left,result.right])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');}
function expectedAdpcm(bytes,bits){
  let signal=-2,step=0;const values=[],adjust=[-1,-1,-1,-1,2,4,6,8];
  for(const byte of bytes)for(const nibble of [byte&15,byte>>4]){
    const size=Math.floor(16*Math.pow(1.1,step));let delta=Math.floor(size/8);if(nibble&1)delta+=Math.floor(size/4);if(nibble&2)delta+=Math.floor(size/2);if(nibble&4)delta+=size;
    signal=Math.max(-(2**(bits-1)),Math.min(2**(bits-1)-1,signal+(nibble&8?-delta:delta)));step=Math.max(0,Math.min(48,step+adjust[nibble&7]));values.push(signal/2048);
  }return Float32Array.from(values);
}
async function wrapperChecks(backend){
  const settings={clock:8192000,flags:12,rate:8000},raw=await backend.create(settings,'raw'),engine=await backend.create(settings,'engine');
  const actors=[raw,engine];let frames=0;
  const render=(actor,n)=>{frames+=n;return actor.processFrames(n);};
  const fresh=(settings,kind='raw')=>backend.create(settings,kind).then(actor=>{actors.push(actor);return actor;});
  const play=(actor,bytes)=>{writeActor(actor,0,2);for(const value of bytes)writeActor(actor,1,value);};
  try{
    const initial=nativeSave(raw);assert.equal(initial.length,73);sameBytes(nativeSave(engine),initial,'Raw C ABI and public Engine initial state');
    for(const [clock,flags,rate] of [[0,4,8000],[8192000,0,8000],[8192000,8,8000],[8192000,4,0]])assert.equal(backend.module._okim6258_create(clock,flags,rate),0,'Unsupported raw creation rejected');
    for(const options of [{clock:8192000,flags:0},{clock:0x40000001,flags:4},{clock:0,flags:4},{clock:8192000,flags:4,outputSampleRate:7999}])await assert.rejects(Oki6258AudioEngine.create({moduleFactory:()=>backend.module,outputSampleRate:8000,...options}));
    assert.equal(typeof engine.read,'undefined');assert.equal(typeof engine.readStatus,'undefined');assert.equal(typeof engine.getIrq,'undefined');
    const opaque=engine.saveState();assert.throws(()=>engine.loadState({byteLength:73,key:opaque.key}),/foreign/);
    const foreign=await fresh(settings,'engine');assert.throws(()=>foreign.loadState(opaque),/foreign/);
    engine.processFrames(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>engine.processFrames(n),RangeError);
    assert.equal(backend.module._okim6258_load_state(raw.handle,0,73),0);assert.equal(nativeLoad(raw,initial,72),0);assert.equal(nativeLoad(raw,new Uint8Array(74)),0);sameBytes(nativeSave(raw),initial,'Invalid native state sizes rejected before mutation');sameBytes(nativeSave(engine),initial,'Public zero/invalid frames observational');
    const unprimed=new RawOki(backend.module,settings);actors.push(unprimed);
    for(const actor of [unprimed,raw]){const silence=render(actor,4);assert(silence.left.every(v=>v===0));play(actor,[0x10]);}
    const unprimedPcm=render(unprimed,4),primedPcm=render(raw,4);sameBytes(primedPcm.left,unprimedPcm.left,'Inactive FIFO priming does not alter audible constructor behavior');assert.deepEqual([...primedPcm.left],[0,6/2048,6/2048,6/2048]);
    assert.equal(nativeLoad(raw,initial),1);play(raw,[0x10,0x87]);assert.equal(render(raw,1).left[0],0);const partial=nativeSave(raw),partialFields=decodeState(partial);
    assert.equal(partialFields.nibblesLeft,1);assert.equal(partialFields.shift,4);assert.equal(partialFields.fifoCount,1);
    const tail=render(raw,3);assert.deepEqual([...tail.left],[6/2048,36/2048,32/2048]);assert.equal(nativeLoad(raw,partial),1);sameBytes(render(raw,3).left,tail.left,'Partly consumed byte and queued next byte restore');const held=render(raw,8);assert(held.left.every(v=>v===32/2048),'Underrun holds last decoded output without replaying stale nibbles');
    assert.equal(nativeLoad(raw,initial),1);play(raw,inputBytes.subarray(0,8));const full=nativeSave(raw);assert.equal(decodeState(full).fifoCount,8);
    for(const value of inputBytes.subarray(8,24))writeActor(raw,1,value);sameBytes(nativeSave(raw),full,'FIFO overflow drops new data without overwriting eight queued bytes');
    const decoded=render(raw,16);sameBytes(decoded.left,expectedAdpcm(inputBytes.subarray(0,8),12),'Independent low-first ADPCM reference for complete FIFO');assert.equal(decodeState(nativeSave(raw)).fifoCount,0);assert.equal(decodeState(nativeSave(raw)).nibblesLeft,0);
    assert.equal(nativeLoad(raw,initial),1);play(raw,inputBytes.subarray(0,8));render(raw,6);for(const value of inputBytes.subarray(8,11))writeActor(raw,1,value);
    const wrapped=decodeState(nativeSave(raw));assert.equal(wrapped.fifoCount,8);assert.equal(wrapped.fifoHead,3);assert.equal(wrapped.fifoTail,3);
    const wrappedPcm=render(raw,16);sameBytes(wrappedPcm.left,expectedAdpcm(inputBytes.subarray(0,11),12).subarray(6),'FIFO wrap retains predictor and queued byte ordering');
    const fractional=await fresh({...settings,clock:4000000});play(fractional,inputBytes.subarray(0,8));render(fractional,1);const fractionalPhase=decodeState(nativeSave(fractional)).phase;assert(fractionalPhase>0&&fractionalPhase<1);
    writeActor(fractional,12,1);for(let i=0;i<4;i++)writeActor(fractional,8+i,(8192000>>>(i*8))&255);assert.equal(decodeState(nativeSave(fractional)).phase,fractionalPhase,'Divider and committed clock preserve fractional nibble phase');render(fractional,2);
    const divider=[];for(let code=0;code<4;code++){
      assert.equal(nativeLoad(raw,initial),1);play(raw,inputBytes.subarray(0,8));writeActor(raw,12,code|0xfc);const pcm=render(raw,12),state=decodeState(nativeSave(raw));assert.equal(state.divider,[1024,768,512,512][code]);divider.push({code,pcmSha256:pcmDigest(pcm),fifoCount:state.fifoCount,nibblesLeft:state.nibblesLeft});
    }
    assert.equal(new Set(divider.slice(0,3).map(d=>d.pcmSha256)).size,3,'Three divider speeds produce distinct PCM');assert.equal(divider[2].pcmSha256,divider[3].pcmSha256,'Divider code3 aliases512');
    assert.equal(nativeLoad(raw,initial),1);play(raw,[0x10,0x87]);const beforeClock=decodeState(nativeSave(raw));
    for(let i=0;i<3;i++)writeActor(raw,8+i,(16384000>>>(i*8))&255);const pending=decodeState(nativeSave(raw));assert.equal(pending.clock,8192000);assert.equal(pending.clockBuffer,16384000);assert.equal(pending.phase,beforeClock.phase);assert.equal(render(raw,1).left[0],0,'Clock lower bytes remain pending');
    assert.equal(nativeLoad(raw,initial),1);play(raw,[0x10,0x87]);for(let i=0;i<4;i++)writeActor(raw,8+i,((0xc0000000|16384000)>>>(i*8))&255);const committed=decodeState(nativeSave(raw));assert.equal(committed.clock,16384000);assert.equal(committed.clockBuffer,(0xc0000000|16384000)>>>0);assert.equal(render(raw,1).left[0],6/2048,'Committed double clock consumes two nibbles per output frame');
    const clamp=[];for(const bits of [10,12]){
      const actor=await fresh({...settings,flags:bits===12?12:4});play(actor,[]);let last;
      for(let i=0;i<60;i++){writeActor(actor,1,0x77);last=render(actor,2).left[1];}
      assert.equal(last,(2**(bits-1)-1)/2048);clamp.push({bits,positiveClamp:last});
      actor.reset();play(actor,[]);for(let i=0;i<60;i++){writeActor(actor,1,0xff);last=render(actor,2).left[1];}assert.equal(last,-(2**(bits-1))/2048);clamp.at(-1).negativeClamp=last;
    }
    assert.equal(nativeLoad(raw,partial),1);const playing=nativeSave(raw);writeActor(raw,0,2);sameBytes(nativeSave(raw),playing,'Play command while already playing does not reset predictor/FIFO');
    writeActor(raw,0,3);const stopped=decodeState(nativeSave(raw));assert.equal(stopped.playing,false);assert.equal(stopped.last,0);render(raw,4);const stoppedAfter=decodeState(nativeSave(raw));assert.equal(stoppedAfter.fifoCount,stopped.fifoCount);assert.equal(stoppedAfter.nibblesLeft,stopped.nibblesLeft);assert.equal(stoppedAfter.signal,stopped.signal);
    writeActor(raw,0,2);const restarted=decodeState(nativeSave(raw));assert.equal(restarted.playing,true);assert.equal(restarted.signal,-2);assert.equal(restarted.step,0);assert.equal(restarted.fifoCount,0);assert.equal(restarted.nibblesLeft,0);assert.equal(restarted.phase,stoppedAfter.phase);
    assert.equal(nativeLoad(raw,partial),1);writeActor(raw,2,1);writeActor(raw,12,2);for(let i=0;i<4;i++)writeActor(raw,8+i,(16384000>>>(i*8))&255);render(raw,3);const beforeReset=decodeState(nativeSave(raw));raw.reset();const reset=decodeState(nativeSave(raw));
    assert.deepEqual(reset.fifo,beforeReset.fifo,'Reset retains inactive FIFO storage');for(const key of Object.keys(reset).filter(k=>k!=='fifo'))assert.deepEqual(reset[key],decodeState(initial)[key],`Reset restores constructor active field ${key}`);
    assert.equal(nativeLoad(raw,partial),1);render(raw,3);const voiced=nativeSave(raw),pan=[];
    for(let value=0;value<8;value++){assert.equal(nativeLoad(raw,voiced),1);writeActor(raw,2,value);const pcm=render(raw,3);assert.equal(pcm.left.some(v=>v!==0),!(value&2));assert.equal(pcm.right.some(v=>v!==0),!(value&1));pan.push({value,pcmSha256:pcmDigest(pcm)});}
    for(let i=0;i<4;i++)assert.equal(pan[i].pcmSha256,pan[i+4].pcmSha256,'Pan ignores high bits');
    assert.equal(nativeLoad(engine,partial),1);const publicState=engine.saveState();engine.setMasterVolume(2);assert.throws(()=>engine.loadState(publicState),/foreign/);engine.setMasterVolume(1);engine.setOkiMuted(true);assert.throws(()=>engine.loadState(publicState),/foreign/);engine.setOkiMuted(false);engine.loadState(publicState);
    const reference=render(engine,12),referenceState=nativeSave(engine);for(const gain of [0,.5,2,3.8]){engine.loadState(publicState);engine.setMasterVolume(gain);const pcm=render(engine,12);sameBytes(pcm.left,Float32Array.from(reference.left,v=>v*gain),'Engine master gain applied once');sameBytes(nativeSave(engine),referenceState,'Master gain does not affect decoder state');engine.setMasterVolume(1);}
    engine.loadState(publicState);engine.setOkiMuted(true);const muted=render(engine,12);assert(muted.left.every(v=>v===0)&&muted.right.every(v=>v===0));sameBytes(nativeSave(engine),referenceState,'Engine mute advances decoder normally');engine.setOkiMuted(false);
    engine.setMasterVolume(99);assert.equal(engine.getMasterVolume(),3.8);engine.setMasterVolume(-1);assert.equal(engine.getMasterVolume(),0);engine.setMasterVolume(1);for(const value of [NaN,Infinity,'bad'])assert.throws(()=>engine.setMasterVolume(value),RangeError);
    engine.loadState(publicState);const owned=render(engine,17),heldCopy=owned.left.slice();assert(heldCopy.some(v=>v!==0));writeActor(engine,1,0xff);render(engine,17);sameBytes(owned.left,heldCopy,'Public owned PCM survives same-buffer overwrite');const capacity=engine.capacity;render(engine,capacity+1);assert(engine.capacity>capacity);sameBytes(owned.left,heldCopy,'Public owned PCM survives native buffer growth');
    return {passed:true,stateBytes:73,rawAndEngineInitialStateEqual:true,primingPreservesActiveStateAndPcm:true,lowThenHighNibbleVector:[0,6/2048,36/2048,32/2048],partialByteAndQueueRestore:true,underflowHoldsLast:true,fifoEightBytesOverflowDropsNew:true,fifoWrapOrderingAndPredictor:true,fractionalPhasePreservedOnClockDividerEdits:true,independentDecoderReferencePcmSha256:pcmDigest(decoded),divider,clockPendingAndCommit:true,clockHighBitsMasked:true,clamp,playWhilePlayingPreservesState:true,stopPrecedenceAndRestartPredictor:true,resetActiveStateAndInactiveStorage:true,pan,engineGainAndMuteLeaveDecoderUnchanged:true,opaqueSettingsAndForeignOwnerGuards:true,ownedPcmSurvivesOverwriteAndGrowth:true,noReadStatusIrqApi:true,totalOutputStereoFrames:frames,
      frameCountScope:'All C ABI and public Engine output frames rendered by bounded positive self-checks, excluding zero-frame calls and setup writes.'};
  }finally{for(const actor of actors){actor.dispose();actor.dispose();}}
}
async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');
  const wrappers=['web/okim6258audioengine.js','docs/js/okim6258audioengine.js'];
  const normalized=bytes=>bytes.toString().replace(/(\.\/soundchip\.js)\?v=[^"'\s)]+/g,'$1');sameBytes(normalized(await readFile(resolve(root,wrappers[0]))),normalized(await readFile(resolve(root,wrappers[1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,flags,rates,layouts,checkpointFrame,
    method:'Actual generated JS/WASM, direct exported C ABI and unchanged public Oki6258AudioEngine. Exact output PCM, synchronous write trace, every serialized state byte and public host mute/volume settings; no tolerance, mock, read/status API or device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),stateLayoutSources:await Promise.all(['third_party/mame-okim6258/okim6258.h','third_party/mame-okim6258/okim6258.cpp','src/chip_state.h'].map(p=>inputFile(resolve(root,p))))},
    wrapperSync:'Byte-identical after removing only deployed soundchip.js import cache suffixes; actual hashes retained.',
    setup:'Both builds and both API paths receive eight register1 zero writes followed by the actual reset API before each timeline. This only canonicalizes otherwise uninitialized inactive FIFO storage. Active constructor state and audible output are independently checked unchanged; reset is not claimed to clear stored FIFO bytes.',
    syntheticInput:{bytes:inputBytes.length,sha256:sha256(inputBytes)},wrapperChecks:{},cases:[],totalOutputStereoFrames:0,ownStateLoads:0,ownRawStateLoads:0,ownPublicStateLoads:0,crossStateLoads:0,resetContinuations:0,preRestorePerturbationOutputStereoFrames:0,maximumDifference:0,
    limits:['Raw C ABI and AudioEngine both directly generate at the configured output rate. Clock/divider changes alter nibble consumption; the native fractional phase and FIFO continue across chunk boundaries.',
      'Only supported 4-bit ADPCM is compared. Flags select all divider codes and 10/12-bit output widths. Unsupported 3-bit creation is rejected; no new read/status/IRQ API is introduced.',
      'States are same-build in-process field bytes. Raw bidirectional restore remains within identical constructor clock/flags/output-rate settings; opaque snapshots remain same-owner and require unchanged JS rate/volume/mute settings.',
      'Both layouts save selected checkpoints; continuations replay only the regular layout. State observations occur at chunk boundaries and do not mutate playback.',
      'No Worklet scheduling, browser, Native backend, attached multi-chip mixing, physical device or listening judgement is tested.']};
  report.wrapperChecks.legacy=await wrapperChecks(legacy);report.wrapperChecks.sdk=await wrapperChecks(sdk);assert.deepEqual(report.wrapperChecks.sdk,report.wrapperChecks.legacy);
  report.totalWrapperSelfCheckOutputStereoFrames=report.wrapperChecks.legacy.totalOutputStereoFrames+report.wrapperChecks.sdk.totalOutputStereoFrames;
  const jobs=[],scenes=scenarios();
  for(const clock of clocks)for(const flag of flags)for(const rate of rates)for(const scene of scenes.filter(s=>!s.engineOnly))jobs.push({...scene,kind:'raw',settings:{clock,flags:flag,rate},checkpoint:clock===8192000&&rate===44100&&[4,12].includes(flag)});
  for(const flag of flags)for(const rate of [8000,44100,48000,96000])for(const scene of scenes.filter(s=>s.engine))jobs.push({...scene,kind:'engine',settings:{clock:8192000,flags:flag,rate},checkpoint:rate===48000&&[4,12].includes(flag),frames:3072,events:scene.events.filter(e=>e.frame<3072)});
  for(const scenario of jobs){
    let regular;
    for(const [layoutName,layout] of Object.entries(layouts)){
      const a=await legacy.create(scenario.settings,scenario.kind),b=await sdk.create(scenario.settings,scenario.kind),label=`${scenario.kind}/${scenario.name}/${JSON.stringify(scenario.settings)}/${layoutName}`;
      try{
        const x=execute(a,scenario,layout,{saveCheckpoint:scenario.checkpoint}),y=execute(b,scenario,layout,{saveCheckpoint:scenario.checkpoint});compareResult(y,x,label);if(scenario.checkpoint)sameBytes(y.saved.bytes,x.saved.bytes,'Checkpoint state bytes compatible');
        if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        let peak=0;for(const array of [x.left,x.right])for(const value of array)peak=Math.max(peak,Math.abs(value));if(scenario.allowSilent)assert.equal(peak,0,`${label}: intentional stopped state is silent`);else assert(peak>1e-5,`${label}: reference must actually sound`);
        if(layoutName==='regular'&&scenario.checkpoint){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){
            actor.reset();writeActor(actor,0,2);writeActor(actor,1,0xff);actor.processFrames(31);report.preRestorePerturbationOutputStereoFrames+=31;
            restoreHost(actor,result.saved.host);if(actor.raw){assert.equal(nativeLoad(actor,result.saved.bytes),1);report.ownRawStateLoads++;}else{actor.loadState(result.saved.opaque);report.ownPublicStateLoads++;}
            const restored=execute(actor,scenario,layout,{start:checkpointFrame});compareContinuation(restored,result,`${name}/same-owner-state`);report.ownStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          if(!a.raw){assert.throws(()=>a.loadState(y.saved.opaque),/foreign/);assert.throws(()=>b.loadState(x.saved.opaque),/foreign/);}
          for(const [actor,saved,result,name] of [[a,y.saved,x,'sdk-to-legacy'],[b,x.saved,y,'legacy-to-sdk']]){
            actor.reset();restoreHost(actor,saved.host);assert.equal(nativeLoad(actor,saved.bytes),1);const restored=execute(actor,scenario,layout,{start:checkpointFrame});compareContinuation(restored,result,`${name}/same-settings-raw-state`);report.crossStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          a.reset();b.reset();compareResult(execute(b,scenario,layout),execute(a,scenario,layout),'Reset/reprogram');report.resetContinuations+=2;report.totalOutputStereoFrames+=scenario.frames*2;
        }
        report.cases.push({name:scenario.name,kind:scenario.kind,...scenario.settings,layout:layoutName,frames:scenario.frames,peak,checkpointSaved:scenario.checkpoint,continuationReplayTested:scenario.checkpoint&&layoutName==='regular',pcmSha256:pcmDigest(x),checkpointSha256:x.saved?sha256(x.saved.bytes):null,stateBytes:x.endState.length,endStateSha256:sha256(x.endState),observations:x.observations.length,synchronousWrites:x.writes.length,maximumDifference:0});report.totalOutputStereoFrames+=scenario.frames*2;
      }finally{a.dispose();b.dispose();}
    }
  }
  report.rawScenarioCount=scenes.filter(s=>!s.engineOnly).length;report.engineScenarioCount=scenes.filter(s=>s.engine).length;report.scenarioConfigurations=jobs.length;report.scenarioRenderExecutions=report.cases.length*2+report.ownStateLoads+report.crossStateLoads+report.resetContinuations;
  report.preRestorePerturbationRenderExecutions=report.ownStateLoads;report.totalGeneratedOutputStereoFrames=report.totalOutputStereoFrames+report.totalWrapperSelfCheckOutputStereoFrames+report.preRestorePerturbationOutputStereoFrames;
  report.frameCountScope='Both builds at their configured output rates: complete raw/Engine scenario renders and own/cross/reset continuations. Bounded wrapper self-checks and 31-frame pre-restore perturbations are separately counted; all three contribute to totalGeneratedOutputStereoFrames. Setup writes and zero-frame calls render no frames.';
  report.passed=true;report.completedAt=new Date().toISOString();if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,rawComparisons:report.cases.filter(c=>c.kind==='raw').length,engineComparisons:report.cases.filter(c=>c.kind==='engine').length,totalOutputStereoFrames:report.totalOutputStereoFrames,totalWrapperSelfCheckOutputStereoFrames:report.totalWrapperSelfCheckOutputStereoFrames,preRestorePerturbationOutputStereoFrames:report.preRestorePerturbationOutputStereoFrames,ownStateLoads:report.ownStateLoads,ownRawStateLoads:report.ownRawStateLoads,ownPublicStateLoads:report.ownPublicStateLoads,crossStateLoads:report.crossStateLoads,resetContinuations:report.resetContinuations,maximumDifference:0,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
