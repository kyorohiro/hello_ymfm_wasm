/** Compare two real YM2203 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ym2203} from '../web/ym2203.js';
import {Ym2203AudioEngine} from '../web/ym2203audioengine.js';
import {opnPitchFromHz} from '../web/soundchip_pitch.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ym2203_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[3579545,4000000,8000000];
const rateClocks=[100000,3579545,3993600,7670454,8000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const checkpointFrame=2345,totalFrames=6144;
const requiredExports=['ym2203_create','ym2203_destroy','ym2203_reset','ym2203_write',
  'ym2203_read','ym2203_read_status','ym2203_get_irq','ym2203_sample_rate',
  'ym2203_generate','ym2203_set_mute_mask','ym2203_set_source_mute_mask','ym2203_save_state','ym2203_load_state','malloc','free'];

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
    assert(!['ym2203_wasm.js','ym2203_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ym2203_wasm.js'),wasm=resolve(directory,'ym2203_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  const create=()=>Ym2203.create({moduleFactory:()=>module});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ym2203');assert(artifact,'YM2203 build receipt entry');
    for(const [name,record] of [['ym2203_wasm.js',metadata.javascript],['ym2203_wasm.wasm',metadata.wasm]]){
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
  const module=chip.module,size=module._ym2203_save_state(chip.handle,0);
  assert(Number.isInteger(size)&&size>0&&size<1048576,'Valid bounded serialized state size');
  const ptr=module._malloc(size);assert(ptr);
  try{assert.equal(module._ym2203_save_state(chip.handle,ptr),size);return new Uint8Array(module.HEAPF32.buffer,ptr,size).slice();}
  finally{module._free(ptr);}
}
function nativeLoad(chip,bytes,size=bytes.length){
  const module=chip.module,ptr=module._malloc(Math.max(1,bytes.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,bytes.length).set(bytes);return module._ym2203_load_state(chip.handle,ptr,size);}
  finally{module._free(ptr);}
}
function scenariosFor(clock){
  const scenarios=[];
  function scenario(name,build,{timerMode=undefined,engine=false}={}){
    let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
    const write=(r,v)=>add('register',r,v);
    const pitch=(ch,midi)=>{const p=opnPitchFromHz(440*2**((midi-69)/12),clock,72);write(0xa4+ch,(p.block<<3)|(p.fnum>>8));write(0xa0+ch,p.fnum&255);};
    const fm=(ch=0,midi=69,algorithm=7,feedback=0,key=true)=>{
      for(let slot=0;slot<4;slot++)for(const [r,v] of [[0x30,((slot&3)<<4)|(slot+1)],[0x40,slot===3?14:28+slot*5],[0x50,31-slot],[0x60,3+slot*2],[0x70,slot],[0x80,0x2f],[0x90,0]])write(r+ch+slot*4,v);
      write(0xb0+ch,algorithm|(feedback<<3));pitch(ch,midi);if(key)write(0x28,0xf0|ch);
    };
    const ssg=(ch=0,period=127,level=11)=>{write(ch*2,period&255);write(ch*2+1,period>>8);write(8+ch,level);};
    write(7,0x3f);write(8,0);write(9,0);write(10,0);write(0x27,0);add('mute',0);add('source',0);
    build({add,write,pitch,fm,ssg,at:value=>{assert(Number.isInteger(value)&&value>=0&&value<totalFrames);frame=value;}});
    events.sort((a,b)=>a.frame-b.frame);assert(!events.some(e=>e.frame===checkpointFrame));
    scenarios.push({name,clock,timerMode,engine,frames:totalFrames,events});
  }
  for(let ch=0;ch<3;ch++)for(let algorithm=0;algorithm<8;algorithm++)scenario(`FM/channel${ch}/algorithm${algorithm}/feedback${algorithm}`,({fm,write,pitch,at})=>{
    fm(ch,48+ch*7,algorithm,algorithm);at(701);write(0x40+ch,35);at(1703);write(0x34+ch,7);at(2801);pitch(ch,79);at(3901);write(0x28,ch);at(5101);write(0x28,0xf0|ch);
  },{engine:ch===0&&algorithm===0});
  scenario('FM/all-key-masks/SSG-EG/invalid-key-codes',({fm,write,at})=>{
    for(let ch=0;ch<3;ch++)fm(ch,48+ch*7,7,3);
    for(let i=0;i<16;i++){at(i*347);for(let slot=0;slot<4;slot++)write(0x90+slot*4+i%3,i);write(0x28,(i<<4)|i%3);write(0x28,0xf3);write(0x28,0xf7);}
  });
  for(let ch=0;ch<3;ch++)scenario(`SSG/tone${ch}/period-zero-one/coarse-mask/fixed-levels`,({ssg,write,at})=>{
    write(7,0x3f^(1<<ch));ssg(ch,127+ch*103,15);at(701);write(ch*2,0);write(ch*2+1,0xf0);at(1703);write(ch*2,1);write(ch*2+1,0);at(2801);write(ch*2,255);write(ch*2+1,15);at(3901);write(8+ch,3);at(5101);write(8+ch,15);
  },{engine:ch===0});
  scenario('SSG/noise/all-periods/tone-noise-gates',({ssg,write,at})=>{
    for(let ch=0;ch<3;ch++)ssg(ch,127+ch*103,15-ch*2);
    for(let i=0;i<32;i++){at(i*173);write(6,i);write(7,((i&7)|((i&7)<<3))^0x15);}
  });
  for(let shape=0;shape<16;shape++)scenario(`SSG/envelope${shape}/three-voices/retrigger`,({ssg,write,at})=>{
    write(7,0x38);for(let ch=0;ch<3;ch++)ssg(ch,127+ch*103,16);write(11,3);write(12,0);write(13,shape);at(1703);write(11,7);at(3301);write(13,shape);at(5101);write(11,0);write(13,shape^4);
  });
  scenario('mixed/FM-SSG/mono-sum',({fm,ssg,write,at})=>{
    for(let ch=0;ch<3;ch++){fm(ch,48+ch*7,7);ssg(ch,127+ch*103,8+ch);}write(7,0x38);at(1703);write(7,0);write(6,9);at(2801);write(7,0x38);at(3901);write(11,3);write(13,10);at(5101);write(9,16);
  },{engine:true});
  scenario('mixed/source-mute-bit/legacy-FM-masks/unknown-bits',({fm,ssg,write,add,at})=>{
    for(let ch=0;ch<3;ch++){fm(ch,48+ch*7,7);ssg(ch,127+ch*103,11);}write(7,0x38);
    for(let i=0;i<8;i++){at(101+i*701);add('mute',i|(i&1?0xf8:0));add('source',i%4);}
  });
  scenario('prescaler/address-only/6-3-2/ignored-2E/pending-data',({fm,ssg,write,add,at})=>{
    for(let ch=0;ch<3;ch++){fm(ch,48+ch*7,7);ssg(ch,127+ch*103,11);}write(7,0x38);
    for(const [frame,r] of [[701,0x2e],[1703,0x2f],[2801,0x2e],[3901,0x2d],[5101,0x2e]]){at(frame);add('bus',0,r);}
    at(2309);add('bus',0,8);at(2800);add('bus',1,15);
  },{engine:true});
  scenario('SSG/data-read/direction/register-masks/pending-address',({fm,ssg,write,add,at})=>{
    fm();ssg();write(7,0xf8);write(14,0xaa);write(15,0x55);at(701);write(7,0x38);write(14,0x55);at(1703);write(15,0xaa);at(2309);add('bus',0,1);at(2801);add('bus',1,0xf1);at(3901);write(15,0xcc);at(5101);write(7,0xf8);
  });
  scenario('channel3-special/shared-high-latch/supplementary-frequency',({fm,write,at})=>{
    for(let ch=0;ch<3;ch++)fm(ch,48+ch*7,7,3);write(0x27,0x40);for(let i=0;i<3;i++){write(0xac+i,0x20+i*3);write(0xa8+i,0x31+i*71);}at(701);write(0xa4,0x21);write(0xa1,0x91);at(1703);write(0xa6,0x2a);write(0xa0,0x41);at(2801);write(0xad,0x29);write(0xa8,0x69);at(3901);write(0x27,0);at(5101);write(0x27,0x40);
  });
  for(const mode of [5,10,15,0x45,0x85])scenario(`timer/status-IRQ/CSM/mode${mode}`,({fm,write,at})=>{
    fm(2,60,7,3,mode!==0x85);write(0x24,255);write(0x25,3);write(0x26,253);write(0x27,mode);at(701);write(0x27,0x30);at(1703);write(0x27,mode);at(2801);write(0x27,0x30);at(3901);write(0x24,249);write(0x27,mode);at(5101);write(0x27,0x30);
  },{timerMode:mode});
  scenario('reset/prescale/timer/noise-envelope/masks/reprogram',({fm,ssg,write,add,at})=>{
    fm(2,60,7);ssg(0,127,16);write(7,0);write(6,9);write(11,3);write(13,10);write(0x24,255);write(0x25,3);write(0x27,0x85);at(701);add('bus',0,0x2f);at(1703);add('source',1);add('mute',5);add('reset');at(2801);add('source',0);add('mute',0);fm(1,72,7);ssg(2,31,15);write(7,0x38);at(3901);add('reset');at(5101);fm(0,60,7);ssg(1,127,11);write(7,0x38);
  });
  return scenarios;
}
const rawChip=actor=>actor.ym2203??actor;
const timing=actor=>actor.ym2203?[actor._resampleRemainder,actor._lastLeft,actor._lastRight]:null;
function readObservation(actor,frame,clock){const c=rawChip(actor);return {frame,nativeRate:c.sampleRate(clock),outputRate:actor===c?null:actor.sampleRate(),status:c.readStatus(),irq:c.getIrq(),ports:[0,1,2,3].map(offset=>c.read(offset))};}
function execute(actor,scenario,layout,{start=0,method='stereo',saveCheckpoint=false}={}){
  const chip=rawChip(actor),frames=scenario.frames-start,left=new Float32Array(frames),right=new Float32Array(frames);
  const hooks=[],observations=[];let frame=start,hookFrame=start,index=0,next=0,saved;
  while(next<scenario.events.length&&scenario.events[next].frame<start)next++;
  chip.setHooks({onWrite:e=>hooks.push({frame:hookFrame,type:'write',...e}),onRead:e=>hooks.push({frame:hookFrame,type:'read',...e}),onIrq:asserted=>hooks.push({frame:hookFrame,type:'irq',asserted})});
  const initialObservation=readObservation(actor,start,scenario.clock);
  while(frame<scenario.frames){
    hookFrame=frame;
    while(next<scenario.events.length&&scenario.events[next].frame===frame){
      const {op,args}=scenario.events[next++];
      if(op==='register'){chip.write(0,args[0]);chip.write(1,args[1]);}
      else if(op==='bus')chip.write(...args);
      else if(op==='reset')actor.reset();
      else if(op==='mute'){chip.setMuteMask(args[0]);if(actor!==chip)actor.channelMuteMask=args[0]&7;}
      else if(op==='source'){chip.setSourceMuteMask(args[0]);if(actor!==chip)actor._sourceMuteMask=args[0];}
      else throw Error(op);
    }
    if(saveCheckpoint&&frame===checkpointFrame){const count=hooks.length,opaque=actor.saveState(),bytes=nativeSave(chip);assert.equal(hooks.length,count);assert.equal(opaque.byteLength,bytes.length+(actor===chip?0:64));saved={opaque,bytes,timing:timing(actor)};}
    let end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity);
    if(saveCheckpoint&&frame<checkpointFrame)end=Math.min(end,checkpointFrame);
    const count=end-frame;assert(count>0);hookFrame=end;
    const pcm=actor!==chip?actor.processFrames(count):method==='view'?chip.generateStereoView(count):chip.generateStereo(count);
    assert(!pcm?.then);left.set(pcm.left.subarray(0,count),frame-start);right.set(pcm.right.subarray(0,count),frame-start);
    frame=end;observations.push(readObservation(actor,frame,scenario.clock));
  }
  for(const values of [left,right])for(const value of values)assert(Number.isFinite(value));
  sameBytes(left,right,'YM2203 mono must reach both output sides');
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
    assert(chip.supportsState());const state=nativeSave(chip),rates={};
    for(const clock of rateClocks){const n=chip.sampleRate(clock);assert.equal(n,Math.floor(clock/4));rates[clock]=n;}
    sameBytes(nativeSave(chip),state,'sampleRate is observational');chip.reserveStereoFrames(4096);sameBytes(nativeSave(chip),state,'reserve is observational');
    for(const method of ['generateStereo','generateStereoView']){chip[method](0);sameBytes(nativeSave(chip),state,'zero-frame generation');for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>chip[method](n),RangeError);}
    const opaque=chip.saveState();assert.throws(()=>other.loadState(opaque),/foreign/);assert.throws(()=>chip.loadState({byteLength:opaque.byteLength}),/foreign/);
    assert.equal(chip.module._ym2203_load_state(chip.handle,0,state.length),0);assert.equal(nativeLoad(chip,state,state.length-1),0);assert.equal(nativeLoad(chip,new Uint8Array(state.length+1),state.length+1),0);sameBytes(nativeSave(chip),state,'bad state sizes do not mutate');
    const scenario=scenariosFor(4000000)[0],copied=execute(chip,scenario,layouts.irregular);
    assert.equal(nativeLoad(other,state),1);compareResult(execute(other,scenario,layouts.irregular,{method:'view'}),copied,'copied/view generation');
    chip.loadState(opaque);chip.write(0,0x2e);const prescaleState=nativeSave(chip);assert.notEqual(sha256(prescaleState),sha256(state),'Prescaler address alone changes state');for(const clock of rateClocks)assert.equal(chip.sampleRate(clock),rates[clock],'Prescaler does not change native PCM output rate');
    chip.loadState(opaque);const mix=scenariosFor(4000000).find(s=>s.name==='mixed/FM-SSG/mono-sum');
    // Configure, then snapshot one stable mixed voice. Mutes must suppress only
    // output and retain phase; unknown source bits and public high FM bits match.
    for(const e of mix.events.filter(e=>e.frame===0)){if(e.op==='register'){chip.write(0,e.args[0]);chip.write(1,e.args[1]);}}
    chip.generateStereo(499);const mixedState=nativeSave(chip);
    const render=(fmMask,sourceMask)=>{assert.equal(nativeLoad(chip,mixedState),1);chip.setMuteMask(fmMask);chip.setSourceMuteMask(sourceMask);chip.generateStereo(37);return chip.generateStereo(701);};
    const all=render(0,0),fm=render(0,1),ssg=render(7,0),silent=render(0xff,1),unknown=render(0,2),highMask=render(0xf8,0);
    sameBytes(unknown.left,all.left,'unknown source bits do not mute FM/SSG');sameBytes(highMask.left,all.left,'public legacy FM mask keeps only low3 bits');
    assert(silent.left.every(v=>v===0),'combined FM/SSG mute is silent');assert(fm.left.some(v=>v!==0)&&ssg.left.some(v=>v!==0),'both independent source sections sound');
    // This authored level stays below clipping, making mono section sum exact.
    for(let i=0;i<all.left.length;i++)assert.equal(all.left[i],fm.left[i]+ssg.left[i],'FM plus SSG is mixed exactly once');
    const owned=chip.generateStereo(17),held=owned.left.slice();chip.reserveStereoFrames(8192);chip.generateStereo(4097);sameBytes(owned.left,held,'owned PCM survives buffer reuse');
    return {passed:true,rates,stateBytes:state.length,copyViewEqual:true,sourceMasksAndMonoSectionSum:true,prescalerAddressSideEffect:true,foreignOpaqueStatesRejected:true,invalidStateSizesRejected:true};
  }finally{chip.dispose();chip.dispose();other.dispose();other.dispose();}
}

async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');
  const wrappers=['web/ym2203.js','docs/js/ym2203.js','web/ym2203audioengine.js','docs/js/ym2203audioengine.js'];
  // Deployment adds cache-version suffixes to these two relative module paths,
  // including JSDoc imports. Everything else must remain byte-identical.
  const normalized=bytes=>bytes.toString().replace(/(\.\/(?:ym2203|soundchip)\.js)\?v=[^"'\s)]+/g,'$1');
  for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,layouts,checkpointFrame,
    method:'Actual generated JS/WASM and unchanged synchronous Ym2203 wrapper/AudioEngine. Exact mono stereo PCM, rate/status/IRQ/read/hooks, state bytes, resampler remainder/held samples; no tolerance, mock, Mixer or output device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),pitch:await inputFile(resolve(root,'web/soundchip_pitch.js'))},
    wrapperSync:'Byte-identical after removing only deployed ym2203.js/soundchip.js import cache suffixes; actual file hashes retained.',
    wrapperChecks:{},cases:[],totalOutputStereoFrames:0,ownStateLoads:0,crossStateLoads:0,resetContinuations:0,maximumDifference:0,
    limits:['Native YM2203 PCM runs at clock/4 regardless of the6/3/2 prescaler; the prescaler changes internal FM/SSG timing. Engine cases separately report output rate and averaging/holding.',
      'Cross-build raw states are tested for these exact builds only; opaque public snapshots remain owner-restricted.',
      'Status/IRQ/read hooks are sampled at chunk boundaries. AudioEngine internally invokes the same wrapper per output sample; generation callbacks are labeled by the enclosing chunk boundary.',
      'No Worklet scheduling, physical hardware, browser, Native backend, Mixer or listening judgement is tested.']};
  report.wrapperChecks.legacy=await wrapperChecks(legacy);report.wrapperChecks.sdk=await wrapperChecks(sdk);assert.deepEqual(report.wrapperChecks.sdk,report.wrapperChecks.legacy);
  const jobs=[];
  for(const clock of clocks)for(const scenario of scenariosFor(clock)){
    jobs.push({...scenario,kind:'chip',outputRate:null});
    if(scenario.engine)for(const outputRate of [44100,48000,96000,1500000])jobs.push({...scenario,kind:'engine',outputRate,frames:3072,events:scenario.events.filter(e=>e.frame<3072)});
  }
  for(const scenario of jobs){
    let regular;
    for(const [layoutName,layout] of Object.entries(layouts)){
      const make=async backend=>{const chip=await backend.create();return scenario.kind==='chip'?chip:new Ym2203AudioEngine(chip,chip.sampleRate(scenario.clock),scenario.outputRate,1);};
      const a=await make(legacy),b=await make(sdk),label=`${scenario.kind}/${scenario.name}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
      try{
        const x=execute(a,scenario,layout,{saveCheckpoint:true}),y=execute(b,scenario,layout,{saveCheckpoint:true});compareResult(y,x,label);sameBytes(y.saved.bytes,x.saved.bytes,'Checkpoint bytes compatible');
        if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        let peak=0;for(const v of x.left)peak=Math.max(peak,Math.abs(v));assert(peak>1e-5,`${label}: audible reference`);
        if(scenario.timerMode!==undefined){const flag=scenario.timerMode&4?1:2;assert(x.observations.some(r=>(r.status&flag)&&r.irq),`${label}: timer must assert status/IRQ`);}
        if(layoutName==='regular'){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){
            actor.reset();if(actor.ym2203)actor.processFrames(31);else actor.generateStereo(31);
            actor.loadState(result.saved.opaque);const restored=execute(actor,scenario,layout,{start:checkpointFrame});compareContinuation(restored,result,`${name}/opaque`);report.ownStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          assert.throws(()=>a.loadState(y.saved.opaque),/foreign|Incompatible/);assert.throws(()=>b.loadState(x.saved.opaque),/foreign|Incompatible/);
          for(const [actor,state,result,name] of [[a,y.saved,x,'sdk-to-legacy'],[b,x.saved,y,'legacy-to-sdk']]){
            actor.reset();assert.equal(nativeLoad(rawChip(actor),state.bytes),1);
            if(actor.ym2203)[actor._resampleRemainder,actor._lastLeft,actor._lastRight]=state.timing;
            const restored=execute(actor,scenario,layout,{start:checkpointFrame});compareContinuation(restored,result,`${name}/raw-state`);report.crossStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          a.reset();b.reset();compareResult(execute(b,scenario,layout),execute(a,scenario,layout),'Reset/reprogram');report.resetContinuations+=2;report.totalOutputStereoFrames+=scenario.frames*2;
        }
        report.cases.push({name:scenario.name,kind:scenario.kind,clock:scenario.clock,nativeRate:Math.floor(scenario.clock/4),outputRate:scenario.outputRate,layout:layoutName,frames:scenario.frames,peak,pcmSha256:pcmDigest(x),checkpointSha256:sha256(x.saved.bytes),stateBytes:x.saved.bytes.length,endStateSha256:sha256(x.endState),observations:x.observations.length,hookEvents:x.hooks.length,maximumDifference:0});report.totalOutputStereoFrames+=scenario.frames*2;
      }finally{a.dispose();b.dispose();}
    }
  }
  report.scenariosPerClock=scenariosFor(clocks[0]).length;report.scenarioConfigurations=jobs.length;report.scenarioRenderExecutions=report.cases.length*2+report.ownStateLoads+report.crossStateLoads+report.resetContinuations;
  report.frameCountScope='Both builds: low-level PCM frames or resampled engine output frames, including own/cross-state/reset continuations; wrapper self-check frames excluded. Engine source frames are intentionally not counted as output frames.';
  report.passed=true;report.completedAt=new Date().toISOString();if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,lowLevelComparisons:report.cases.filter(c=>c.kind==='chip').length,engineComparisons:report.cases.filter(c=>c.kind==='engine').length,totalOutputStereoFrames:report.totalOutputStereoFrames,ownStateLoads:report.ownStateLoads,crossStateLoads:report.crossStateLoads,resetContinuations:report.resetContinuations,maximumDifference:0,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
