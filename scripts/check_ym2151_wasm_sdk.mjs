/** Compare two real YM2151 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ym2151} from '../web/ym2151.js';
import {Ym2151AudioEngine} from '../web/ym2151audioengine.js';
import {opmPitchFromHz} from '../web/soundchip_pitch.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ym2151_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[3579545,4000000,8000000];
const variants=['ym2151','ym2164'];
const rateClocks=[100000,3579545,3993600,7670454,8000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const checkpointFrame=2345,totalFrames=6144;
const requiredExports=['ym2151_create','ym2164_create','ym2151_destroy','ym2151_reset','ym2151_write',
  'ym2151_read','ym2151_read_status','ym2151_get_irq','ym2151_sample_rate',
  'ym2151_generate','ym2151_set_mute_mask','ym2151_save_state','ym2151_load_state','malloc','free'];

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
    assert(!['ym2151_wasm.js','ym2151_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ym2151_wasm.js'),wasm=resolve(directory,'ym2151_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  const create=(variant='ym2151')=>Ym2151.create({moduleFactory:()=>module,variant});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ym2151');assert(artifact,'YM2151 build receipt entry');
    for(const [name,record] of [['ym2151_wasm.js',metadata.javascript],['ym2151_wasm.wasm',metadata.wasm]]){
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
  const module=chip.module,size=module._ym2151_save_state(chip.handle,0);
  assert(Number.isInteger(size)&&size>0&&size<1048576,'Valid bounded serialized state size');
  const ptr=module._malloc(size);assert(ptr);
  try{assert.equal(module._ym2151_save_state(chip.handle,ptr),size);return new Uint8Array(module.HEAPF32.buffer,ptr,size).slice();}
  finally{module._free(ptr);}
}
function nativeLoad(chip,bytes,size=bytes.length){
  const module=chip.module,ptr=module._malloc(Math.max(1,bytes.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,bytes.length).set(bytes);return module._ym2151_load_state(chip.handle,ptr,size);}
  finally{module._free(ptr);}
}
// Register slots are M1,C1,M2,C2. Every voice deliberately uses all four
// physical slots, while independent key-mask cases enumerate the bus bits.
function scenariosFor(clock){
  const scenarios=[];
  function scenario(name,build,{checkpoint=false,engine=false,timerMode}={}){
    let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
    const write=(r,v)=>add('register',r,v);
    const pitch=(ch,midi)=>{const p=opmPitchFromHz(440*2**((midi-69)/12),clock);write(0x28+ch,p.keyCode);write(0x30+ch,p.keyFraction<<2);};
    const fm=(ch=0,midi=60,algorithm=7,feedback=0,key=true)=>{
      for(let slot=0;slot<4;slot++)for(const [r,v] of [[0x40,((slot&3)<<4)|(slot+1)],[0x60,24+slot*5],[0x80,31-slot],[0xa0,4+slot],[0xc0,slot],[0xe0,0x2f]])write(r+ch+slot*8,v);
      write(0x20+ch,0xc0|(feedback<<3)|algorithm);write(0x38+ch,0);pitch(ch,midi);if(key)write(8,0x78|ch);
    };
    write(0x14,0x30);write(0x0f,0);write(0x18,0);write(0x19,0);write(0x19,128);write(0x1b,0);add('mute',0);
    build({add,write,pitch,fm,at:value=>{assert(Number.isInteger(value)&&value>=0&&value<totalFrames);frame=value;}});
    events.sort((a,b)=>a.frame-b.frame);assert(!events.some(e=>e.frame===checkpointFrame));
    scenarios.push({name,clock,checkpoint,engine,timerMode,frames:totalFrames,events});
  }
  for(let ch=0;ch<8;ch++)for(let algorithm=0;algorithm<8;algorithm++)scenario(`FM/channel${ch}/algorithm${algorithm}/feedback${algorithm}`,({fm,write,pitch,at})=>{
    fm(ch,48+ch*4,algorithm,algorithm);at(701);write(0x48+ch,0x67);at(1703);write(0x90+ch,23);at(2801);pitch(ch,72+ch);at(3901);write(8,ch);at(5101);write(8,0x78|ch);
  },{checkpoint:ch===0&&algorithm===0,engine:ch===0&&algorithm===0});
  scenario('FM/all-operator-key-masks/eight-channels',({fm,write,at})=>{
    for(let ch=0;ch<8;ch++)fm(ch,48+ch*4,7,ch%8);
    for(let mask=0;mask<16;mask++){at(mask*347);write(8,(mask<<3)|(mask%8));}
  });
  for(let waveform=0;waveform<4;waveform++)scenario(`LFO/waveform${waveform}/independent-AMD-PMD/AM-PM`,({fm,write,at})=>{
    for(const ch of [0,3,7]){fm(ch,48+ch*4,5,5);write(0x38+ch,0x73);for(let slot=0;slot<4;slot++)write(0xa0+slot*8+ch,0x84+slot);}
    write(0x18,237);write(0x19,67);write(0x19,128|93);write(0x1b,0xc0|waveform);
    at(701);write(0x19,13);at(1703);write(0x19,128|27);at(2801);write(0x18,255);at(3901);write(0x19,127);write(0x19,255);at(5101);write(0x18,7);
  },{checkpoint:waveform===3,engine:waveform===3});
  for(let period=0;period<32;period++)scenario(`noise/channel7/period${period}/carrier-and-other-operators`,({fm,write,at})=>{
    fm(7,67,7,3);write(0x0f,0x80|period);at(701);write(0x7f,15);at(1703);write(0x0f,period);at(2801);write(0x0f,0x80|period);at(3901);write(8,7);at(5101);write(8,0x78|7);
  },{checkpoint:period===0||period===31,engine:period===31});
  scenario('pan/eight-channels/left-right-both-none',({fm,write,at})=>{
    for(let ch=0;ch<8;ch++){fm(ch,48+ch*4,7);write(0x20+ch,[0x47,0x87,0xc7,7][ch%4]);}
    for(let i=0;i<6;i++){at(101+i*877);for(let ch=0;ch<8;ch++)write(0x20+ch,[0x47,0x87,0xc7,7][(i+ch)%4]);}
  },{checkpoint:true});
  scenario('mute/eight-channels/low8-bits/unknown-high-bits',({fm,add,at})=>{
    for(let ch=0;ch<8;ch++)fm(ch,48+ch*4,7);
    for(let i=0;i<8;i++){at(101+i*701);add('mute',(1<<i)|(i&1?0xff00:0));}
  },{checkpoint:true});
  scenario('pending-address/even-odd-bus-aliases/KC-KF/CT-lines',({fm,write,add,at})=>{
    fm();at(701);add('bus',2,0x28);add('bus',3,0x45);at(1703);write(0x1b,0xc3);
    at(2309);add('bus',0,0x30);at(2801);add('bus',1,0xfc);at(3901);add('bus',2,0x20);at(5101);add('bus',3,0x87);
  },{checkpoint:true,engine:true});
  for(const mode of [5,10,15,0x85,0x8f])scenario(`timer/status-IRQ/CSM/mode${mode}`,({fm,write,at})=>{
    fm(2,60,7,3);write(0x10,255);write(0x11,3);write(0x12,253);write(0x14,mode);
    at(701);write(0x14,0x30);at(1703);write(0x14,mode);at(2801);write(0x14,0x30);at(3901);write(0x10,249);write(0x14,mode);at(5101);write(0x14,0x30);
  },{checkpoint:mode===5||mode===10||mode===0x85,timerMode:mode});
  scenario('CSM/all-eight-channels/no-ordinary-key-on',({fm,write,at})=>{
    for(let ch=0;ch<8;ch++)fm(ch,48+ch*4,7,ch%8,false);write(0x10,255);write(0x11,3);write(0x14,0x85);
    at(701);write(0x10,249);at(1703);write(0x14,0x95);at(2801);write(0x14,0);at(3901);write(0x14,0x85);at(5101);write(0x14,0x30);
  },{checkpoint:true,timerMode:0x85});
  scenario('LFO/test-register/reset-hold/restart',({fm,write,at})=>{
    fm(0,60,5,3);write(0x38,0x73);write(0xa0,0x84);write(0xb8,0x87);write(0x18,237);write(0x19,93);write(0x19,221);write(0x1b,3);
    at(701);write(1,2);at(1703);write(1,0);at(2801);write(1,2);at(3901);write(1,0);at(5101);write(0x1b,1);
  });
  scenario('reset/public-power-on/raw-core/free-running-LFO-noise/mute',({fm,write,add,at})=>{
    fm(7,67,7);write(0x0f,0x91);write(0x18,237);write(0x19,93);write(0x19,221);write(0x1b,3);write(0x10,255);write(0x11,3);write(0x14,0x85);
    at(701);add('mute',0x80);add('raw-reset');at(1703);add('reset');add('mute',0);fm(7,67,7);write(0x0f,0x91);
    at(2801);add('raw-reset');at(3901);add('reset');at(5101);fm(0,60,7);
  },{checkpoint:true});
  return scenarios;
}
const rawChip=actor=>actor.ym2151??actor;
const timing=actor=>actor.ym2151?[actor.remainder,actor.lastLeft,actor.lastRight]:null;
function readObservation(actor,frame,clock){const c=rawChip(actor);return {frame,nativeRate:c.sampleRate(clock),outputRate:actor===c?null:actor.sampleRate(),status:c.readStatus(),irq:c.getIrq(),ports:[0,1,2,3].map(offset=>c.read(offset))};}
function execute(actor,scenario,layout,{start=0,saveCheckpoint=false}={}){
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
      else if(op==='raw-reset')chip.api.reset(chip.handle);
      else if(op==='mute')chip.setMuteMask(args[0]);
      else throw Error(op);
    }
    if(saveCheckpoint&&frame===checkpointFrame){const count=hooks.length,opaque=actor.saveState(),bytes=nativeSave(chip);assert.equal(hooks.length,count);assert.equal(opaque.byteLength,bytes.length+(actor===chip?0:64));saved={opaque,bytes,timing:timing(actor),muteMask:chip.muteMask};}
    let end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity);
    if(saveCheckpoint&&frame<checkpointFrame)end=Math.min(end,checkpointFrame);
    const count=end-frame;assert(count>0);hookFrame=end;
    const pcm=actor!==chip?actor.processFrames(count):chip.generateStereo(count);assert(!pcm?.then);
    left.set(pcm.left,frame-start);right.set(pcm.right,frame-start);frame=end;observations.push(readObservation(actor,frame,scenario.clock));
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
function pcmDigest(result){const hash=createHash('sha256');for(const array of [result.left,result.right])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');}
function directVoice(chip,ch=0,{carrierOnly=false,am=false,pms=0,ams=0,key=true}={}){
  const write=(r,v)=>{chip.write(0,r);chip.write(1,v);};
  for(let slot=0;slot<4;slot++)for(const [r,v] of [[0x40,slot+1],[0x60,carrierOnly&&slot!==3?127:24],[0x80,31],[0xa0,(am?128:0)|4],[0xc0,0],[0xe0,0x2f]])write(r+ch+slot*8,v);
  write(0x20+ch,0xc7);write(0x28+ch,0x44);write(0x30+ch,0);write(0x38+ch,(pms<<4)|ams);if(key)write(8,0x78|ch);return write;
}
async function wrapperChecks(backend,variant){
  const chip=await backend.create(variant),other=await backend.create(variant);let frames=0;
  const render=n=>{frames+=n;return chip.generateStereo(n);};
  try{
    const initial=nativeSave(chip),rates={};assert(chip.supportsState());
    for(const clock of rateClocks){rates[clock]=chip.sampleRate(clock);assert.equal(rates[clock],Math.floor(clock/64));}
    chip.generateStereo(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>chip.generateStereo(n),RangeError);sameBytes(nativeSave(chip),initial,'Rate/zero/invalid generation is observational');
    const opaque=chip.saveState();assert.throws(()=>other.loadState(opaque),/foreign/);assert.throws(()=>chip.loadState({byteLength:opaque.byteLength}),/foreign/);
    assert.equal(chip.module._ym2151_load_state(chip.handle,0,initial.length),0);assert.equal(nativeLoad(chip,initial,initial.length-1),0);assert.equal(nativeLoad(chip,new Uint8Array(initial.length+1),initial.length+1),0);sameBytes(nativeSave(chip),initial,'Invalid state sizes do not mutate');
    const timerFirst={};
    for(const [name,mode,flag] of [['A',5,1],['B',10,2]]){
      chip.reset();const write=directVoice(chip,0,{key:false});write(0x10,255);write(0x11,0);write(0x12,255);write(0x14,mode);
      let first=0;while(first<128&&!chip.getIrq()){render(1);first++;}assert(chip.readStatus()&flag);assert(chip.getIrq());
      write(0x14,0x30);assert.equal(chip.readStatus()&3,0);assert.equal(chip.getIrq(),false);timerFirst[name]=first;
    }
    assert.equal(timerFirst.A,4);assert.equal(timerFirst.B,variant==='ym2164'?32:16,'OPP Timer B divider is exactly double OPM');
    chip.reset();const csmWrite=directVoice(chip,0,{key:false});render(32);const withoutKey=render(1024);assert(withoutKey.left.every(v=>v===0));
    csmWrite(0x10,255);csmWrite(0x11,3);csmWrite(0x14,0x85);const csm=render(1024);assert(csm.left.some(v=>v!==0),'CSM must sound without ordinary key-on');
    const noise=[];let disabledNoise,channelOne;
    for(const ch of [7,0])for(const enabled of [false,true]){
      const periods=enabled&&ch===7?Array.from({length:32},(_,n)=>n):[0];
      for(const period of periods){chip.reset();const write=directVoice(chip,ch,{carrierOnly:true});write(0x0f,(enabled?128:0)|period);const pcm=render(2048);assert(pcm.left.some(v=>v!==0));
        if(ch===7&&enabled)noise.push({period,pcmSha256:pcmDigest(pcm)});else if(ch===7)disabledNoise=pcmDigest(pcm);else if(!enabled)channelOne=pcm;else sameBytes(pcm.left,channelOne.left,'Noise enable must not affect physical channel0');
      }
    }
    assert.notEqual(noise[0].pcmSha256,noise[31].pcmSha256,'Low/high noise periods differ');assert.notEqual(noise[0].pcmSha256,disabledNoise,'Channel7 carrier noise is active');
    const lfo=[];for(let waveform=0;waveform<4;waveform++){
      chip.reset();const write=directVoice(chip,0,{am:true,pms:7,ams:3});write(0x18,237);write(0x19,93);write(0x19,221);write(0x1b,waveform);
      const pcm=render(4096);assert(pcm.left.some(v=>v!==0));lfo.push({waveform,pcmSha256:pcmDigest(pcm)});
    }
    assert.equal(new Set(lfo.map(r=>r.pcmSha256)).size,4,'Four LFO waveforms must affect PCM');
    chip.reset();const write=directVoice(chip);render(499);const voiced=nativeSave(chip);
    const controls=[];for(const pan of [0x47,0x87,0xc7,7]){assert.equal(nativeLoad(chip,voiced),1);write(0x20,pan);const pcm=render(701);
      assert.equal(pcm.left.some(v=>v!==0),Boolean(pan&0x40));assert.equal(pcm.right.some(v=>v!==0),Boolean(pan&0x80));if(pan===0xc7)sameBytes(pcm.left,pcm.right,'Both pan gates receive identical isolated voice');controls.push({pan,pcmSha256:pcmDigest(pcm)});}
    assert.equal(nativeLoad(chip,voiced),1);chip.setMuteMask(0xff00);const high=render(701);assert.equal(nativeLoad(chip,voiced),1);chip.setMuteMask(0);sameBytes(render(701).left,high.left,'Public mask ignores high bits');
    assert.equal(nativeLoad(chip,voiced),1);chip.setMuteMask(255);const silent=render(701);assert(silent.left.every(v=>v===0)&&silent.right.every(v=>v===0),'All channel mutes suppress PCM');
    chip.reset();assert.equal(chip.muteMask,255,'Public reset retains JS mute');chip.setMuteMask(0);chip.reset();sameBytes(nativeSave(chip),initial,'Public reset recreates exact power-on state');
    const ownedWrite=directVoice(chip),owned=render(17),held=owned.left.slice();assert(held.some(v=>v!==0),'Owned-buffer reference must sound');
    ownedWrite(0x28,0x65);render(17);sameBytes(owned.left,held,'Owned PCM survives same-buffer overwrite');
    const capacity=chip.bufferFrames;render(capacity+1);assert(chip.bufferFrames>capacity,'Owned-buffer check must grow native buffers');
    sameBytes(owned.left,held,'Owned PCM survives later buffer reallocation');
    return {passed:true,variant,rates,stateBytes:initial.length,timerFirstIrqFrame:timerFirst,csmOnlyAudible:true,noise,noiseDisabledSha256:disabledNoise,channelZeroUnaffectedByNoise:true,lfo,pan:controls,allChannelMuteSilent:true,publicResetRecreatesPowerOnRetainsMask:true,invalidStateSizesRejected:true,foreignOpaqueStatesRejected:true,ownedPcmSurvivesReuse:true,totalNativeStereoFrames:frames,
      frameCountScope:'Bounded positive timer/CSM/noise/LFO/pan/mute and owned-buffer self-checks; excluded from main scenario output-frame counters.'};
  }finally{chip.dispose();chip.dispose();other.dispose();other.dispose();}
}
async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');
  const wrappers=['web/ym2151.js','docs/js/ym2151.js','web/ym2151audioengine.js','docs/js/ym2151audioengine.js'];
  const normalized=bytes=>bytes.toString().replace(/(\.\/(?:ym2151|soundchip|segapsg|segapcm)\.js)\?v=[^"'\s)]+/g,'$1');
  for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,variants,layouts,checkpointFrame,
    method:'Actual generated JS/WASM and unchanged synchronous Ym2151 wrapper/AudioEngine for YM2151 and YM2164. Exact stereo PCM, rate/status/IRQ/read hooks, raw state and JS resampler held timing; no tolerance, mock, Mixer or output device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),pitch:await inputFile(resolve(root,'web/soundchip_pitch.js'))},
    wrapperSync:'Byte-identical after removing only deployed ym2151.js/soundchip.js/segapsg.js/segapcm.js import cache suffixes; actual file hashes retained.',
    wrapperChecks:{},cases:[],totalOutputStereoFrames:0,ownStateLoads:0,crossStateLoads:0,resetContinuations:0,preRestorePerturbationOutputStereoFrames:0,maximumDifference:0,
    limits:['Both variants produce native PCM at floor(clock/64); only the YM2164 Timer B interval is doubled by the existing wrapper. Engine cases separately cover output averaging/holding, without optional PSG/PCM sources.',
      'Cross-build raw states are tested within each variant for these exact builds only; public opaque snapshots remain owner-restricted. Both layouts save selected checkpoints; continuations replay only the regular layout.',
      'Public reset destroys/recreates the native chip and reapplies the JS mute mask; the exported raw reset preserves free-running core counters. Both existing paths are compared.',
      'Status/IRQ/read hooks are sampled at chunk boundaries. Engine generation callbacks are labeled by the enclosing chunk boundary, while PCM resampling runs per output sample.',
      'No Worklet scheduling, physical hardware, browser, Native backend, Mixer or listening judgement is tested.']};
  await assert.rejects(Ym2151.create({moduleFactory:()=>legacy.module,variant:'other'}),RangeError);
  for(const variant of variants){report.wrapperChecks[variant]={legacy:await wrapperChecks(legacy,variant),sdk:await wrapperChecks(sdk,variant)};assert.deepEqual(report.wrapperChecks[variant].sdk,report.wrapperChecks[variant].legacy);}
  assert.equal(report.wrapperChecks.ym2151.legacy.timerFirstIrqFrame.A,report.wrapperChecks.ym2164.legacy.timerFirstIrqFrame.A);
  assert.equal(report.wrapperChecks.ym2164.legacy.timerFirstIrqFrame.B,report.wrapperChecks.ym2151.legacy.timerFirstIrqFrame.B*2);
  report.totalWrapperSelfCheckNativeStereoFrames=Object.values(report.wrapperChecks).reduce((sum,c)=>sum+c.legacy.totalNativeStereoFrames+c.sdk.totalNativeStereoFrames,0);
  const jobs=[];
  for(const variant of variants)for(const clock of clocks)for(const scenario of scenariosFor(clock)){
    jobs.push({...scenario,variant,kind:'chip',outputRate:null,checkpoint:scenario.checkpoint&&clock===3579545});
    if(scenario.engine&&clock===3579545)for(const outputRate of [44100,48000,96000,192000])jobs.push({...scenario,variant,kind:'engine',outputRate,checkpoint:outputRate===48000,frames:3072,events:scenario.events.filter(e=>e.frame<3072)});
  }
  for(const scenario of jobs){
    let regular;
    for(const [layoutName,layout] of Object.entries(layouts)){
      const make=async backend=>{const chip=await backend.create(scenario.variant);return scenario.kind==='chip'?chip:new Ym2151AudioEngine(chip,undefined,undefined,chip.sampleRate(scenario.clock),scenario.outputRate,1);};
      const a=await make(legacy),b=await make(sdk),label=`${scenario.variant}/${scenario.kind}/${scenario.name}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
      try{
        const x=execute(a,scenario,layout,{saveCheckpoint:scenario.checkpoint}),y=execute(b,scenario,layout,{saveCheckpoint:scenario.checkpoint});compareResult(y,x,label);
        if(scenario.checkpoint)sameBytes(y.saved.bytes,x.saved.bytes,'Checkpoint bytes compatible');
        if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        let peak=0;for(const array of [x.left,x.right])for(const v of array)peak=Math.max(peak,Math.abs(v));assert(peak>1e-5,`${label}: audible reference`);
        if(scenario.timerMode!==undefined){const flag=scenario.timerMode&4?1:2;assert(x.observations.some(r=>(r.status&flag)&&r.irq),`${label}: positive timer status/IRQ`);}
        if(layoutName==='regular'&&scenario.checkpoint){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){
            actor.reset();if(actor.ym2151)actor.processFrames(31);else actor.generateStereo(31);report.preRestorePerturbationOutputStereoFrames+=31;
            rawChip(actor).setMuteMask(result.saved.muteMask);actor.loadState(result.saved.opaque);
            const restored=execute(actor,scenario,layout,{start:checkpointFrame});compareContinuation(restored,result,`${name}/opaque`);report.ownStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          assert.throws(()=>a.loadState(y.saved.opaque),/foreign|Incompatible/);assert.throws(()=>b.loadState(x.saved.opaque),/foreign|Incompatible/);
          for(const [actor,state,result,name] of [[a,y.saved,x,'sdk-to-legacy'],[b,x.saved,y,'legacy-to-sdk']]){
            actor.reset();const chip=rawChip(actor);assert.equal(nativeLoad(chip,state.bytes),1);chip.muteMask=state.muteMask;
            if(actor.ym2151)[actor.remainder,actor.lastLeft,actor.lastRight]=state.timing;
            const restored=execute(actor,scenario,layout,{start:checkpointFrame});compareContinuation(restored,result,`${name}/raw-state`);report.crossStateLoads++;report.totalOutputStereoFrames+=restored.left.length;
          }
          a.reset();b.reset();compareResult(execute(b,scenario,layout),execute(a,scenario,layout),'Reset/reprogram');report.resetContinuations+=2;report.totalOutputStereoFrames+=scenario.frames*2;
        }
        report.cases.push({name:scenario.name,variant:scenario.variant,kind:scenario.kind,clock:scenario.clock,nativeRate:Math.floor(scenario.clock/64),outputRate:scenario.outputRate,layout:layoutName,frames:scenario.frames,peak,checkpointSaved:scenario.checkpoint,continuationReplayTested:scenario.checkpoint&&layoutName==='regular',pcmSha256:pcmDigest(x),checkpointSha256:x.saved?sha256(x.saved.bytes):null,stateBytes:x.endState.length,endStateSha256:sha256(x.endState),observations:x.observations.length,hookEvents:x.hooks.length,maximumDifference:0});report.totalOutputStereoFrames+=scenario.frames*2;
      }finally{a.dispose();b.dispose();}
    }
  }
  report.scenariosPerClockAndVariant=scenariosFor(clocks[0]).length;report.scenarioConfigurations=jobs.length;report.scenarioRenderExecutions=report.cases.length*2+report.ownStateLoads+report.crossStateLoads+report.resetContinuations;
  report.preRestorePerturbationRenderExecutions=report.ownStateLoads;
  report.totalGeneratedOutputStereoFrames=report.totalOutputStereoFrames+report.totalWrapperSelfCheckNativeStereoFrames+report.preRestorePerturbationOutputStereoFrames;
  report.frameCountScope='Both builds: low-level PCM frames or resampled engine output frames, including own/cross-state/reset continuations; wrapper self-check frames excluded. Engine source frames and the 31-frame pre-restore perturbations are not counted as output frames.';
  report.passed=true;report.completedAt=new Date().toISOString();if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,lowLevelComparisons:report.cases.filter(c=>c.kind==='chip').length,engineComparisons:report.cases.filter(c=>c.kind==='engine').length,totalOutputStereoFrames:report.totalOutputStereoFrames,totalWrapperSelfCheckNativeStereoFrames:report.totalWrapperSelfCheckNativeStereoFrames,preRestorePerturbationOutputStereoFrames:report.preRestorePerturbationOutputStereoFrames,ownStateLoads:report.ownStateLoads,crossStateLoads:report.crossStateLoads,resetContinuations:report.resetContinuations,maximumDifference:0,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
