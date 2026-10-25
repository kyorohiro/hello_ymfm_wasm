/** Compare two real YM2608 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ym2608} from '../web/ym2608.js';
import {Ym2608AudioEngine} from '../web/ym2608audioengine.js';
import {opnPitchFromHz} from '../web/soundchip_pitch.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ym2608_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[3993600,7987200,8000000];
const rateClocks=[100000,3579545,3993600,7670454,8000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const checkpointFrame=2345,totalFrames=6144;
const requiredExports=['ym2608_create','ym2608_destroy','ym2608_reset','ym2608_write',
  'ym2608_read','ym2608_read_status','ym2608_read_status_hi','ym2608_get_irq','ym2608_sample_rate',
  'ym2608_generate','ym2608_load_adpcm_a_rom','ym2608_load_adpcm_b_memory','ym2608_clear_adpcm_b_memory','ym2608_set_source_mute_mask','ym2608_save_state','ym2608_load_state','malloc','free'];

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
    assert(!['ym2608_wasm.js','ym2608_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ym2608_wasm.js'),wasm=resolve(directory,'ym2608_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);assert(module.HEAPU8 instanceof Uint8Array);
  const create=()=>Ym2608.create({moduleFactory:()=>module});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ym2608');assert(artifact,'YM2608 build receipt entry');
    for(const [name,record] of [['ym2608_wasm.js',metadata.javascript],['ym2608_wasm.wasm',metadata.wasm]]){
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
  const module=chip.module,size=module._ym2608_save_state(chip.handle,0);
  assert(Number.isInteger(size)&&size>0&&size<0x300000,'Valid bounded serialized state size');
  const ptr=module._malloc(size);assert(ptr);
  try{assert.equal(module._ym2608_save_state(chip.handle,ptr),size);return new Uint8Array(module.HEAPF32.buffer,ptr,size).slice();}
  finally{module._free(ptr);}
}
function nativeLoad(chip,bytes,size=bytes.length){
  const module=chip.module,ptr=module._malloc(Math.max(1,bytes.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,bytes.length).set(bytes);return module._ym2608_load_state(chip.handle,ptr,size);}
  finally{module._free(ptr);}
}
// Entirely original arithmetic byte patterns, not hardware/game ROM data.
const rhythmRom=Uint8Array.from({length:8192},(_,i)=>((i*13+(i>>4)*7)^0x5a)&255);
const adpcmBytes=Uint8Array.from({length:2048},(_,i)=>i%32<16?0x11:0x99);
function scenariosFor(clock){
 const out=[];
 function scenario(name,build,{stateful=false,engine=false,timerMode=undefined}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v,p=0)=>add('register',r,v,p);
  const pitch=(ch,midi)=>{const p=opnPitchFromHz(440*2**((midi-69)/12),clock,144);write(0xa4+ch%3,(p.block<<3)|(p.fnum>>8),Math.floor(ch/3));write(0xa0+ch%3,p.fnum&255,Math.floor(ch/3));};
  const fm=(ch=0,midi=69,algo=7,fb=0,key=true)=>{
   const port=Math.floor(ch/3),off=ch%3;
   for(let slot=0;slot<4;slot++)for(const [r,v] of [[0x30,slot+1],[0x40,24+slot*5],[0x50,31-slot],[0x60,3+slot*2],[0x70,slot],[0x80,0x2f],[0x90,0]])write(r+off+slot*4,v,port);
   write(0xb0+off,algo|(fb<<3),port);write(0xb4+off,0xc0,port);pitch(ch,midi);if(key)write(0x28,0xf0|(ch<3?ch:ch+1));
  };
  const ssg=(ch=0,period=127,level=11)=>{write(ch*2,period&255);write(ch*2+1,period>>8);write(8+ch,level);};
  const rhythm=(voice=0)=>{add('rom',0,rhythmRom);write(0x11,52);write(0x18+voice,0xc0|27);write(0x10,1<<voice);};
  const adpcm=(address=0)=>{
   add('memory',address,adpcmBytes);const first=address>>5,last=(address+adpcmBytes.length-1)>>5;
   for(const [r,v] of [[0,1],[1,0xc2],[2,first&255],[3,first>>8],[4,last&255],[5,last>>8],[12,255],[13,255],[9,0x00],[10,0x40],[11,180],[0,0xb0]])write(r,v,1);
  };
  write(0x29,0x9f);write(0x27,0);write(0x22,0);write(7,0x3f);for(let ch=0;ch<3;ch++)write(8+ch,0);add('source',0);
  build({add,write,pitch,fm,ssg,rhythm,adpcm,at:n=>{assert(Number.isInteger(n)&&n>=0&&n<totalFrames);frame=n;}});
  events.sort((a,b)=>a.frame-b.frame);assert(!events.some(e=>e.frame===checkpointFrame));
  out.push({name,clock,stateful,engine,timerMode,frames:totalFrames,events});
 }
 for(let ch=0;ch<6;ch++)for(let algo=0;algo<8;algo++)scenario(`FM/channel${ch}/algorithm${algo}/feedback${algo}`,({fm,write,pitch,at})=>{
  fm(ch,43+ch*6,algo,algo);const p=Math.floor(ch/3),off=ch%3;at(701);write(0x40+off,35,p);at(1703);write(0x34+off,7,p);at(2801);pitch(ch,79);at(3901);write(0x28,ch<3?ch:ch+1);at(5101);write(0x28,0xf0|(ch<3?ch:ch+1));
 },{stateful:ch===0&&algo===0||ch===5&&algo===7,engine:ch===0&&algo===0});
 for(let ch=0;ch<3;ch++)scenario(`SSG/tone${ch}/zero-one-period/coarse-mask`,({ssg,write,at})=>{write(7,0x3f^(1<<ch));ssg(ch,127+ch*103,15);at(701);write(ch*2,0);write(ch*2+1,0xf0);at(1703);write(ch*2,1);write(ch*2+1,0);at(2801);write(ch*2,255);write(ch*2+1,15);at(3901);write(8+ch,3);at(5101);write(8+ch,15);});
 scenario('SSG/noise/all-periods/gates',({ssg,write,at})=>{for(let ch=0;ch<3;ch++)ssg(ch,127+ch*103,15-ch*2);for(let i=0;i<32;i++){at(i*173);write(6,i);write(7,((i&7)|((i&7)<<3))^0x15);}},{stateful:true,engine:true});
 for(let shape=0;shape<16;shape++)scenario(`SSG/envelope${shape}/three-voices/retrigger`,({ssg,write,at})=>{write(7,0x38);for(let ch=0;ch<3;ch++)ssg(ch,127+ch*103,16);write(11,3);write(12,0);write(13,shape);at(1703);write(11,7);at(3301);write(13,shape);at(5101);write(11,0);write(13,shape^4);},{stateful:shape===10});
 scenario('FM/SSG-EG/keymasks/LFO/stereo',({fm,write,at})=>{for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,ch);write(0x22,15);for(let i=0;i<16;i++){at(i*347);const ch=i%6,p=Math.floor(ch/3),off=ch%3;write(0xb4+off,((i%4)<<6)|((i%4)<<4)|(i%8),p);for(let slot=0;slot<4;slot++){write(0x90+off+slot*4,i,p);write(0x60+off+slot*4,0x84,p);}write(0x28,(i<<4)|(ch<3?ch:ch+1));}});
 scenario('CH3-special/shared-cross-port-frequency-latches',({fm,write,at})=>{for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,3);write(0x27,0x40);for(let i=0;i<3;i++){write(0xac+i,0x20+i*3);write(0xa8+i,0x31+i*71);}at(701);write(0xa4,0x21);write(0xa1,0x91,1);at(1703);write(0xa6,0x2a,1);write(0xa0,0x41);at(2801);write(0xad,0x29,1);write(0xa8,0x69);at(3901);write(0x27,0);at(5101);write(0x27,0x40);},{stateful:true});
 for(const mode of [5,10,15,0x45,0x85])scenario(`timer/status-IRQ/CSM/mode${mode}`,({fm,write,at})=>{fm(2,60,7,3,mode!==0x85);write(0x24,255);write(0x25,3);write(0x26,253);write(0x27,mode);at(701);write(0x27,0x30);at(1703);write(0x27,mode);at(2801);write(0x27,0x30);at(3901);write(0x24,249);write(0x27,mode);at(5101);write(0x27,0x30);},{stateful:mode===0x85,timerMode:mode});
 scenario('prescaler/address-only/6-3-2/pending-SSG-data',({fm,ssg,write,add,at})=>{fm();ssg();write(7,0x38);for(const [f,r] of [[701,0x2e],[1703,0x2f],[2801,0x2e],[3901,0x2d],[5101,0x2e]]){at(f);add('bus',0,r);}at(2309);add('bus',0,8);at(2800);add('bus',1,15);},{stateful:true});
 for(let voice=0;voice<6;voice++)scenario(`rhythm/voice${voice}/synthetic-ROM/pan/retrigger`,({rhythm,write,add,at})=>{rhythm(voice);at(701);write(0x18+voice,0x80|23);write(0x10,1<<voice);at(1703);write(0x18+voice,0x40|27);at(2801);write(0x10,0x80|(1<<voice));at(3901);add('rom',0,rhythmRom.map(v=>v^0x88));write(0x18+voice,0xc0|27);write(0x10,1<<voice);at(5101);add('rom',0,rhythmRom);write(0x10,1<<voice);},{stateful:voice===0||voice===5,engine:voice===0});
 for(const address of [0,0x200000-adpcmBytes.length])scenario(`ADPCM-B/direct-RAM${address}/repeat/pan/clear/restore`,({adpcm,write,add,at})=>{adpcm(address);at(701);write(1,0x82,1);write(9,0xff,1);at(1703);write(1,0x42,1);write(11,73,1);at(2801);add('clear');at(3901);add('memory',address,adpcmBytes.map(v=>v^0x88));write(1,0xc2,1);write(0,0xb0,1);at(5101);add('memory',address,adpcmBytes);write(0,0xa0,1);},{stateful:true,engine:address===0});
 scenario('ADPCM-B/CPU-upload-download/pending-data/status-hi',({fm,write,add,at})=>{fm();for(const [r,v] of [[1,2],[2,0x10],[3,0],[4,0x11],[5,0],[0,0x60]])write(r,v,1);for(let n=0;n<64;n++)write(8,(n*7)&255,1);at(701);write(0,0x20,1);add('bus',2,8);for(let i=0;i<8;i++)add('read',3);at(1703);write(0,1,1);at(2309);add('bus',2,8);at(2801);add('bus',3,0x55);write(0x10,0x80,1);at(3901);write(7,0xf8);write(14,0xaa);at(5101);write(0x10,0,1);},{stateful:true});
 scenario('mixed/FM-SSG-rhythm-ADPCM/source-mutes/stereo',({fm,ssg,rhythm,adpcm,write,add,at})=>{fm();ssg();write(7,0x38);rhythm(2);adpcm();for(let mask=0;mask<8;mask++){at(101+mask*701);add('source',mask);write(0x10,1<<2);}},{stateful:true});
 scenario('reset/retained-ROM-RAM/prescale/mute/reprogram',({fm,ssg,rhythm,adpcm,write,add,at})=>{fm(4,60,7);ssg();write(7,0x38);rhythm(1);adpcm();at(701);add('bus',0,0x2f);at(1703);add('source',1);add('reset');at(2801);add('source',0);rhythm(1);adpcm();at(3901);add('reset');at(5101);fm(2,72,7);rhythm(5);adpcm();},{stateful:true});
 return out;
}
const rawChip=actor=>actor.ym2608??actor;
const timing=actor=>actor.ym2608?[actor._resampleRemainder,actor._lastLeft,actor._lastRight]:null;
function readObservation(actor,frame,clock,probeDataPort=true){const c=rawChip(actor);return {frame,nativeRate:c.sampleRate(clock),outputRate:actor===c?null:actor.sampleRate(),status:c.readStatus(),statusHi:c.readStatusHi(),irq:c.getIrq(),ports:[0,1,2,3].map(offset=>offset===3&&!probeDataPort?null:c.read(offset))};}
function execute(actor,scenario,layout,{start=0,method='stereo',saveCheckpoint=false,irqHooks=true}={}){
  const chip=rawChip(actor),frames=scenario.frames-start,left=new Float32Array(frames),right=new Float32Array(frames);
  const hooks=[],observations=[];let frame=start,hookFrame=start,index=0,next=0,saved;
  while(next<scenario.events.length&&scenario.events[next].frame<start)next++;
  chip.setHooks({onWrite:e=>hooks.push({frame:hookFrame,type:'write',...e}),onRead:e=>hooks.push({frame:hookFrame,type:'read',...e}),...(irqHooks?{onIrq:asserted=>hooks.push({frame:hookFrame,type:'irq',asserted})}:{})});
  // ADPCM CPU data reads advance the RAM cursor. Exercise those only at
  // authored event times so diagnostic sampling cannot change the program.
  const probeDataPort=!scenario.name.startsWith('ADPCM-B/CPU-');
  const initialObservation=readObservation(actor,start,scenario.clock,probeDataPort);
  while(frame<scenario.frames){
    hookFrame=frame;
    while(next<scenario.events.length&&scenario.events[next].frame===frame){
      const {op,args}=scenario.events[next++];
      if(op==='register'){chip.write((args[2]??0)*2,args[0]);chip.write((args[2]??0)*2+1,args[1]);}
      else if(op==='bus')chip.write(...args);
      else if(op==='reset')actor.reset();
      else if(op==='rom')chip.loadAdpcmARom(args[1],args[0]);
      else if(op==='memory')chip.loadAdpcmBMemory(args[1],args[0]);
      else if(op==='clear')chip.clearAdpcmBMemory();
      else if(op==='read')chip.read(args[0]);
      else if(op==='source'){chip.setSourceMuteMask(args[0]);if(actor!==chip)actor._sourceMuteMask=args[0];}
      else throw Error(op);
    }
    if(saveCheckpoint&&frame===checkpointFrame){const count=hooks.length,opaque=actor.saveState(),bytes=nativeSave(chip);assert.equal(hooks.length,count);assert.equal(opaque.byteLength,bytes.length+(actor===chip?0:64));saved={opaque,bytes,timing:timing(actor)};}
    let end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity);
    if(saveCheckpoint&&frame<checkpointFrame)end=Math.min(end,checkpointFrame);
    const count=end-frame;assert(count>0);hookFrame=end;
    const pcm=actor!==chip?actor.processFrames(count):method==='view'?chip.generateStereoView(count):chip.generateStereo(count);
    assert(!pcm?.then);left.set(pcm.left.subarray(0,count),frame-start);right.set(pcm.right.subarray(0,count),frame-start);
    frame=end;observations.push(readObservation(actor,frame,scenario.clock,probeDataPort));
  }
  for(const values of [left,right])for(const value of values)assert(Number.isFinite(value));

  const endState=nativeSave(chip),endTiming=timing(actor);chip.setHooks();return {left,right,initialObservation,observations,hooks,saved,endState,endTiming};
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
async function wrapperChecks(backend){
 const chip=await backend.create(),other=await backend.create();
 try{
  const initial=nativeSave(chip),rates={};for(const clock of rateClocks){rates[clock]=chip.sampleRate(clock);assert.equal(rates[clock],Math.floor(clock/8));}sameBytes(nativeSave(chip),initial,'Rate query is observational');
  chip.reserveStereoFrames(4096);for(const method of ['generateStereo','generateStereoView']){chip[method](0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>chip[method](n),RangeError);}sameBytes(nativeSave(chip),initial,'Zero/invalid/reserve is observational');
  const opaque=chip.saveState();assert.throws(()=>other.loadState(opaque),/foreign/);assert.equal(chip.module._ym2608_load_state(chip.handle,0,initial.length),0);assert.equal(nativeLoad(chip,initial,initial.length-1),0);assert.equal(nativeLoad(chip,new Uint8Array(initial.length+1),initial.length+1),0);
  const corrupt=initial.slice(),prefix=initial.length-0x200000-8;new DataView(corrupt.buffer).setUint32(prefix,0xffffffff,true);assert.equal(nativeLoad(chip,corrupt),0);sameBytes(nativeSave(chip),initial,'Invalid serialized memory length does not mutate');
  chip.loadAdpcmARom(rhythmRom);const fullRam=Uint8Array.from({length:0x200000},(_,i)=>(i*17+(i>>9))&255);chip.loadAdpcmBMemory(fullRam);const loaded=nativeSave(chip);sameBytes(loaded.subarray(-0x200000),fullRam,'Full2MiB RAM transfer');sameBytes(loaded.subarray(-(0x200000+4+8192),-(0x200000+4)),rhythmRom,'Full8KiB synthetic rhythm ROM');
  chip.clearAdpcmBMemory();assert(nativeSave(chip).subarray(-0x200000).every(v=>v===0),'Clear entire RAM');assert.equal(nativeLoad(chip,loaded),1);sameBytes(nativeSave(chip),loaded,'Memory state restore');
  chip.loadAdpcmBMemory(Uint8Array.of(0x12,0x34),0x1ffffe);sameBytes(nativeSave(chip).subarray(-2),Uint8Array.of(0x12,0x34),'Final RAM boundary');
  const beforeBad=nativeSave(chip);for(const call of [()=>chip.loadAdpcmARom(new Uint8Array(8193)),()=>chip.loadAdpcmARom(Uint8Array.of(1),8192),()=>chip.loadAdpcmBMemory(Uint8Array.of(1),0x200000),()=>chip.loadAdpcmBMemory(new Uint8Array(2),0x1fffff)])assert.throws(call,RangeError);sameBytes(nativeSave(chip),beforeBad,'Out-of-range upload rejected');
  chip.loadState(opaque);chip.write(0,0x2e);assert.notEqual(sha256(nativeSave(chip)),sha256(initial),'Prescaler address side effect');for(const clock of rateClocks)assert.equal(chip.sampleRate(clock),rates[clock]);
  const scenario=scenariosFor(8000000)[0];chip.loadState(opaque);const copied=execute(chip,scenario,layouts.irregular);assert.equal(nativeLoad(other,initial),1);compareResult(execute(other,scenario,layouts.irregular,{method:'view'}),copied,'Copied/view PCM');
  const own=chip.generateStereo(17),held=own.left.slice();chip.reserveStereoFrames(8192);chip.generateStereo(4097);sameBytes(own.left,held,'Owned PCM independent of heap reuse');
  return {passed:true,rates,initialStateBytes:initial.length,loadedStateBytes:loaded.length,fullRamSha256:sha256(fullRam),rhythmRomSha256:sha256(rhythmRom),memoryTransferClearAndRestore:true,invalidMemoryLengthsRejected:true,uploadBoundsRejected:true,copyViewEqual:true,prescalerAddressSideEffect:true,foreignOpaqueStateRejected:true};
 }finally{chip.dispose();chip.dispose();other.dispose();other.dispose();}
}

async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');
  const wrappers=['web/ym2608.js','docs/js/ym2608.js','web/ym2608audioengine.js','docs/js/ym2608audioengine.js'];
  // Deployment adds cache-version suffixes to these two relative module paths,
  // including JSDoc imports. Everything else must remain byte-identical.
  const normalized=bytes=>bytes.toString().replace(/(\.\/(?:ym2608|soundchip)\.js)\?v=[^"'\s)]+/g,'$1');
  for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,layouts,checkpointFrame,
    method:'Actual generated JS/WASM and unchanged synchronous Ym2608 wrapper/AudioEngine. Exact stereo PCM, rate/status/IRQ/read/hooks, state bytes, resampler remainder/held samples; no tolerance, mock, Mixer or output device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),pitch:await inputFile(resolve(root,'web/soundchip_pitch.js'))},
    wrapperSync:'Byte-identical after removing only deployed ym2608.js/soundchip.js import cache suffixes; actual file hashes retained.',
    syntheticInputs:{rhythmRom:{bytes:rhythmRom.length,sha256:sha256(rhythmRom)},adpcmB:{bytes:adpcmBytes.length,sha256:sha256(adpcmBytes)}},wrapperChecks:{},cases:[],totalOutputStereoFrames:0,ownStateLoads:0,crossStateLoads:0,resetContinuations:0,maximumDifference:0,
    limits:['Native YM2608 PCM runs at clock/8 regardless of the6/3/2 prescaler; the prescaler changes internal FM/SSG timing. Engine cases separately report output rate and averaging/holding.',
      'Cross-build raw states are tested for these exact builds only; opaque public snapshots remain owner-restricted.',
      'Status/IRQ/read hooks are sampled at chunk boundaries. AudioEngine internally invokes the same wrapper per output sample; generation callbacks are labeled by the enclosing chunk boundary.',
      'No Worklet scheduling, physical hardware, browser, Native backend, Mixer or listening judgement is tested.']};
  report.wrapperChecks.legacy=await wrapperChecks(legacy);report.wrapperChecks.sdk=await wrapperChecks(sdk);assert.deepEqual(report.wrapperChecks.sdk,report.wrapperChecks.legacy);
  const jobs=[];
  for(const clock of clocks)for(const scenario of scenariosFor(clock)){
    jobs.push({...scenario,kind:'chip',outputRate:null,irqHooks:true,checkpoint:scenario.stateful&&clock===8000000});
    if(scenario.engine&&clock===8000000)for(const outputRate of [44100,48000,96000,1500000])for(const irqHooks of [false,true])jobs.push({...scenario,kind:'engine',outputRate,irqHooks,checkpoint:outputRate===48000,frames:3072,events:scenario.events.filter(e=>e.frame<3072)});
  }
  for(const scenario of jobs){
    let regular;
    for(const [layoutName,layout] of Object.entries(layouts)){
      const make=async backend=>{const chip=await backend.create();return scenario.kind==='chip'?chip:new Ym2608AudioEngine(chip,chip.sampleRate(scenario.clock),scenario.outputRate,1);};
      const a=await make(legacy),b=await make(sdk),runOptions={saveCheckpoint:scenario.checkpoint,irqHooks:scenario.irqHooks},label=`${scenario.kind}/${scenario.name}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
      try{
        const x=execute(a,scenario,layout,runOptions),y=execute(b,scenario,layout,runOptions);compareResult(y,x,label);if(scenario.checkpoint)sameBytes(y.saved.bytes,x.saved.bytes,'Checkpoint bytes compatible');
        if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        let peak=0;for(const v of x.left)peak=Math.max(peak,Math.abs(v));assert(peak>1e-5,`${label}: audible reference`);
        if(scenario.timerMode!==undefined){const flag=scenario.timerMode&4?1:2;assert(x.observations.some(r=>(r.status&flag)&&r.irq),`${label}: timer must assert status/IRQ`);}
        if(layoutName==='regular'&&scenario.checkpoint){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){
            actor.reset();rawChip(actor).clearAdpcmBMemory();rawChip(actor).loadAdpcmARom(rhythmRom.map(v=>v^0x88));if(actor.ym2608)actor.processFrames(31);else actor.generateStereo(31);
            actor.loadState(result.saved.opaque);const restored=execute(actor,scenario,layout,{start:checkpointFrame,irqHooks:scenario.irqHooks});compareContinuation(restored,result,`${name}/opaque`);report.ownStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          assert.throws(()=>a.loadState(y.saved.opaque),/foreign|Incompatible/);assert.throws(()=>b.loadState(x.saved.opaque),/foreign|Incompatible/);
          for(const [actor,state,result,name] of [[a,y.saved,x,'sdk-to-legacy'],[b,x.saved,y,'legacy-to-sdk']]){
            actor.reset();assert.equal(nativeLoad(rawChip(actor),state.bytes),1);
            if(actor.ym2608)[actor._resampleRemainder,actor._lastLeft,actor._lastRight]=state.timing;
            const restored=execute(actor,scenario,layout,{start:checkpointFrame,irqHooks:scenario.irqHooks});compareContinuation(restored,result,`${name}/raw-state`);report.crossStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          a.reset();b.reset();compareResult(execute(b,scenario,layout,{irqHooks:scenario.irqHooks}),execute(a,scenario,layout,{irqHooks:scenario.irqHooks}),'Reset/reprogram');report.resetContinuations+=2;report.totalOutputStereoFrames+=scenario.frames*2;
        }
        report.cases.push({name:scenario.name,kind:scenario.kind,clock:scenario.clock,nativeRate:Math.floor(scenario.clock/8),outputRate:scenario.outputRate,irqHooks:scenario.irqHooks,checkpointTested:scenario.checkpoint,layout:layoutName,frames:scenario.frames,peak,pcmSha256:pcmDigest(x),checkpointSha256:x.saved?sha256(x.saved.bytes):null,stateBytes:x.endState.length,endStateSha256:sha256(x.endState),observations:x.observations.length,hookEvents:x.hooks.length,maximumDifference:0});report.totalOutputStereoFrames+=scenario.frames*2;
      }finally{a.dispose();b.dispose();}
    }
  }
  report.scenariosPerClock=scenariosFor(clocks[0]).length;report.scenarioConfigurations=jobs.length;report.scenarioRenderExecutions=report.cases.length*2+report.ownStateLoads+report.crossStateLoads+report.resetContinuations;
  report.frameCountScope='Both builds: low-level PCM frames or resampled engine output frames, including own/cross-state/reset continuations; wrapper self-check frames excluded. Engine source frames are intentionally not counted as output frames.';
  report.passed=true;report.completedAt=new Date().toISOString();if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,lowLevelComparisons:report.cases.filter(c=>c.kind==='chip').length,engineComparisons:report.cases.filter(c=>c.kind==='engine').length,totalOutputStereoFrames:report.totalOutputStereoFrames,ownStateLoads:report.ownStateLoads,crossStateLoads:report.crossStateLoads,resetContinuations:report.resetContinuations,maximumDifference:0,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
