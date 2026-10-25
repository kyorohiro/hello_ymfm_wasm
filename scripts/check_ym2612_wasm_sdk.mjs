/** Compare two real YM2612 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ym2612} from '../web/ym2612.js';
import {opnPitchFromHz} from '../web/soundchip_pitch.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ym2612_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[3579545,7670454,8000000];
const rateClocks=[100000,3579545,3993600,7670454,8000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const checkpointFrame=2345,totalFrames=6144;
const requiredExports=['ym2612_create','ym2612_destroy','ym2612_reset','ym2612_write',
  'ym2612_read','ym2612_read_status','ym2612_get_irq','ym2612_sample_rate',
  'ym2612_generate','ym2612_generate_with_internal_envelope','ym2612_save_state','ym2612_load_state','malloc','free'];

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
    assert(!['ym2612_wasm.js','ym2612_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ym2612_wasm.js'),wasm=resolve(directory,'ym2612_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  const create=()=>Ym2612.create({moduleFactory:()=>module});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ym2612');assert(artifact,'YM2612 build receipt entry');
    for(const [name,record] of [['ym2612_wasm.js',metadata.javascript],['ym2612_wasm.wasm',metadata.wasm]]){
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
  const module=chip.module,size=module._ym2612_save_state(chip.handle,0);
  assert(Number.isInteger(size)&&size>0&&size<1048576,'Valid bounded serialized state size');
  const ptr=module._malloc(size);assert(ptr);
  try{assert.equal(module._ym2612_save_state(chip.handle,ptr),size);return new Uint8Array(module.HEAPF32.buffer,ptr,size).slice();}
  finally{module._free(ptr);}
}
function nativeLoad(chip,bytes,size=bytes.length){
  const module=chip.module,ptr=module._malloc(Math.max(1,bytes.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,bytes.length).set(bytes);return module._ym2612_load_state(chip.handle,ptr,size);}
  finally{module._free(ptr);}
}
const keyCode=channel=>channel<3?channel:channel+1;
function scenariosFor(clock){
  const scenarios=[];
  function scenario(name,build,{channel=0,timerMode=undefined}={}){
    let frame=0;const events=[];
    const add=(op,...args)=>events.push({frame,op,args});
    const write=(register,value,port=0)=>add('register',register,value,port);
    const pitch=(channel,midi)=>{
      const p=opnPitchFromHz(440*2**((midi-69)/12),clock,144),port=Math.floor(channel/3),off=channel%3;
      write(0xa4+off,(p.block<<3)|(p.fnum>>8),port);write(0xa0+off,p.fnum&255,port);
    };
    const fm=(channel=0,midi=69,algorithm=7,feedback=0,key=true)=>{
      const port=Math.floor(channel/3),off=channel%3;
      for(let slot=0;slot<4;slot++)for(const [r,v] of [[0x30,((slot&3)<<4)|(slot+1)],[0x40,slot===3?8:22+slot*7],
        [0x50,31-slot],[0x60,3+slot*2],[0x70,slot],[0x80,((2+slot)<<4)|(8+slot)],[0x90,0]])write(r+off+slot*4,v,port);
      write(0xb0+off,algorithm|(feedback<<3),port);write(0xb4+off,0xc0,port);pitch(channel,midi);
      if(key)write(0x28,0xf0|keyCode(channel));
    };
    // Remove any inherited DAC activity explicitly; reset itself is tested below.
    write(0x2b,0);write(0x27,0);write(0x22,0);
    build({add,write,pitch,fm,at:value=>{assert(Number.isInteger(value)&&value>=0&&value<totalFrames);frame=value;}});
    events.sort((a,b)=>a.frame-b.frame);
    assert(!events.some(e=>e.frame===checkpointFrame),'State checkpoint must precede, rather than repeat, an event');
    scenarios.push({name,clock,channel,timerMode,frames:totalFrames,events});
  }
  for(let channel=0;channel<6;channel++)for(let algorithm=0;algorithm<8;algorithm++){
    scenario(`channel${channel}/algorithm${algorithm}/feedback${algorithm}`,({fm,write,pitch,at})=>{
      const port=Math.floor(channel/3),off=channel%3;fm(channel,43+channel*6,algorithm,algorithm);
      at(701);write(0x40+off,35,port);at(1703);write(0x34+off,7,port);
      at(2801);pitch(channel,79);at(3901);write(0x28,keyCode(channel));at(5101);write(0x28,0xf0|keyCode(channel));
    },{channel});
  }
  for(let channel=0;channel<6;channel++)scenario(`channel${channel}/all-SSG-EG-shapes`,({fm,write,at})=>{
    fm(channel,48+channel*4,7,3);const port=Math.floor(channel/3),off=channel%3;
    for(let shape=0;shape<16;shape++){
      at(shape*347);for(let slot=0;slot<4;slot++){write(0x90+off+slot*4,shape,port);write(0x60+off+slot*4,16+slot,port);}
      write(0x28,keyCode(channel));write(0x28,0xf0|keyCode(channel));
    }
  },{channel});
  for(let frequency=0;frequency<8;frequency++)scenario(`six-channels/LFO${frequency}/AM-PM-stereo`,({fm,write,at})=>{
    for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,ch%8,ch%8);write(0x22,8|frequency);
    for(let step=0;step<8;step++){
      at(101+step*701);for(let ch=0;ch<6;ch++){
        write(0xb4+ch%3,(((ch+step)%4)<<6)|((step%4)<<4)|step,Math.floor(ch/3));
        for(let slot=0;slot<4;slot++)write(0x60+ch%3+slot*4,0x84,Math.floor(ch/3));
      }
    }
  },{channel:frequency%6});
  for(const mode of [5,10,15,0x45,0x85])scenario(`timer-status-IRQ/CSM/mode${mode}`,({fm,write,at})=>{
    fm(2,60,7,3,mode!==0x85);write(0x24,255);write(0x25,3);write(0x26,253);write(0x27,mode);
    at(701);write(0x27,0x30);at(1703);write(0x27,mode);at(2801);write(0x27,0x30);
    at(3901);write(0x24,249);write(0x27,mode);at(5101);write(0x27,0x30);
  },{channel:2,timerMode:mode});
  scenario('all-key-masks/invalid-channel-codes/both-ports',({fm,write,at})=>{
    for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,0);
    for(let mask=0;mask<16;mask++){at(mask*347);write(0x28,(mask<<4)|keyCode(mask%6));write(0x28,0xf3);write(0x28,0xf7);}
  });
  scenario('channel3-special-frequency/shared-cross-port-latches',({fm,write,at})=>{
    for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,3);write(0x27,0x40);
    for(let slot=0;slot<3;slot++){write(0xac+slot,0x20+slot*3);write(0xa8+slot,0x31+slot*71);}
    at(701);write(0xa4,0x21);write(0xa1,0x91,1);at(1703);write(0xa6,0x2a,1);write(0xa0,0x41);
    at(2801);write(0xad,0x29,1);write(0xa8,0x69);at(3901);write(0x27,0);at(5101);write(0x27,0x40);
  },{channel:2});
  scenario('DAC/all-256-codes/9th-bit/FM-coexistence',({fm,write,at})=>{
    for(let ch=0;ch<6;ch++)fm(ch,43+ch*7,7,1);write(0x2b,0x80);
    for(let code=0;code<256;code++){at(code*23);write(0x2a,code);write(0x2c,code&1?8:0);}
  },{channel:5});
  scenario('DAC/channel6-pan/enable-edges',({fm,write,at})=>{
    fm(5,60,7,3);write(0x2a,0xe0);write(0x2b,0x80);
    at(701);write(0xb6,0x80,1);at(1703);write(0xb6,0x40,1);at(2801);write(0xb6,0,1);
    at(3901);write(0x2b,0);at(5101);write(0xb6,0xc0,1);write(0x2b,0x80);write(0x2a,0x20);
  },{channel:5});
  scenario('reset/active-DAC/timers/reprogram/retained-latch',({fm,write,at,add})=>{
    fm(2,60,7,3);write(0x2a,255);write(0x2b,128);write(0x24,255);write(0x25,3);write(0x27,0x85);
    at(701);add('reset');at(1703);write(0xb6,0xc0,1);at(2801);add('reset');
    at(3901);write(0x2b,0);fm(1,76,7);at(5101);write(0x2a,0x20);write(0x2b,128);
  },{channel:2});
  scenario('pending-address-latch/saved-state/both-banks',({fm,write,at,add})=>{
    fm(0,60,7,2);fm(4,72,3,5);
    at(701);add('bus',0,0x40);add('bus',1,37);at(1703);add('bus',2,0x45);add('bus',3,29);
    at(2309);add('bus',2,0x45);at(2801);add('bus',3,9);at(3901);write(0x28,0);at(5101);write(0x28,0xf0);
  },{channel:4});
  scenario('register-extremes/attack0/rate-scaling/detune/multiplier0',({fm,write,at})=>{
    fm(0,48,7,7);
    for(let step=0;step<16;step++){
      at(step*347);for(let slot=0;slot<4;slot++){
        write(0x30+slot*4,((step%8)<<4)|step);write(0x50+slot*4,((step%4)<<6)|(step===0?0:31-step));
        write(0x70+slot*4,step*2);write(0x80+slot*4,(step<<4)|(15-step));
      }
      write(0x28,0);write(0x28,0xf0);
    }
  });
  return scenarios;
}
function readObservation(chip,frame){
  return {frame,status:chip.readStatus(),irq:chip.getIrq(),ports:[0,1,2,3].map(offset=>chip.read(offset))};
}
function execute(chip,scenario,layout,{start=0,method='envelope',saveCheckpoint=false}={}){
  const frames=scenario.frames-start,left=new Float32Array(frames),right=new Float32Array(frames);
  const envelopes=method==='envelope'?Array.from({length:4},()=>new Float32Array(frames)):undefined;
  const hooks=[],observations=[];let frame=start,hookFrame=start,index=0,next=0,saved;
  while(next<scenario.events.length&&scenario.events[next].frame<start)next++;
  chip.setHooks({onWrite:event=>hooks.push({frame:hookFrame,type:'write',...event}),onRead:event=>hooks.push({frame:hookFrame,type:'read',...event}),onIrq:asserted=>hooks.push({frame:hookFrame,type:'irq',asserted})});
  const initialObservation=readObservation(chip,start);
  while(frame<scenario.frames){
    hookFrame=frame;
    while(next<scenario.events.length&&scenario.events[next].frame===frame){
      const event=scenario.events[next++];
      if(event.op==='register')chip.writeRegister(...event.args);
      else if(event.op==='bus')chip.write(...event.args);
      else if(event.op==='reset')chip.reset();
      else throw Error('Unknown fixture event '+event.op);
    }
    if(saveCheckpoint&&frame===checkpointFrame){
      const count=hooks.length,opaque=chip.saveState(),bytes=nativeSave(chip);
      assert.equal(hooks.length,count,'Saving state is observational');assert.equal(opaque.byteLength,bytes.length);
      saved={opaque,bytes};
    }
    let end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity);
    if(saveCheckpoint&&frame<checkpointFrame)end=Math.min(end,checkpointFrame);
    const count=end-frame;assert(count>0,'Fixture advances');
    // The wrapper checks IRQ after generation, at the chunk's end boundary.
    hookFrame=end;
    const result=method==='envelope'?chip.generateStereoWithInternalEnvelope(count,scenario.channel)
      :method==='view'?chip.generateStereoView(count):chip.generateStereo(count);
    assert(!result?.then,'Generation must remain synchronous');
    left.set(result.left.subarray(0,count),frame-start);right.set(result.right.subarray(0,count),frame-start);
    if(envelopes)for(let slot=0;slot<4;slot++)envelopes[slot].set(result.envelopes[slot],frame-start);
    frame=end;observations.push(readObservation(chip,frame));
  }
  for(const values of [left,right,...(envelopes??[])])for(const value of values)assert(Number.isFinite(value),'Finite PCM/envelope');
  if(envelopes)for(const values of envelopes)for(const value of values)assert(value>=0&&value<=1,'Normalized internal attenuation');
  const endState=nativeSave(chip);
  // A later reset/load must not append callbacks to this completed trace.
  chip.setHooks();
  return {left,right,envelopes,initialObservation,observations,hooks,saved,endState};
}
function compareResult(actual,expected,label,{offset=0,observations=true}={}){
  for(const name of ['left','right'])sameBytes(actual[name],expected[name].subarray(offset),`${label}/${name}`);
  if(actual.envelopes&&expected.envelopes)for(let slot=0;slot<4;slot++)sameBytes(actual.envelopes[slot],expected.envelopes[slot].subarray(offset),`${label}/envelope${slot}`);
  sameBytes(actual.endState,expected.endState,`${label}/end-state`);
  if(observations){assert.deepEqual(actual.initialObservation,expected.initialObservation,`${label}/initial-read-status-IRQ`);assert.deepEqual(actual.observations,expected.observations,`${label}/read-status-IRQ`);assert.deepEqual(actual.hooks,expected.hooks,`${label}/synchronous-hooks`);}
}
function compareContinuation(actual,expected,label){
  compareResult(actual,expected,label,{offset:checkpointFrame,observations:false});
  assert.deepEqual(actual.initialObservation,expected.observations.find(row=>row.frame===checkpointFrame),`${label}/immediate-restored-read-status-IRQ`);
  assert.deepEqual(actual.observations,expected.observations.filter(row=>row.frame>checkpointFrame),`${label}/continued-read-status-IRQ`);
  // Installing the replay observers reports the restored line once. Compare
  // subsequent events with the original run after that checkpoint boundary.
  assert.deepEqual(actual.hooks.filter(row=>row.frame>checkpointFrame),expected.hooks.filter(row=>row.frame>checkpointFrame),`${label}/continued-synchronous-hooks`);
}
function pcmDigest(result){
  const hash=createHash('sha256');for(const array of [result.left,result.right,...(result.envelopes??[])])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');
}
async function wrapperChecks(backend){
  const chip=await backend.create(),other=await backend.create();
  try{
    assert(chip.supportsState());const state=nativeSave(chip),rates={};
    for(const clock of rateClocks){const value=chip.sampleRate(clock);assert.equal(value,Math.floor(clock/144));rates[clock]=value;assert(!value?.then);}
    sameBytes(nativeSave(chip),state,'sampleRate queries are observational');
    chip.reserveStereoFrames(4096);sameBytes(nativeSave(chip),state,'reserve is observational');
    for(const method of ['generateStereo','generateStereoView','generateStereoWithInternalEnvelope']){
      const result=chip[method](0);assert(!result?.then);assert.equal(result.left.length>=0,true);sameBytes(nativeSave(chip),state,'zero-frame generation');
      for(const invalid of [-1,.5,Infinity,0x1000001])assert.throws(()=>chip[method](invalid),RangeError);
    }
    sameBytes(nativeSave(chip),state,'invalid requests are observational');
    const opaque=chip.saveState();assert.throws(()=>other.loadState(opaque),/foreign/);assert.throws(()=>chip.loadState({byteLength:opaque.byteLength}),/foreign/);
    assert.equal(chip.module._ym2612_load_state(chip.handle,0,state.length),0);
    assert.equal(nativeLoad(chip,state,state.length-1),0);assert.equal(nativeLoad(chip,new Uint8Array(state.length+1),state.length+1),0);
    sameBytes(nativeSave(chip),state,'wrong native state sizes reject without mutation');
    const scenario=scenariosFor(7670454)[0];
    const withEnvelope=execute(chip,scenario,layouts.irregular);
    assert.equal(nativeLoad(other,state),1);const normal=execute(other,scenario,layouts.irregular,{method:'stereo'});
    compareResult(normal,withEnvelope,'plain/debug generation equivalence');
    chip.loadState(opaque);const view=execute(chip,scenario,layouts.irregular,{method:'view'});
    compareResult(view,normal,'borrowed-view/copied generation equivalence');
    const held=chip.generateStereo(17),copy={left:held.left.slice(),right:held.right.slice()};
    chip.reserveStereoFrames(8192);chip.generateStereoWithInternalEnvelope(4097,5);
    sameBytes(held.left,copy.left,'owned left survives heap/buffer reuse');sameBytes(held.right,copy.right,'owned right survives heap/buffer reuse');
    chip.reset();const resetResult=execute(chip,scenario,layouts.irregular);
    return {passed:true,rates,stateBytes:state.length,borrowedAndCopiedAndEnvelopePcmEqual:true,opaqueForeignStatesRejected:true,
      wrongNativeStateSizesRejected:true,zeroFramesAndReserveObservational:true,synchronousIoAndGeneration:true,resetPcmSha256:pcmDigest(resetResult)};
  }finally{chip.dispose();chip.dispose();other.dispose();other.dispose();}
}

async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);
  assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'WASM export surface unchanged');
  const wrapperPaths=['web/ym2612.js','docs/js/ym2612.js'];
  sameBytes(await readFile(resolve(root,wrapperPaths[0])),await readFile(resolve(root,wrapperPaths[1])),'Web/deployed JS wrapper synchronized');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),
    method:'Actual generated JS factories and WASM, synchronous public Ym2612 wrapper, byte-exact PCM and four physical-slot envelope traces. No tolerance, gain, clipping, resampling or emulation mock.',
    clocks,layouts,checkpointFrame,inputs:{legacy:legacy.metadata,sdk:sdk.metadata,
      checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrapperPaths.map(p=>inputFile(resolve(root,p)))),pitch:await inputFile(resolve(root,'web/soundchip_pitch.js'))},
    wrapperChecks:{},cases:[],totalStereoFrames:0,totalEnvelopeValues:0,crossStateLoads:0,ownStateLoads:0,resetContinuations:0,maximumDifference:0,
    limits:['Clock changes are sampleRate queries and pitch-register quantization; this low-level chip does not contain an output resampler.',
      'Raw state bytes are tested between these exact builds only. The public JS opaque snapshot still rejects foreign wrapper instances.',
      'Read/status/IRQ observations are at every rendered chunk boundary, plus synchronous write/read/IRQ hooks; not a per-master-clock bus trace.',
      'No browser, Worklet scheduling, Native backend, Mixer, device or listening judgement is exercised.']};
  report.wrapperChecks.legacy=await wrapperChecks(legacy);report.wrapperChecks.sdk=await wrapperChecks(sdk);
  assert.deepEqual(report.wrapperChecks.sdk,report.wrapperChecks.legacy,'Wrapper/reset behavior unchanged');
  for(const clock of clocks)for(const scenario of scenariosFor(clock)){
    let regular;
    for(const [layoutName,layout] of Object.entries(layouts)){
      const a=await legacy.create(),b=await sdk.create();
      try{
        const left=execute(a,scenario,layout,{saveCheckpoint:true}),right=execute(b,scenario,layout,{saveCheckpoint:true});
        compareResult(right,left,`${scenario.name}/${clock}/${layoutName}`);
        sameBytes(right.saved.bytes,left.saved.bytes,'cross-build checkpoint bytes');
        if(regular)compareResult(left,regular,'chunk partition invariance',{observations:false});else regular=left;
        const peak=Math.max(...left.left.map(Math.abs),...left.right.map(Math.abs));assert(peak>1e-5,'Reference must produce nonzero PCM');
        assert(left.envelopes.some(values=>values.some(value=>value>0)),'Reference must expose active internal envelopes');
        if(scenario.timerMode!==undefined){
          const flag=scenario.timerMode&4?1:2;assert(left.observations.some(r=>(r.status&flag)!==0&&r.irq),'Enabled timer must set status and assert IRQ');
          assert(left.hooks.some(h=>h.type==='irq'&&h.asserted)&&left.hooks.some(h=>h.type==='irq'&&!h.asserted),'IRQ transitions observed');
        }
        if(layoutName==='regular'){
          for(const [chip,result,name] of [[a,left,'legacy'],[b,right,'sdk']]){
            chip.reset();chip.generateStereo(31);chip.loadState(result.saved.opaque);
            const restored=execute(chip,scenario,layout,{start:checkpointFrame});
            compareContinuation(restored,result,`${name}/opaque-save-load continuation`);
            report.ownStateLoads++;report.totalStereoFrames+=restored.left.length;report.totalEnvelopeValues+=restored.left.length*4;
          }
          assert.throws(()=>a.loadState(right.saved.opaque),/foreign/);assert.throws(()=>b.loadState(left.saved.opaque),/foreign/);
          for(const [chip,state,result,name] of [[a,right.saved.bytes,left,'sdk-to-legacy'],[b,left.saved.bytes,right,'legacy-to-sdk']]){
            chip.reset();chip.generateStereo(13);assert.equal(nativeLoad(chip,state),1,'Cross-build native state accepted');
            const restored=execute(chip,scenario,layout,{start:checkpointFrame});
            compareContinuation(restored,result,`${name}/native-state continuation`);
            report.crossStateLoads++;report.totalStereoFrames+=restored.left.length;report.totalEnvelopeValues+=restored.left.length*4;
          }
          a.reset();b.reset();const resetA=execute(a,scenario,layout),resetB=execute(b,scenario,layout);
          compareResult(resetB,resetA,'reset/reprogram continuation');report.resetContinuations+=2;
          report.totalStereoFrames+=scenario.frames*2;report.totalEnvelopeValues+=scenario.frames*8;
        }
        report.cases.push({name:scenario.name,clock,channel:scenario.channel,layout:layoutName,frames:scenario.frames,peak,
          pcmAndEnvelopeSha256:pcmDigest(left),stateBytes:left.saved.bytes.length,checkpointSha256:sha256(left.saved.bytes),
          endStateSha256:sha256(left.endState),observations:left.observations.length,synchronousHookEvents:left.hooks.length,maximumDifference:0});
        report.totalStereoFrames+=scenario.frames*2;report.totalEnvelopeValues+=scenario.frames*8;
      }finally{a.dispose();b.dispose();}
    }
  }
  report.scenariosPerClock=scenariosFor(clocks[0]).length;
  report.scenarioClockPairs=report.scenariosPerClock*clocks.length;
  report.scenarioRenderExecutions=report.cases.length*2+report.ownStateLoads+report.crossStateLoads+report.resetContinuations;
  report.frameCountScope='Case/layout renders plus own-state, cross-state and reset continuations, counting both builds; additional wrapper self-check frames are excluded.';
  report.passed=true;report.completedAt=new Date().toISOString();
  if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,totalStereoFrames:report.totalStereoFrames,totalEnvelopeValues:report.totalEnvelopeValues,
    crossStateLoads:report.crossStateLoads,ownStateLoads:report.ownStateLoads,resetContinuations:report.resetContinuations,maximumDifference:0,
    legacyWasmSha256:report.inputs.legacy.wasm.sha256,sdkWasmSha256:report.inputs.sdk.wasm.sha256,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
