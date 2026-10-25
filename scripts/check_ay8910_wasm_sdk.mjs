/** Compare two real Ay8910 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ay8910} from '../web/ay8910.js';
import {Ay8910AudioEngine} from '../web/ay8910audioengine.js';
import {VgmPlayer} from '../web/vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ay8910_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[100000,1789773,3579545];
const outputRates=[8000,44100,48000,96000];
const profiles=[{type:0,flags:0},{type:0,flags:1},... [0,1,16,17].map(flags=>({type:16,flags}))];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const totalFrames=2048,probeFrames=127;
const requiredExports=['ay8910_create','ay8910_destroy','ay8910_reset','ay8910_write','ay8910_read','ay8910_sample_rate','ay8910_set_mute_mask','ay8910_generate','malloc','free'];

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
    assert(!['ay8910_wasm.js','ay8910_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ay8910_wasm.js'),wasm=resolve(directory,'ay8910_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  const create=(options={})=>Ay8910.create({...options,moduleFactory:()=>module});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ay8910');assert(artifact,'Ay8910 build receipt entry');
    for(const [name,record] of [['ay8910_wasm.js',metadata.javascript],['ay8910_wasm.wasm',metadata.wasm]]){
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
function configure(write,{periods=[17,29,47],noise=7,mixer=0x38,levels=[15,12,9],shape=10,envelopePeriod=3}={}){
  for(let ch=0;ch<3;ch++){write(ch*2,periods[ch]&255);write(ch*2+1,periods[ch]>>8);write(8+ch,levels[ch]);}
  for(const [r,v]of[[6,noise],[7,mixer],[11,envelopePeriod&255],[12,envelopePeriod>>8],[13,shape]])write(r,v);
}
function program(chip,options={}){configure((r,v)=>chip.writeRegister(r,v),options);}
function scenariosFor(){
  const scenes=[];
  const scene=(name,build,{engine=false,replay=false,constant=false,zero=false,engineOnly=false}={})=>{
    let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v)=>add('register',r,v),at=n=>{assert(Number.isInteger(n)&&n>=0&&n<totalFrames);frame=n;};
    build({write,add,at,voice:options=>configure(write,options)});events.sort((a,b)=>a.frame-b.frame);scenes.push({name,events,frames:totalFrames,engine,replay,constant,zero,engineOnly});
  };
  for(let ch=0;ch<3;ch++)for(const period of [0,1,2,17,255,256,4095])scene(`tone/channel${ch}/period${period}`,({voice,write,at})=>{
    const periods=[17,29,47];periods[ch]=period;const levels=[0,0,0];levels[ch]=15;voice({periods,levels,mixer:0x3f^(1<<ch)});at(101);write(ch*2+1,0xf0|((period>>8)&15));at(307);write(ch*2,(period^91)&255);at(701);write(8+ch,7);at(1103);write(7,0x3f);at(1703);write(7,0x3f^(1<<ch));
  },{engine:ch===0&&period===17,replay:ch===0&&[0,17,4095].includes(period)});
  for(let period=0;period<32;period++)scene(`noise/period${period}`,({voice,write,at})=>{
    voice({noise:period,mixer:7});at(101);write(6,0xe0|period);at(307);write(6,period^31);at(701);write(7,0x27);at(1103);write(8,0x10);at(1703);write(6,3);write(7,7);
  },{engine:period===7,replay:[0,7,31].includes(period)});
  for(let shape=0;shape<16;shape++)for(const period of [0,1,17,65535])scene(`envelope/shape${shape}/period${period}`,({voice,write,at})=>{
    voice({mixer:0x3f,levels:[16,16,16],shape,envelopePeriod:period});at(101);write(13,shape|0xf0);at(307);write(13,shape);at(701);write(11,3);write(12,0);write(13,shape^4);at(1103);write(7,0x38);at(1703);write(13,shape^8);
  },{engine:shape===10&&period===17,replay:period===1});
  for(let mixer=0;mixer<64;mixer++)scene(`mixer/tone-noise-combination${mixer}`,({voice,write,at})=>{
    voice({mixer});at(101);write(7,mixer|0xc0);at(307);write(7,mixer^63);at(701);write(6,1);at(1103);write(7,mixer^15);at(1703);write(7,mixer);
  },{engine:mixer===0,replay:mixer===0||mixer===63});
  for(let level=0;level<16;level++)scene(`volume/fixed-level${level}/envelope-switch`,({voice,write,at})=>{
    voice({levels:[level,level,level]});at(101);write(8,level|0xe0);at(307);write(9,15-level);at(701);write(10,16);at(1103);write(13,10);at(1703);write(8,15);
  });
  scene('registers/raw-mask-aliases/full-byte-readback',({voice,write,add,at})=>{voice();at(101);add('raw-write',17,511);at(307);write(6,255);write(8,239);at(701);add('raw-write',256,9);at(1103);add('read',-1);add('read',256);at(1703);write(1,3);},{replay:true});
  scene('IO/direction-and-two-independent-latches',({voice,write,at})=>{voice();for(const [frame,direction,a,b]of[[101,0,85,170],[307,64,255,0],[701,128,0,255],[1103,192,31,47],[1703,0,19,29]]){at(frame);write(7,0x38|direction);write(14,a);write(15,b);}},{replay:true});
  scene('mute/all-three/high-bits/phase',({voice,add,at})=>{voice({mixer:0,levels:[16,12,15]});for(const [frame,mask]of[[101,1],[307,2],[701,4],[1103,7],[1703,0xfffffff8]]){at(frame);add('mute',mask);}},{replay:true});
  scene('reset/native-and-public/reinitialize-counters',({voice,add,write,at})=>{voice({levels:[16,16,16],mixer:0});at(101);add('raw-reset');voice({levels:[16,16,16],mixer:0});at(307);add('reset');voice();at(701);add('mute',1);add('reset');voice();at(1103);add('mute',0);at(1703);write(13,10);},{replay:true});
  scene('mixed/three-tones-noise-envelope-IO',({voice,write,at})=>{voice({levels:[16,13,11],mixer:0});at(101);write(6,31);at(307);write(7,0x0a);write(14,31);at(701);write(11,1);write(13,14);at(1103);write(7,0x35);write(9,16);at(1703);write(13,10);write(7,0);},{engine:true,replay:true});
  scene('cold/register-defaults/DC-only',()=>{},{constant:true});
  scene('mute/all-three/exact-zero',({voice,add})=>{voice();add('mute',7);},{zero:true,replay:true});
  scene('engine/master-gain/independent-mutes',({voice,add,at})=>{voice({mixer:0});at(101);add('channel-mute',0,true);at(307);add('volume',.5);at(701);add('all-mute',true);at(1103);add('all-mute',false);add('channel-mute',0,false);at(1703);add('volume',2);},{engine:true,replay:true,engineOnly:true});
  return scenes;
}
const rawChip=actor=>actor.ay8910??actor;
const timing=actor=>actor.ay8910?[actor.volume,actor.channelMask,actor.muted]:null;
function observation(actor,frame){const chip=rawChip(actor);return {frame,sampleRate:chip.sampleRate(),registers:Array.from({length:16},(_,r)=>chip.read(r))};}
function execute(actor,scenario,layout){
  const chip=rawChip(actor),left=new Float32Array(scenario.frames),right=new Float32Array(scenario.frames),observations=[];let frame=0,index=0,next=0;
  const initialObservation=observation(actor,0);
  while(frame<scenario.frames){
    while(next<scenario.events.length&&scenario.events[next].frame===frame){const {op,args}=scenario.events[next++];
      if(op==='register')chip.writeRegister(...args);else if(op==='raw-write')chip.api.write(chip.handle,...args);else if(op==='read')chip.read(...args);else if(op==='reset')actor.reset();else if(op==='raw-reset')chip.api.reset(chip.handle);else if(op==='mute')chip.setMuteMask(args[0]);else if(op==='channel-mute')actor.setAyChannelMuted(...args);else if(op==='all-mute')actor.setAyMuted(...args);else if(op==='volume')actor.setMasterVolume(...args);else throw Error(op);
    }
    const end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity),count=end-frame;assert(count>0);const pcm=actor===chip?chip.generateStereo(count):actor.processFrames(count);assert(!pcm?.then);left.set(pcm.left,frame);right.set(pcm.right,frame);frame=end;observations.push(observation(actor,frame));
  }
  const probe=actor===chip?chip.generateStereo(probeFrames):actor.processFrames(probeFrames);for(const array of [left,right,probe.left,probe.right])for(const value of array)assert(Number.isFinite(value));sameBytes(left,right,'AY mono body');sameBytes(probe.left,probe.right,'AY mono continuation');return {left,right,probe,initialObservation,observations,endObservation:observation(actor,frame+probeFrames),endTiming:timing(actor)};
}
function compareResult(actual,expected,label,{observations=true}={}){
  for(const key of ['left','right']){sameBytes(actual[key],expected[key],label+'/'+key);sameBytes(actual.probe[key],expected.probe[key],label+'/probe-'+key);}assert.deepEqual(actual.endObservation,expected.endObservation,label+'/end-registers-rate');assert.deepEqual(actual.endTiming,expected.endTiming,label+'/engine-controls');if(observations){assert.deepEqual(actual.initialObservation,expected.initialObservation,label+'/initial-registers');assert.deepEqual(actual.observations,expected.observations,label+'/register-reads');}
}
function pcmDigest(result){const hash=createHash('sha256');for(const array of [result.left,result.right])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');}
function metrics(pcm){let lo=Infinity,hi=-Infinity,sum=0,squares=0;for(const v of pcm.left){lo=Math.min(lo,v);hi=Math.max(hi,v);sum+=v;squares+=v*v;}const mean=sum/pcm.left.length;return {min:lo,max:hi,range:hi-lo,mean,acRms:Math.sqrt(Math.max(0,squares/pcm.left.length-mean*mean))};}
async function wrapperChecks(backend){
  let frames=0;const actors=[],rows=[];
  const make=async(options={})=>{const chip=await backend.create(options);actors.push(chip);return chip;};
  const render=(actor,n)=>{frames+=n;return actor.ay8910?actor.processFrames(n):actor.generateStereo(n);};
  const equal=(a,b,label)=>{sameBytes(a.left,b.left,label+'/left');sameBytes(a.right,b.right,label+'/right');};
  try{
    for(const profile of profiles){
      const options={...profile,clock:1789773,sampleRate:44100},a=await make(options),b=await make(options);
      for(const name of ['saveState','loadState','supportsState','generateStereoInto','readStatus','getIrq','setHooks','write'])assert.equal(typeof a[name],'undefined','No invented API');
      assert.equal(a.sampleRate(),44100);program(a);program(b);render(a,103);render(b,103);a.generateStereo(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>a.generateStereo(n),RangeError);for(const [r,v]of[[-1,0],[16,0],[0,256],[0,-1],[.5,1],[0,NaN]])assert.throws(()=>a.writeRegister(r,v),RangeError);equal(render(a,701),render(b,701),'Invalid and zero-frame calls do not advance phase');
      a.reset();for(let r=0;r<16;r++){a.writeRegister(r,255);assert.equal(a.read(r),255);assert.equal(a.read(r+16),255);a.api.write(a.handle,r+256,256+r);assert.equal(a.read(r),r);assert.equal(a.api.read(a.handle,r+256),r);}assert.equal(a.read(-1),15);
      for(const actor of [a,b]){actor.reset();program(actor,{levels:[16,16,16],mixer:0});}
      for(const [r,raw,effective]of[[1,0xf3,3],[3,0xf5,5],[5,0xf7,7],[6,0xe7,7],[8,0xf0,16],[9,0xef,15],[10,0xe8,8],[13,0xfa,10]]){a.writeRegister(r,raw);b.writeRegister(r,effective);assert.equal(a.read(r),raw);}
      equal(render(a,2048),render(b,2048),'Effective register masks do not alter full-byte readback');
      for(const actor of [a,b]){actor.reset();program(actor);}
      for(let direction=0;direction<4;direction++){a.writeRegister(7,0x38|(direction<<6));a.writeRegister(14,17+direction);a.writeRegister(15,255-direction);assert.equal(a.read(14),17+direction);assert.equal(a.read(15),255-direction);equal(render(a,127),render(b,127),'IO latches and direction bits have no external CPU/audio side effects');}
      const shapeRows=[];for(let shape=0;shape<16;shape++){a.reset();program(a,{mixer:63,levels:[16,16,16],shape,envelopePeriod:3});const pcm=render(a,2048);assert(metrics(pcm).range>1e-6);shapeRows.push({shape,pcmSha256:pcmDigest(pcm),...metrics(pcm)});}
      for(const group of [[0,1,2,3,9],[4,5,6,7,15]])for(const shape of group)assert.equal(shapeRows[shape].pcmSha256,shapeRows[group[0]].pcmSha256,'Existing one-shot envelope shape aliases');assert.equal(new Set([0,4,8,10,11,12,13,14].map(shape=>shapeRows[shape].pcmSha256)).size,8,'Eight canonical envelope trajectories must differ');
      const zeroPeriods={};for(const kind of ['tone','noise','envelope']){const hashes=[];for(const period of [0,1,2]){a.reset();program(a,kind==='tone'?{periods:[period,period,period]}:kind==='noise'?{noise:period,mixer:7}:{envelopePeriod:period,mixer:63,levels:[16,16,16]});const pcm=render(a,1024);assert(metrics(pcm).range>1e-6);hashes.push(pcmDigest(pcm));}if(kind!=='envelope'||profile.type===16)assert.equal(hashes[0],hashes[1],kind+' period0/1 equivalence');else assert.notEqual(hashes[0],hashes[1],'AY envelope0 ticks every cycle, period1 uses env_step2');assert.notEqual(hashes[0],hashes[2]);zeroPeriods[kind]=hashes;}
      for(const actor of [a,b]){actor.reset();program(actor,{mixer:63,levels:[16,16,16],shape:8,envelopePeriod:3});render(actor,173);}a.writeRegister(13,8);assert.notEqual(pcmDigest(render(a,701)),pcmDigest(render(b,701)),'Rewriting shape restarts its envelope steps');
      for(const actor of [a,b]){actor.setMuteMask(0);actor.reset();program(actor,{mixer:0,levels:[16,12,15]});render(actor,173);}
      for(const mask of [1,2,4,7]){a.setMuteMask(mask);const muted=render(a,127),normal=render(b,127);if(mask===7)assert(muted.left.every(v=>v===0)&&muted.right.every(v=>v===0));else assert.notEqual(pcmDigest(muted),pcmDigest(normal),'Each partial channel mute must actually change output');a.setMuteMask(0);equal(render(a,127),render(b,127),'Mute preserves tone/noise/envelope/integration phase');}
      a.setMuteMask(0xfffffff8);equal(render(a,127),render(b,127),'Only low3 mute bits have an effect');
      a.setMuteMask(7);a.reset();assert(Array.from({length:16},(_,r)=>a.read(r)).every(v=>v===0));program(a);assert(render(a,127).left.every(v=>v===0),'Native reset retains mute mask');a.setMuteMask(0);a.reset();program(a,{mixer:0,levels:[16,16,16]});const resetA=render(a,1024);b.setMuteMask(0);b.api.reset(b.handle);program(b,{mixer:0,levels:[16,16,16]});equal(resetA,render(b,1024),'Raw and public resets both rewind all counters and integration phase');a.reset();program(a,{mixer:0,levels:[16,16,16]});equal(render(a,1024),resetA,'Reset/replay reproduces complete power-on PCM');
      a.reset();const cold=render(a,127);assert.equal(metrics(cold).range,0,'Default registers yield a DC baseline, not a fictitious silent AC waveform');program(a);render(a,103);const owned=render(a,17),left=owned.left.slice(),right=owned.right.slice();assert(metrics(owned).range>0);a.writeRegister(0,91);render(a,17);equal(owned,{left,right},'Owned outputs survive same-buffer overwrite');const oldCapacity=a.capacity;render(a,oldCapacity+1);assert(a.capacity>oldCapacity);equal(owned,{left,right},'Owned outputs survive actual capacity growth');
      a.reset();program(a,{mixer:0,levels:[16,13,11]});const reference=render(a,4096);assert(metrics(reference).range>1e-6);rows.push({...profile,referencePcmSha256:pcmDigest(reference),referenceMetrics:metrics(reference),shapeRows,zeroPeriods,coldValue:cold.left[0],retainedMuteAcrossReset:true,rawAndPublicResetBothPowerOn:true,ownedBothSidesSurviveOverwriteAndGrowth:true});
    }
    assert.equal(new Set(rows.map(row=>row.referencePcmSha256)).size,6,'All six supported type/flag profiles must have distinct output tables or divider');
    const rates=[];for(const clock of [1,100000,1789773,0x3fffffff])for(const sampleRate of [1,8000,44100,96000,384000]){const chip=await make({clock,sampleRate});assert.equal(chip.sampleRate(),sampleRate);rates.push({clock,configuredOutputRate:sampleRate});}
    for(const options of [{clock:0},{clock:.5},{clock:0x40000000},{sampleRate:0},{sampleRate:384001},{sampleRate:Infinity},{type:1},{type:0,flags:16},{type:16,flags:2}])await assert.rejects(()=>backend.create(options));
    const api=actors[0].api;for(const [rate,clock,type,flags]of[[0,1,0,1],[1,0,0,1],[44100,1789773,1,1],[44100,1789773,0,16],[44100,1789773,16,2]])assert.equal(api.create(rate,clock,type,flags),0);
    const engineRows=[];for(const profile of profiles){
      const chip=await make({...profile,clock:1789773,sampleRate:48000}),raw=await make({...profile,clock:1789773,sampleRate:48000}),engine=new Ay8910AudioEngine(chip,.5);actors.push(engine);program(chip,{mixer:0});program(raw,{mixer:0});let sourceFrames=0,calls=0;const generate=chip.generateStereo.bind(chip);chip.generateStereo=n=>{sourceFrames+=n;calls++;return generate(n);};const pcm=render(engine,1024),expected=render(raw,1024);equal(pcm,{left:Float32Array.from(expected.left,v=>v*.5),right:Float32Array.from(expected.right,v=>v*.5)},'Engine delegates the configured output rate and applies gain once');assert.equal(sourceFrames,1024);assert.equal(calls,1);assert.equal(engine.sampleRate(),48000);
      const l=new Float32Array(23).fill(99),r=new Float32Array(29).fill(-88);engine.process(l.subarray(2,19),r.subarray(3,20),13);frames+=13;const want=render(raw,13);sameBytes(l.subarray(2,15),Float32Array.from(want.left,v=>v*.5),'Engine caller output exact left');sameBytes(r.subarray(3,16),Float32Array.from(want.right,v=>v*.5),'Engine caller output exact right');assert(l.subarray(15).every(v=>v===99));assert(r.subarray(16).every(v=>v===-88));assert(l.subarray(0,2).every(v=>v===99));assert(r.subarray(0,3).every(v=>v===-88));
      engine.setAyMuted(true);const muted=render(engine,127);assert(muted.left.every(v=>v===0));render(raw,127);engine.setAyMuted(false);const resumed=render(engine,127),running=render(raw,127);equal(resumed,{left:Float32Array.from(running.left,v=>v*.5),right:Float32Array.from(running.right,v=>v*.5)},'Engine mute resumes exact current phase without a held resampler');
      for(const channel of [-1,3,.5])assert.throws(()=>engine.setAyChannelMuted(channel,true),RangeError);engine.setAyChannelMuted(0,true);engine.setAyMuted(true);engine.reset();program(chip,{levels:[15,0,0],mixer:0x3e});assert(render(engine,127).left.every(v=>v===0));engine.setAyMuted(false);assert.equal(metrics(render(engine,127)).range,0,'Reset retains the individual channel mute');engine.setAyChannelMuted(0,false);assert(metrics(render(engine,701)).range>1e-6);for(const value of [NaN,Infinity,'bad'])assert.throws(()=>engine.setMasterVolume(value),RangeError);engine.setMasterVolume(99);assert.equal(engine.volume,3.8);engine.setMasterVolume(-1);assert.equal(engine.volume,0);for(const [l,r,n]of[[[],new Float32Array(1),1],[new Float32Array(1),new Float64Array(1),1],[new Float32Array(1),new Float32Array(1),2]])assert.throws(()=>engine.process(l,r,n),RangeError);
      engineRows.push({...profile,outputRate:engine.sampleRate(),sourceFramesForInitialOutput:1024,sourceCallsForInitialOutput:1,noJsResampler:true,pcmSha256:pcmDigest(pcm)});
    }
    const normal=await make({clock:1789773,type:16,flags:1}),divided=await make({clock:3579546,type:16,flags:17});for(const chip of [normal,divided])program(chip,{levels:[15,11,7]});const clockReference=render(normal,4096);equal(render(divided,4096),clockReference,'YM2149 flag10 doubles divider; doubling input clock restores identical integration');
    const dead=await make();program(dead);const owned=render(dead,17);dead.dispose();dead.dispose();for(const call of [()=>dead.reset(),()=>dead.writeRegister(0,1),()=>dead.read(0),()=>dead.sampleRate(),()=>dead.setMuteMask(0),()=>dead.generateStereo(0)])assert.throws(call,/disposed/);assert(owned.left.length===17);
    return {passed:true,profiles:rows,configuredRates:rates,readbackStoresFullBytes:true,effectiveMasksComparedWithUnmaskedReads:true,ioPortsAreStoredLatchesOnly:true,allThreeMuteGroupsPreservePhase:true,resetRetainsMuteButRewindsCounters:true,noStatusIrqHooksStateOrInto:true,disposedGuards:true,ym2149Divider16MatchesDoubleClockDivider8:true,engineRows,totalOutputStereoFrames:frames,frameCountScope:'Actual chip and Engine output frames, including caller-buffer generation. Engine delegates one chip frame per output frame with no JavaScript resampler; those underlying frames are not added again.'};
  }finally{for(const actor of actors){actor.dispose();actor.dispose();}}
}
function vgmFixture(clock,profile){
  const commands=[];let frame=0;const write=(r,v)=>commands.push(0xa0,r,v),at=n=>{const wait=n-frame;assert(wait>=0);if(wait)commands.push(0x61,wait&255,wait>>8);frame=n;};
  configure(write,{levels:[16,13,11],mixer:0});at(701);write(6,31);at(1703);write(7,10);write(14,31);at(2801);write(11,1);write(13,14);at(3901);write(7,0x35);write(9,16);at(5101);write(13,10);write(7,0);at(7168);commands.push(0x66);
  const bytes=new Uint8Array(0x100+commands.length),v=new DataView(bytes.buffer);bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x151,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x18,7168,true);v.setUint32(0x74,clock,true);bytes[0x78]=profile.type;bytes[0x79]=profile.flags;bytes.set(commands,0x100);return {bytes,samples:7168};
}
async function playerChecks(backend){
  let generated=0,delivered=0,requested=0,renders=0,calls=0;const rows=[];
  for(const profile of profiles)for(const clock of clocks)for(const outputRate of [44100,48000,96000]){
    const engine=await Ay8910AudioEngine.create({...profile,clock,outputSampleRate:outputRate,moduleFactory:()=>backend.module}),fixture=vgmFixture(clock,profile),player=new VgmPlayer(engine),actual=engine.processFrames.bind(engine);engine.processFrames=n=>{generated+=n;renders++;return actual(n);};
    const process=player.process.bind(player);player.process=(l,r,n,options)=>{requested+=n;calls++;const copied=process(l,r,n,options);delivered+=copied;return copied;};
    const read=(frames,layout)=>{const left=new Float32Array(frames),right=new Float32Array(frames);let offset=0,index=0;while(offset<frames){const n=Math.min(frames-offset,layout[index++%layout.length]);assert.equal(player.process(left.subarray(offset,offset+n),right.subarray(offset,offset+n),n),n);offset+=n;}sameBytes(left,right,'AY player mono');return {left,right};};
    try{
      player.load(fixture.bytes);assert.equal(player.parser.header.ay8910Clock,clock);assert.equal(player.parser.header.ay8910Type,profile.type);assert.equal(player.parser.header.ay8910Flags,profile.flags);assert.equal(player.supportsState(),false);assert.throws(()=>player.saveState(),/unavailable/);player.setPrefetchFactor(1);player.reset();player.play();
      const total=Math.floor(fixture.samples*outputRate/44100),baseline=read(total,layouts.irregular);assert(metrics(baseline).range>1e-6);player.reset();player.play();const replayed=read(total,layouts.regular);sameBytes(replayed.left,baseline.left,'Real Player reset/replay exact PCM');const seeks=[];
      for(const target of [0,1,701,1703,2345,5101]){const outputFrame=Math.floor(target*outputRate/44100),position=await seekPlayback(player,target,{yieldTask:async()=>{}});assert.equal(position,outputFrame*44100/outputRate);assert.equal(player.renderedPositionFrames(),outputFrame);assert.deepEqual(player.checkpointStats(),{count:0,bytes:0});player.resume();const pcm=read(257,[17,127,1,64]);sameBytes(pcm.left,baseline.left.subarray(outputFrame,outputFrame+257),'Real Player seek-from-zero continuation');seeks.push({targetVgmSample:target,outputFrame,frames:257,pcmSha256:pcmDigest(pcm)});}
      rows.push({...profile,clock,outputRate,fixtureBytes:fixture.bytes.length,fixtureSha256:sha256(fixture.bytes),fixtureVgmSamples:7168,completeOutputFrames:total,baselinePcmSha256:pcmDigest(baseline),seeks,noStateCheckpoints:true});
    }finally{engine.dispose();}
  }
  return {passed:true,rows,generatedEngineOutputStereoFrames:generated,deliveredPlayerOutputStereoFrames:delivered,requestedPlayerOutputStereoFrames:requested,engineRenderExecutions:renders,playerProcessCalls:calls,frameCountScope:'Actual Engine processFrames output includes parser render-ahead and silent seek prefixes. Requested/delivered Player frames include discarded seek prefixes; those are a separate view and are not added again.'};
}
async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports);assert(!sdk.metadata.exports.some(e=>/save_state|load_state|read_status|get_irq/.test(e.name)));
  const wrappers=['web/ay8910.js','docs/js/ay8910.js','web/ay8910audioengine.js','docs/js/ay8910audioengine.js'];const normalized=bytes=>bytes.toString().replace(/(\.\/(?:ay8910|soundchip|ym2612vgm)\.js)\?v=[^"'\s)]+/g,'$1');for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,profiles,layouts,probeFrames,configuredRawOutputRate:44100,engineOutputRates:outputRates,
    method:'Actual generated JS/WASM and unchanged synchronous Ay8910 wrapper/Engine with original synthetic register programs. Exact owned mono stereo PCM, explicit continuation probes, full register readback and configured sample rates. Engine delegates directly to one chip output frame per requested frame. Actual VgmPlayer0xa0 playback/reset/seek rebuilds from zero. No synthetic state/status/IRQ/hooks/Into, tolerance, mock, Mixer or device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),helpers:await Promise.all(['web/vgmplayer.js','web/ym2612vgm.js','docs/vgm_analyzer/seek_playback.js'].map(p=>inputFile(resolve(root,p))))},wrapperSync:'Byte-identical after removing only AY/soundchip/VGM type import cache keys; actual hashes retained.',
    limits:['This standalone MAME adaptation generates at the configured output rate, not clock divided by a YMFM operator count. Integer integration of native ticks uses divider8, or16 for YM2149 flag0x10; no JavaScript resampler, held samples or clock-setting API is invented.',
      'AY type0 supports flags0/1; YM2149 type0x10 supports0/1/0x10/0x11. Flag1 normalizes output tables; analog and normalized tables have DC baselines, including negative normalized level0. Dynamic range is required for changing test scenes; peak alone is not an audibility proof. Only mute7 is asserted exactzero.',
      'Read returns the full stored register byte; internal tone-coarse/noise/volume/shape bits are interpreted masked. Raw C register arguments truncate to8 bits then mask register number to4 bits. Public writes validate0..15 and0..255. IO14/15 and direction bits are stored latches with no external CPU callbacks.',
      'Raw and public reset both call the same in-place native reset: registers, RNG, tone/noise/envelope counters and integration history rewind. Native mute bits remain. Replay tests reapply neutral mute/gain controls before reset; retained mute is positively tested separately.',
      'No state/snapshot, status/IRQ/hooks or Into API is exposed. Internal serialized state equality is not claimed; actual continuation PCM, readback, reset/replay and real Player replay-from-zero seek are compared.',
      'Main raw cases render2048 frames at44100 with127-frame probes. Selected Engine cases render1536 frames at8000/44100/48000/96000 and test dispatch/gain/mutes directly. Player cases include all6profiles,3clocks and3rates with6seek positions.',
      'No Browser, Worklet scheduling, Native backend, physical hardware, Mixer or listening judgement is tested.'],wrapperChecks:{},playerChecks:{},cases:[],scenarioBodyOutputStereoFrames:0,postScenarioProbeOutputStereoFrames:0,resetReplayExecutions:0,maximumDifference:0};
  report.wrapperChecks.legacy=await wrapperChecks(legacy);report.wrapperChecks.sdk=await wrapperChecks(sdk);assert.deepEqual(report.wrapperChecks.sdk,report.wrapperChecks.legacy);report.totalWrapperSelfCheckOutputStereoFrames=report.wrapperChecks.legacy.totalOutputStereoFrames+report.wrapperChecks.sdk.totalOutputStereoFrames;
  report.playerChecks.legacy=await playerChecks(legacy);report.playerChecks.sdk=await playerChecks(sdk);assert.deepEqual(report.playerChecks.sdk,report.playerChecks.legacy);report.totalPlayerGeneratedEngineOutputStereoFrames=report.playerChecks.legacy.generatedEngineOutputStereoFrames+report.playerChecks.sdk.generatedEngineOutputStereoFrames;report.totalPlayerDeliveredOutputStereoFrames=report.playerChecks.legacy.deliveredPlayerOutputStereoFrames+report.playerChecks.sdk.deliveredPlayerOutputStereoFrames;
  const jobs=[];for(const profile of profiles)for(const clock of clocks)for(const scene of scenariosFor()){
    if(!scene.engineOnly)jobs.push({...scene,...profile,clock,kind:'chip',outputRate:44100});if(scene.engine)for(const outputRate of outputRates)jobs.push({...scene,...profile,clock,kind:'engine',outputRate,frames:1536,events:scene.events.filter(e=>e.frame<1536),replay:scene.replay&&outputRate===48000});
  }
  for(const scenario of jobs){let regular;for(const [layoutName,layout]of Object.entries(layouts)){
    const make=async backend=>{const chip=await backend.create({clock:scenario.clock,sampleRate:scenario.outputRate,type:scenario.type,flags:scenario.flags});return scenario.kind==='chip'?chip:new Ay8910AudioEngine(chip,1);},a=await make(legacy),b=await make(sdk),label=`${scenario.kind}/${scenario.name}/${scenario.type}/${scenario.flags}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
    try{
      const x=execute(a,scenario,layout),y=execute(b,scenario,layout);compareResult(y,x,label);if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;const m=metrics(x);if(scenario.zero)assert(x.left.every(v=>v===0),label+' exactzero');else if(scenario.constant)assert.equal(m.range,0,label+' DC-only cold registers');else assert(m.range>1e-7,label+' reference must have actual variation rather than only DC');
      if(layoutName==='regular'&&scenario.replay)for(const [actor,result,name]of[[a,x,'legacy'],[b,y,'sdk']]){if(actor.ay8910){actor.setMasterVolume(1);actor.setAyMuted(false);for(let ch=0;ch<3;ch++)actor.setAyChannelMuted(ch,false);}rawChip(actor).setMuteMask(0);actor.reset();compareResult(execute(actor,scenario,layout),result,label+'/'+name+'/reset-replay');report.resetReplayExecutions++;report.scenarioBodyOutputStereoFrames+=scenario.frames;report.postScenarioProbeOutputStereoFrames+=probeFrames;}
      report.cases.push({name:scenario.name,kind:scenario.kind,type:scenario.type,flags:scenario.flags,clock:scenario.clock,outputRate:scenario.outputRate,layout:layoutName,frames:scenario.frames,probeFrames,resetReplayTested:scenario.replay&&layoutName==='regular',...m,pcmSha256:pcmDigest(x),probePcmSha256:pcmDigest(x.probe),observations:x.observations.length,maximumDifference:0});report.scenarioBodyOutputStereoFrames+=scenario.frames*2;report.postScenarioProbeOutputStereoFrames+=probeFrames*2;
    }finally{a.dispose();b.dispose();}
  }}
  report.rawScenariosPerProfileClock=scenariosFor().filter(s=>!s.engineOnly).length;report.scenarioConfigurations=jobs.length;report.scenarioRenderExecutions=report.cases.length*2+report.resetReplayExecutions;report.totalOutputStereoFrames=report.scenarioBodyOutputStereoFrames+report.postScenarioProbeOutputStereoFrames;report.totalGeneratedOutputStereoFrames=report.totalOutputStereoFrames+report.totalWrapperSelfCheckOutputStereoFrames+report.totalPlayerGeneratedEngineOutputStereoFrames;report.frameCountScope='Both builds: all main bodies+127-frame continuation probes including selected reset/replays. Bounded chip/Engine positives and actual Player render-ahead/seek-prefix generation are separate components. Engine delegates directly to the chip; those native output frames and Player delivered/discarded frames are not added twice.';report.passed=true;report.completedAt=new Date().toISOString();if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify({passed:true,cases:report.cases.length,chipComparisons:report.cases.filter(c=>c.kind==='chip').length,engineComparisons:report.cases.filter(c=>c.kind==='engine').length,totalOutputStereoFrames:report.totalOutputStereoFrames,totalWrapperSelfCheckOutputStereoFrames:report.totalWrapperSelfCheckOutputStereoFrames,totalPlayerGeneratedEngineOutputStereoFrames:report.totalPlayerGeneratedEngineOutputStereoFrames,resetReplayExecutions:report.resetReplayExecutions,maximumDifference:0,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
