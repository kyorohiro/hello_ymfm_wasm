/** Compare two real YM2610B WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ym2610B} from '../web/ym2610b.js';
import {Ym2610BAudioEngine} from '../web/ym2610baudioengine.js';
import {opnPitchFromHz} from '../web/soundchip_pitch.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ym2610b_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[3993600,7987200,8000000];
const rateClocks=[100000,3579545,3993600,7670454,8000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const checkpointFrame=2345,totalFrames=6144;
const requiredExports=['ym2610b_create','ym2610b_destroy','ym2610b_reset','ym2610b_write',
  'ym2610b_read','ym2610b_read_status','ym2610b_read_status_hi','ym2610b_get_irq','ym2610b_sample_rate',
  'ym2610b_generate','ym2610b_create_variant','ym2610b_load_rom','ym2610b_clear_roms','ym2610b_set_source_mute_mask','ym2610b_save_state','ym2610b_load_state','malloc','free'];

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
    assert(!['ym2610b_wasm.js','ym2610b_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ym2610b_wasm.js'),wasm=resolve(directory,'ym2610b_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);assert(module.HEAPU8 instanceof Uint8Array);
  const create=(variant=true)=>Ym2610B.create({moduleFactory:()=>module,variant});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ym2610b');assert(artifact,'YM2610B build receipt entry');
    for(const [name,record] of [['ym2610b_wasm.js',metadata.javascript],['ym2610b_wasm.wasm',metadata.wasm]]){
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
  const module=chip.module,size=module._ym2610b_save_state(chip.handle,0);
  assert(Number.isInteger(size)&&size>0&&size<0x2200000,'Valid bounded serialized state size');
  const ptr=module._malloc(size);assert(ptr);
  try{assert.equal(module._ym2610b_save_state(chip.handle,ptr),size);return new Uint8Array(module.HEAPF32.buffer,ptr,size).slice();}
  finally{module._free(ptr);}
}
function nativeLoad(chip,bytes,size=bytes.length){
  const module=chip.module,ptr=module._malloc(Math.max(1,bytes.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,bytes.length).set(bytes);return module._ym2610b_load_state(chip.handle,ptr,size);}
  finally{module._free(ptr);}
}
// Original arithmetic patterns; no hardware/game ROM is read or distributed.
const adpcmABytes=Uint8Array.from({length:4096},(_,i)=>((i*13+(i>>4)*7)^0x5a)&255);
const adpcmBBytes=Uint8Array.from({length:2048},(_,i)=>i%32<16?0x11:0x99);
function scenariosFor(clock){
 const out=[];
 function scenario(name,build,{stateful=false,engine=false,timerMode=undefined,silentWithoutB=false}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v,p=0)=>add('register',r,v,p);
  const pitch=(ch,midi)=>{const p=opnPitchFromHz(440*2**((midi-69)/12),clock,144);write(0xa4+ch%3,(p.block<<3)|(p.fnum>>8),Math.floor(ch/3));write(0xa0+ch%3,p.fnum&255,Math.floor(ch/3));};
  const fm=(ch=1,midi=69,algo=7,fb=0,key=true)=>{const port=Math.floor(ch/3),off=ch%3;for(let slot=0;slot<4;slot++)for(const [r,v] of [[0x30,slot+1],[0x40,24+slot*5],[0x50,31-slot],[0x60,3+slot*2],[0x70,slot],[0x80,0x2f],[0x90,0]])write(r+off+slot*4,v,port);write(0xb0+off,algo|(fb<<3),port);write(0xb4+off,0xc0,port);pitch(ch,midi);if(key)write(0x28,0xf0|(ch<3?ch:ch+1));};
  const ssg=(ch=0,period=127,level=11)=>{write(ch*2,period&255);write(ch*2+1,period>>8);write(8+ch,level);};
  const adpcmA=(voice=0,address=0)=>{add('rom',0,adpcmABytes,address,address+adpcmABytes.length);const first=address/256,last=(address+256)/256-1;write(1,52,1);write(8+voice,0xc0|27,1);for(const [r,v] of [[0x10,first&255],[0x18,first>>8],[0x20,last&255],[0x28,last>>8]])write(r+voice,v,1);write(0,1<<voice,1);};
  const adpcmB=(address=0)=>{add('rom',1,adpcmBBytes,address,address+adpcmBBytes.length);const first=address/256,last=(address+adpcmBBytes.length)/256-1;for(const [r,v] of [[0,1],[1,0xc0],[2,first&255],[3,first>>8],[4,last&255],[5,last>>8],[9,0],[10,0x40],[11,180],[0,0xb0]])write(0x10+r,v);};
  write(0x27,0);write(0x22,0);write(7,0x3f);for(let ch=0;ch<3;ch++)write(8+ch,0);add('source',0);
  build({add,write,pitch,fm,ssg,adpcmA,adpcmB,at:n=>{assert(Number.isInteger(n)&&n>=0&&n<totalFrames);frame=n;}});
  events.sort((a,b)=>a.frame-b.frame);assert(!events.some(e=>e.frame===checkpointFrame));out.push({name,clock,stateful,engine,timerMode,silentWithoutB,frames:totalFrames,events});
 }
 for(let ch=0;ch<6;ch++)for(let algo=0;algo<8;algo++)scenario(`FM/channel${ch}/algorithm${algo}/feedback${algo}`,({fm,write,pitch,at})=>{fm(ch,43+ch*6,algo,algo);const p=Math.floor(ch/3),off=ch%3;at(701);write(0x40+off,35,p);at(1703);write(0x34+off,7,p);at(2801);pitch(ch,79);at(3901);write(0x28,ch<3?ch:ch+1);at(5101);write(0x28,0xf0|(ch<3?ch:ch+1));},{stateful:ch===1&&algo===0||ch===5&&algo===7,engine:ch===1&&algo===0,silentWithoutB:ch===0||ch===3});
 for(let ch=0;ch<3;ch++)scenario(`SSG/tone${ch}/zero-one-period/coarse-mask`,({ssg,write,at})=>{write(7,0x3f^(1<<ch));ssg(ch,127+ch*103,15);at(701);write(ch*2,0);write(ch*2+1,0xf0);at(1703);write(ch*2,1);write(ch*2+1,0);at(2801);write(ch*2,255);write(ch*2+1,15);at(3901);write(8+ch,3);at(5101);write(8+ch,15);});
 scenario('SSG/noise/all-periods/gates',({ssg,write,at})=>{for(let ch=0;ch<3;ch++)ssg(ch,127+ch*103,15-ch*2);for(let i=0;i<32;i++){at(i*173);write(6,i);write(7,((i&7)|((i&7)<<3))^0x15);}},{stateful:true,engine:true});
 for(let shape=0;shape<16;shape++)scenario(`SSG/envelope${shape}/three-voices/retrigger`,({ssg,write,at})=>{write(7,0x38);for(let ch=0;ch<3;ch++)ssg(ch,127+ch*103,16);write(11,3);write(12,0);write(13,shape);at(1703);write(11,7);at(3301);write(13,shape);at(5101);write(11,0);write(13,shape^4);},{stateful:shape===10});
 scenario('FM/SSG-EG/keymasks/LFO/stereo',({fm,write,at})=>{for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,ch);write(0x22,15);for(let i=0;i<16;i++){at(i*347);const ch=i%6,p=Math.floor(ch/3),off=ch%3;write(0xb4+off,((i%4)<<6)|((i%4)<<4)|(i%8),p);for(let slot=0;slot<4;slot++){write(0x90+off+slot*4,i,p);write(0x60+off+slot*4,0x84,p);}write(0x28,(i<<4)|(ch<3?ch:ch+1));}});
 scenario('CH3-special/shared-cross-port-frequency-latches',({fm,write,at})=>{for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,3);write(0x27,0x40);for(let i=0;i<3;i++){write(0xac+i,0x20+i*3);write(0xa8+i,0x31+i*71);}at(701);write(0xa4,0x21);write(0xa1,0x91,1);at(1703);write(0xa6,0x2a,1);write(0xa0,0x41);at(2801);write(0xad,0x29,1);write(0xa8,0x69);at(3901);write(0x27,0);at(5101);write(0x27,0x40);},{stateful:true});
 for(const mode of [5,10,15,0x45,0x85])scenario(`timer/status-IRQ/CSM/mode${mode}`,({fm,write,at})=>{fm(2,60,7,3,mode!==0x85);write(0x24,255);write(0x25,3);write(0x26,253);write(0x27,mode);at(701);write(0x27,0x30);at(1703);write(0x27,mode);at(2801);write(0x27,0x30);at(3901);write(0x24,249);write(0x27,mode);at(5101);write(0x27,0x30);},{stateful:mode===0x85,timerMode:mode});
 scenario('SSG/pending-address/data-read/directions',({fm,ssg,write,add,at})=>{fm();ssg();write(7,0xf8);write(14,0xaa);write(15,0x55);at(701);write(7,0x38);at(1703);write(1,0xf1);at(2309);add('bus',0,8);at(2801);add('bus',1,15);at(3901);write(15,0xaa);at(5101);write(7,0xf8);},{stateful:true});
 for(let voice=0;voice<6;voice++)scenario(`ADPCM-A/voice${voice}/separate-ROM/pan/end-flags`,({adpcmA,write,add,at})=>{adpcmA(voice);at(701);write(8+voice,0x80|23,1);write(0,1<<voice,1);at(1703);write(8+voice,0x40|27,1);at(2801);write(0,0x80|(1<<voice),1);at(3901);add('rom',0,adpcmABytes.map(v=>v^0x88),0,adpcmABytes.length);write(8+voice,0xc0|27,1);write(0,1<<voice,1);at(5101);write(0x1c,1<<voice);write(0,1<<voice,1);},{stateful:voice===0||voice===5,engine:voice===0});
 for(const address of [0,0xff00])scenario(`ADPCM-B/ROM${address}/repeat/pan/replace`,({adpcmB,write,add,at})=>{adpcmB(address);at(701);write(0x11,0x80);write(0x19,0xff);at(1703);write(0x11,0x40);write(0x1b,73);at(2801);add('rom',1,new Uint8Array(),0,0);at(3901);add('rom',1,adpcmBBytes.map(v=>v^0x88),address,address+adpcmBBytes.length);write(0x11,0xc0);write(0x10,0xb0);at(5101);add('rom',1,adpcmBBytes,address,address+adpcmBBytes.length);write(0x10,0xa0);},{stateful:true,engine:address===0});
 scenario('ROM-A-B/overlap-independent/resize/sparse/clear',({fm,adpcmA,adpcmB,write,add,at})=>{fm();adpcmA(1);adpcmB();at(701);add('rom',0,Uint8Array.of(0x77,0x88),255,8192);write(0,2,1);at(1703);add('rom',1,new Uint8Array(),0,256);at(2801);add('rom',0,new Uint8Array(),0,0);at(3901);add('rom',1,adpcmBBytes,0x10000,0x10000+adpcmBBytes.length);at(5101);add('clear');adpcmA(5);adpcmB();},{stateful:true});
 scenario('mixed/FM-SSG-A-B/source-mutes/stereo',({fm,ssg,adpcmA,adpcmB,write,add,at})=>{fm();ssg();write(7,0x38);adpcmA(2);adpcmB();for(let mask=0;mask<8;mask++){at(101+mask*701);add('source',mask);write(0,4,1);}},{stateful:true});
 scenario('reset/retained-A-B-ROM/mute/reprogram',({fm,ssg,adpcmA,adpcmB,write,add,at})=>{fm(4,60,7);ssg();write(7,0x38);adpcmA(1);adpcmB();at(701);add('source',3);at(1703);add('reset');at(2801);add('source',0);adpcmA(1);adpcmB();at(3901);add('reset');at(5101);fm(2,72,7);adpcmA(5);adpcmB();},{stateful:true});
 return out;
}
const rawChip=actor=>actor.chip??actor;
const timing=actor=>actor.chip?[actor.remainder,actor.lastLeft,actor.lastRight]:null;
function readObservation(actor,frame,clock,io){const c=rawChip(actor);const ports=[0,1,2,3].map(offset=>{const value=c.read(offset);io.push({frame,type:'read',offset,value});return value;});return {frame,nativeRate:c.sampleRate(clock),outputRate:actor===c?null:actor.sampleRate(),status:c.readStatus(),statusHi:c.readStatusHi(),irq:c.getIrq(),ports};}
function execute(actor,scenario,layout,{start=0,method='stereo',saveCheckpoint=false}={}){
 const chip=rawChip(actor),frames=scenario.frames-start,left=new Float32Array(frames),right=new Float32Array(frames),io=[],observations=[];let frame=start,index=0,next=0,saved;
 while(next<scenario.events.length&&scenario.events[next].frame<start)next++;
 const initialObservation=readObservation(actor,start,scenario.clock,io);
 while(frame<scenario.frames){
  const write=(offset,data)=>{const result=chip.write(offset,data);assert(!result?.then);io.push({frame,type:'write',offset,data});};
  while(next<scenario.events.length&&scenario.events[next].frame===frame){const {op,args}=scenario.events[next++];if(op==='register'){write((args[2]??0)*2,args[0]);write((args[2]??0)*2+1,args[1]);}else if(op==='bus')write(...args);else if(op==='reset')actor.reset();else if(op==='rom')chip.loadAdpcmRom(...args);else if(op==='clear')chip.clearAdpcmRoms();else if(op==='source'){chip.setSourceMuteMask(args[0]);if(actor!==chip)actor.sourceMuteMask=args[0];}else throw Error(op);}
  if(saveCheckpoint&&frame===checkpointFrame){const opaque=actor.saveState(),bytes=nativeSave(chip);assert.equal(opaque.byteLength,bytes.length+(actor===chip?0:64));saved={opaque,bytes,timing:timing(actor)};}
  let end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity);if(saveCheckpoint&&frame<checkpointFrame)end=Math.min(end,checkpointFrame);const count=end-frame;assert(count>0);
  const pcm=actor!==chip?actor.processFrames(count):method==='view'?chip.generateStereoView(count):chip.generateStereo(count);assert(!pcm?.then);left.set(pcm.left.subarray(0,count),frame-start);right.set(pcm.right.subarray(0,count),frame-start);frame=end;observations.push(readObservation(actor,frame,scenario.clock,io));
 }
 for(const values of [left,right])for(const value of values)assert(Number.isFinite(value));return {left,right,initialObservation,observations,hooks:io,saved,endState:nativeSave(chip),endTiming:timing(actor)};
}
function compareResult(actual,expected,label,{offset=0,observations=true}={}){
  for(const name of ['left','right'])sameBytes(actual[name],expected[name].subarray(offset),`${label}/${name}`);
  sameBytes(actual.endState,expected.endState,`${label}/end-state`);assert.deepEqual(actual.endTiming,expected.endTiming,`${label}/resampler-held-timing`);
  if(observations){assert.deepEqual(actual.initialObservation,expected.initialObservation,`${label}/initial-read-rate-status-IRQ`);assert.deepEqual(actual.observations,expected.observations,`${label}/read-rate-status-IRQ`);assert.deepEqual(actual.hooks,expected.hooks,`${label}/hooks`);}
}
function compareContinuation(actual,expected,label){
  compareResult(actual,expected,label,{offset:checkpointFrame,observations:false});
  assert.deepEqual(actual.initialObservation,expected.observations.find(r=>r.frame===checkpointFrame),`${label}/immediate-restore`);
  assert.deepEqual(actual.observations,expected.observations.filter(r=>r.frame>checkpointFrame),`${label}/continued-observations`);
  assert.deepEqual(actual.hooks.filter(r=>r.frame>checkpointFrame),expected.hooks.filter(r=>r.frame>checkpointFrame),`${label}/continued-hooks`);
}
function pcmDigest(result){
  const hash=createHash('sha256');for(const array of [result.left,result.right])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');
}
function romBanks(bytes,prefix){let offset=prefix;const banks=[];for(let type=0;type<2;type++){const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0,true);offset+=4;assert(length<=0x1000000&&offset+length<=bytes.length);banks.push(bytes.subarray(offset,offset+length));offset+=length;}assert.equal(offset,bytes.length);return banks;}
function checkEndFlags(chip,initial){
 const write=(port,register,value)=>{chip.write(port*2,register);chip.write(port*2+1,value);};
 const rows=[];
 for(let voice=0;voice<6;voice++){
  assert.equal(nativeLoad(chip,initial),1);chip.loadAdpcmRom(0,adpcmABytes.subarray(0,256));
  write(0,0x1c,0);write(1,1,52);write(1,8+voice,0xc0|27);
  for(const register of [0x10,0x18,0x20,0x28])write(1,register+voice,0);
  assert.equal(chip.readStatusHi(),0);write(1,0,1<<voice);
  // A minimum 256-byte segment needs 512 nibbles and more than 13,824
  // high-fidelity output frames. This bounded check must actually reach EOS.
  const first=chip.generateStereo(20000),flag=1<<voice,firstStatus=chip.readStatusHi();
  assert(first.left.some(value=>value!==0));assert.equal(firstStatus&flag,flag,`ADPCM-A voice${voice} EOS`);
  write(0,0x1c,flag);assert.equal(chip.readStatusHi()&flag,0,'A EOS clear/mask');
  write(0,0x1c,0);assert.equal(chip.readStatusHi()&flag,0,'A EOS remains cleared after unmask');
  write(1,0,flag);const replay=chip.generateStereo(20000),rearmedStatus=chip.readStatusHi();
  assert.equal(rearmedStatus&flag,flag,'A retrigger rearms EOS');
  rows.push({source:'ADPCM-A',voice,framesPerTrigger:20000,firstStatus,rearmedStatus,
   pcmSha256:pcmDigest(first),retriggerPcmSha256:pcmDigest(replay)});
 }
 assert.equal(nativeLoad(chip,initial),1);chip.loadAdpcmRom(1,adpcmBBytes.subarray(0,256));write(0,0x1c,0);
 for(const [register,value] of [[0x10,1],[0x11,0xc0],[0x12,0],[0x13,0],[0x14,0],[0x15,0],[0x19,255],[0x1a,255],[0x1b,180],[0x10,0xa0]])write(0,register,value);
 const first=chip.generateStereo(6000),firstStatus=chip.readStatusHi();assert(first.left.some(value=>value!==0));assert.equal(firstStatus&0x80,0x80,'ADPCM-B one-shot EOS');
 write(0,0x1c,0x80);assert.equal(chip.readStatusHi()&0x80,0,'B EOS clear/mask');write(0,0x1c,0);assert.equal(chip.readStatusHi()&0x80,0,'B EOS remains cleared after unmask');
 write(0,0x10,0xa0);const replay=chip.generateStereo(6000),rearmedStatus=chip.readStatusHi();assert.equal(rearmedStatus&0x80,0x80,'B retrigger rearms EOS');
 write(0,0x10,1);chip.generateStereo(32);write(0,0x1c,0x80);write(0,0x1c,0);write(0,0x10,0xb0);
 // More than two complete passes through the same minimum-size sample.
 const repeated=chip.generateStereo(10000),repeatStatus=chip.readStatusHi();
 assert.equal(repeatStatus&0x80,0,'B repeat wrap must not signal one-shot EOS');
 assert(repeated.left.subarray(-1024).some(value=>value!==0),'B remains audible after repeated end wraps');
 rows.push({source:'ADPCM-B',framesPerTrigger:6000,firstStatus,rearmedStatus,pcmSha256:pcmDigest(first),retriggerPcmSha256:pcmDigest(replay),
  repeat:{frames:10000,status:repeatStatus,endFlagClear:true,tailAudible:true,pcmSha256:pcmDigest(repeated)}});
 return {passed:true,rows,totalNativeStereoFrames:262032,scope:'Additional bounded wrapper self-check frames, excluded from the main scenario output-frame counters.'};
}
async function wrapperChecks(backend,variant){
 const chip=await backend.create(variant),other=await backend.create(variant);
 try{
  const initial=nativeSave(chip),prefix=initial.length-8,rates={};for(const clock of rateClocks){rates[clock]=chip.sampleRate(clock);assert.equal(rates[clock],Math.floor(clock/16));}sameBytes(nativeSave(chip),initial,'Rate query observational');
  chip.reserveStereoFrames(4096);for(const method of ['generateStereo','generateStereoView']){chip[method](0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>chip[method](n),RangeError);}sameBytes(nativeSave(chip),initial,'Zero/invalid/reserve observational');
  const opaque=chip.saveState();assert.throws(()=>other.loadState(opaque),/foreign/);assert.equal(chip.module._ym2610b_load_state(chip.handle,0,initial.length),0);assert.equal(nativeLoad(chip,initial,initial.length-1),0);assert.equal(nativeLoad(chip,new Uint8Array(initial.length+1),initial.length+1),0);const corrupt=initial.slice();new DataView(corrupt.buffer).setUint32(prefix,0xffffffff,true);assert.equal(nativeLoad(chip,corrupt),0);sameBytes(nativeSave(chip),initial,'Bad variable ROM length does not mutate');
  chip.loadAdpcmRom(0,adpcmABytes,256,8192);chip.loadAdpcmRom(1,adpcmBBytes,128,4096);const loaded=nativeSave(chip),banks=romBanks(loaded,prefix);assert.equal(banks[0].length,8192);assert.equal(banks[1].length,4096);sameBytes(banks[0].subarray(256,256+adpcmABytes.length),adpcmABytes,'A ROM sparse transfer');sameBytes(banks[1].subarray(128,128+adpcmBBytes.length),adpcmBBytes,'B ROM independent transfer');
  chip.loadAdpcmRom(0,new Uint8Array(),0,0);const clearedA=romBanks(nativeSave(chip),prefix);assert.equal(clearedA[0].length,0);sameBytes(clearedA[1],banks[1],'Clearing A retains B');chip.clearAdpcmRoms();assert(romBanks(nativeSave(chip),prefix).every(b=>b.length===0));assert.equal(nativeLoad(chip,loaded),1);sameBytes(nativeSave(chip),loaded,'Both variable ROMs restored');
  const beforeBad=nativeSave(chip);for(const call of [()=>chip.loadAdpcmRom(2,Uint8Array.of(1)),()=>chip.loadAdpcmRom(0,Uint8Array.of(1),0x1000000,0x1000000),()=>chip.loadAdpcmRom(1,new Uint8Array(),0,0x1000001),()=>chip.loadAdpcmRom(0,new Uint8Array(2),7,8)])assert.throws(call,RangeError);sameBytes(nativeSave(chip),beforeBad,'Upload bounds reject before mutation');
  if(variant)for(const type of [0,1]){chip.clearAdpcmRoms();chip.loadAdpcmRom(type,Uint8Array.of(0x12,0x34),0xfffffe,0x1000000);const bank=romBanks(nativeSave(chip),prefix)[type];assert.equal(bank.length,0x1000000);sameBytes(bank.subarray(-2),Uint8Array.of(0x12,0x34),'16MiB final ROM boundary');}
  chip.loadState(opaque);const scenario=scenariosFor(8000000).find(s=>s.name==='FM/channel1/algorithm0/feedback0'),copied=execute(chip,scenario,layouts.irregular);assert.equal(nativeLoad(other,initial),1);compareResult(execute(other,scenario,layouts.irregular,{method:'view'}),copied,'Copied/view PCM');
  const owned=chip.generateStereo(17),held=owned.left.slice();chip.reserveStereoFrames(8192);chip.generateStereo(4097);sameBytes(owned.left,held,'Owned PCM survives reuse');
  const endFlagChecks=checkEndFlags(chip,initial);
  return {passed:true,variant:variant?'YM2610B':'YM2610',rates,initialStateBytes:initial.length,loadedStateBytes:loaded.length,separateVariableRomTransferClearRestore:true,maxRomBoundaryChecked:variant,invalidStateLengthsAndUploadBoundsRejected:true,copyViewEqual:true,publicHooksAvailable:typeof chip.setHooks==='function',endFlagChecks,
   totalNativeStereoFrames:scenario.frames*2+17+4097+endFlagChecks.totalNativeStereoFrames,
   frameCountScope:'Copied/view generation, owned-buffer reuse and bounded EOS/repeat self-checks; excluded from main scenario output-frame counters.'};
 }finally{chip.dispose();chip.dispose();other.dispose();other.dispose();}
}

async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');
  const wrappers=['web/ym2610b.js','docs/js/ym2610b.js','web/ym2610baudioengine.js','docs/js/ym2610baudioengine.js'];
  // Deployment adds cache-version suffixes to these two relative module paths,
  // including JSDoc imports. Everything else must remain byte-identical.
  const normalized=bytes=>bytes.toString().replace(/(\.\/(?:ym2610b|soundchip)\.js)\?v=[^"'\s)]+/g,'$1');
  for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,layouts,checkpointFrame,
    method:'Actual generated JS/WASM and unchanged synchronous Ym2610B wrapper/AudioEngine for both YM2610 and YM2610B. Exact stereo PCM, rate/status/IRQ/read traces, state bytes and JS resampler timing; no tolerance, mock, Mixer or device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),pitch:await inputFile(resolve(root,'web/soundchip_pitch.js'))},
    wrapperSync:'Byte-identical after removing only deployed ym2610b.js/soundchip.js import cache suffixes; actual file hashes retained.',
    syntheticInputs:{adpcmA:{bytes:adpcmABytes.length,sha256:sha256(adpcmABytes)},adpcmB:{bytes:adpcmBBytes.length,sha256:sha256(adpcmBBytes)}},wrapperChecks:{},cases:[],totalOutputStereoFrames:0,ownStateLoads:0,crossStateLoads:0,resetContinuations:0,maximumDifference:0,
    limits:['Native YM2610B PCM runs at clock/16 with fixed prescaling; YM2610B enables physical FM0/3 in addition to YM2610 physical FM1/2/4/5. Engine cases separately report output rate and averaging/holding.',
      'Cross-build raw states are tested for these exact builds only; opaque public snapshots remain owner-restricted.',
      'The public wrapper has no setHooks API; the harness records actual synchronous bus/read calls and status/IRQ at chunk boundaries, without adding a production hook API. Cross-build states are exchanged only within the same chip variant.',
      'No Worklet scheduling, physical hardware, browser, Native backend, Mixer or listening judgement is tested.']};
  for(const variant of [false,true]){const name=variant?'YM2610B':'YM2610';report.wrapperChecks[name]={legacy:await wrapperChecks(legacy,variant),sdk:await wrapperChecks(sdk,variant)};assert.deepEqual(report.wrapperChecks[name].sdk,report.wrapperChecks[name].legacy);}
  report.totalWrapperSelfCheckNativeStereoFrames=Object.values(report.wrapperChecks).reduce((sum,checks)=>sum+checks.legacy.totalNativeStereoFrames+checks.sdk.totalNativeStereoFrames,0);
  const jobs=[];
  for(const variant of [false,true])for(const clock of clocks)for(const scenario of scenariosFor(clock)){
    jobs.push({...scenario,variant,kind:'chip',outputRate:null,checkpoint:scenario.stateful&&clock===8000000});
    if(scenario.engine&&clock===8000000)for(const outputRate of [44100,48000,96000,1000000])jobs.push({...scenario,variant,kind:'engine',outputRate,checkpoint:outputRate===48000,frames:3072,events:scenario.events.filter(e=>e.frame<3072)});
  }
  for(const scenario of jobs){
    let regular;
    for(const [layoutName,layout] of Object.entries(layouts)){
      const make=async backend=>{const chip=await backend.create(scenario.variant);return scenario.kind==='chip'?chip:new Ym2610BAudioEngine(chip,chip.sampleRate(scenario.clock),scenario.outputRate,1);};
      const a=await make(legacy),b=await make(sdk),runOptions={saveCheckpoint:scenario.checkpoint,},label=`${scenario.variant?'YM2610B':'YM2610'}/${scenario.kind}/${scenario.name}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
      try{
        const x=execute(a,scenario,layout,runOptions),y=execute(b,scenario,layout,runOptions);compareResult(y,x,label);if(scenario.checkpoint)sameBytes(y.saved.bytes,x.saved.bytes,'Checkpoint bytes compatible');
        if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        let peak=0;for(const v of x.left)peak=Math.max(peak,Math.abs(v));if(scenario.silentWithoutB&&!scenario.variant)assert.equal(peak,0,`${label}: YM2610 excludes physical FM0/3`);else assert(peak>1e-5,`${label}: audible reference`);
        if(scenario.timerMode!==undefined){const flag=scenario.timerMode&4?1:2;assert(x.observations.some(r=>(r.status&flag)&&r.irq),`${label}: timer must assert status/IRQ`);}
        if(layoutName==='regular'&&scenario.checkpoint){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){
            actor.reset();rawChip(actor).clearAdpcmRoms();rawChip(actor).loadAdpcmRom(0,adpcmABytes.map(v=>v^0x88));if(actor.chip)actor.processFrames(31);else actor.generateStereo(31);
            actor.loadState(result.saved.opaque);const restored=execute(actor,scenario,layout,{start:checkpointFrame,});compareContinuation(restored,result,`${name}/opaque`);report.ownStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          assert.throws(()=>a.loadState(y.saved.opaque),/foreign|Incompatible/);assert.throws(()=>b.loadState(x.saved.opaque),/foreign|Incompatible/);
          for(const [actor,state,result,name] of [[a,y.saved,x,'sdk-to-legacy'],[b,x.saved,y,'legacy-to-sdk']]){
            actor.reset();assert.equal(nativeLoad(rawChip(actor),state.bytes),1);
            if(actor.chip)[actor.remainder,actor.lastLeft,actor.lastRight]=state.timing;
            const restored=execute(actor,scenario,layout,{start:checkpointFrame,});compareContinuation(restored,result,`${name}/raw-state`);report.crossStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          a.reset();b.reset();compareResult(execute(b,scenario,layout,{}),execute(a,scenario,layout,{}),'Reset/reprogram');report.resetContinuations+=2;report.totalOutputStereoFrames+=scenario.frames*2;
        }
        report.cases.push({name:scenario.name,variant:scenario.variant?'YM2610B':'YM2610',kind:scenario.kind,clock:scenario.clock,nativeRate:Math.floor(scenario.clock/16),outputRate:scenario.outputRate,checkpointSaved:scenario.checkpoint,continuationReplayTested:scenario.checkpoint&&layoutName==='regular',layout:layoutName,frames:scenario.frames,peak,pcmSha256:pcmDigest(x),checkpointSha256:x.saved?sha256(x.saved.bytes):null,stateBytes:x.endState.length,endStateSha256:sha256(x.endState),observations:x.observations.length,ioEvents:x.hooks.length,maximumDifference:0});report.totalOutputStereoFrames+=scenario.frames*2;
      }finally{a.dispose();b.dispose();}
    }
  }
  report.scenariosPerClock=scenariosFor(clocks[0]).length;report.scenarioConfigurations=jobs.length;report.scenarioRenderExecutions=report.cases.length*2+report.ownStateLoads+report.crossStateLoads+report.resetContinuations;
  report.frameCountScope='Both builds: low-level PCM frames or resampled engine output frames, including own/cross-state/reset continuations; wrapper self-check frames excluded. Engine source frames are intentionally not counted as output frames.';
  report.passed=true;report.completedAt=new Date().toISOString();if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,lowLevelComparisons:report.cases.filter(c=>c.kind==='chip').length,engineComparisons:report.cases.filter(c=>c.kind==='engine').length,totalOutputStereoFrames:report.totalOutputStereoFrames,ownStateLoads:report.ownStateLoads,crossStateLoads:report.crossStateLoads,resetContinuations:report.resetContinuations,maximumDifference:0,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
