/** Compare two real YMF262 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ymf262} from '../web/ymf262.js';
import {Ymf262AudioEngine} from '../web/ymf262audioengine.js';
import {oplPitchFromHz} from '../web/opl_synth.js';
import {VgmPlayer} from '../web/vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ymf262_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[14318180,16000000,32000000];
const rateClocks=[100000,14318180,16000000,32000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const totalFrames=6144,probeFrames=257;
const requiredExports=['ymf262_create','ymf262_destroy','ymf262_reset','ymf262_write',
  'ymf262_read','ymf262_read_status','ymf262_get_irq','ymf262_sample_rate',
  'ymf262_generate','ymf262_set_mute_mask','malloc','free'];

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
    assert(!['ymf262_wasm.js','ymf262_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ymf262_wasm.js'),wasm=resolve(directory,'ymf262_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  const create=()=>Ymf262.create({moduleFactory:()=>module});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ymf262');assert(artifact,'YMF262 build receipt entry');
    for(const [name,record] of [['ymf262_wasm.js',metadata.javascript],['ymf262_wasm.wasm',metadata.wasm]]){
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
const operatorSlots=[0,1,2,8,9,10,16,17,18],fourPrimaries=[0,1,2,9,10,11];
const bankChannel=ch=>(ch>=9?256:0)+(ch%9);
const operatorAddress=ch=>(ch>=9?256:0)+operatorSlots[ch%9];
function scenariosFor(clock){
  const scenes=[];
  function scenario(name,build,{engine=false,replay=false,allowSilent=false,engineOnly=false,timerExpectedFlag}={}){
    let frame=0,fourMask=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v)=>add('register',r,v);
    const pitch=(ch,midi,key=true)=>{const p=oplPitchFromHz(440*2**((midi-69)/12),clock,'ymf262'),r=bankChannel(ch);write(0xa0+r,p.fnum&255);write(0xb0+r,(p.fnum>>8)|(p.block<<2)|(key?32:0));};
    const voice=(ch=0,midi=60,connection=0,feedback=3,key=true,pan=0x30,waveform=0)=>{
      const slot=operatorAddress(ch);for(const [op,offset] of [slot,slot+3].entries())for(const [r,v] of [[0x20,0x21+op],[0x40,24+op*6],[0x60,0xf4],[0x80,0x48],[0xe0,waveform]])write(r+offset,v);
      write(0xc0+bankChannel(ch),pan|(feedback<<1)|connection);pitch(ch,midi,key);
    };
    const four=(primary=0,algorithm=0)=>{
      voice(primary,48+primary*2,algorithm&1,7,false);voice(primary+3,48+primary*2,algorithm>>1,0,false);
      const slots=[operatorAddress(primary),operatorAddress(primary)+3,operatorAddress(primary+3),operatorAddress(primary+3)+3];
      for(let op=0;op<4;op++){write(0x20+slots[op],0x21+op);write(0x40+slots[op],12+op*4);write(0xe0+slots[op],op);}
      fourMask|=1<<fourPrimaries.indexOf(primary);write(0x104,fourMask);pitch(primary,48+primary*2);
    };
    const drums=mask=>{for(let ch=6;ch<9;ch++)voice(ch,48+ch*4,0,3,false);write(0xbd,32|mask);};
    write(0x105,1);write(0x104,0);write(4,128);write(4,0);write(8,0);write(0xbd,0);add('mute',0);
    build({add,write,pitch,voice,four,drums,at:value=>{assert(Number.isInteger(value)&&value>=0&&value<totalFrames);frame=value;}});
    events.sort((a,b)=>a.frame-b.frame);scenes.push({name,clock,events,frames:totalFrames,engine,replay,allowSilent,engineOnly,timerExpectedFlag});
  }
  for(let ch=0;ch<18;ch++)for(let connection=0;connection<2;connection++)for(let feedback=0;feedback<8;feedback++)scenario(`two-op/channel${ch}/connection${connection}/feedback${feedback}`,({voice,write,pitch,at})=>{
    voice(ch,45+ch*2,connection,feedback);const slot=operatorAddress(ch);at(701);write(0x20+slot,0xf7);write(0x40+slot,0xdf);at(1703);write(0x80+slot+3,0x9c);at(2801);pitch(ch,60+ch,false);at(3901);pitch(ch,60+ch);at(5101);write(0x60+slot,0xd8);
  },{engine:(ch===0||ch===9)&&connection===0&&feedback===7,replay:(ch===0||ch===9)&&feedback===7});
  for(const primary of fourPrimaries)for(let algorithm=0;algorithm<4;algorithm++)scenario(`four-op/${primary}+${primary+3}/algorithm${algorithm}`,({four,write,pitch,at})=>{
    four(primary,algorithm);const r=bankChannel(primary),slot=operatorAddress(primary+3);at(701);write(0xc0+r,0x10|14|(algorithm&1));at(1703);write(0xc0+r,0x20|14|(algorithm&1));at(2801);write(0xe0+slot,7);at(3901);pitch(primary,72,false);at(5101);pitch(primary,72);
  },{engine:primary===9&&algorithm===3,replay:true});
  for(let ch=0;ch<18;ch++)for(let waveform=0;waveform<8;waveform++)scenario(`waveform/channel${ch}/type${waveform}/NEW-one`,({voice,write,at})=>{
    voice(ch,45+ch*2,0,3,true,0x30,waveform);const slot=operatorAddress(ch);at(701);write(0xe0+slot,waveform^7);at(1703);write(0xe3+slot,waveform^3);at(2801);write(1,0x20);at(3901);write(0xe0+slot,0xf8|waveform);at(5101);write(1,0);
  },{engine:ch===9&&waveform===7,replay:ch===9&&waveform===7});
  for(let buses=0;buses<16;buses++)scenario(`stereo/four-buses/mask${buses}`,({voice,write,at})=>{voice(9,60,1,0,true,buses<<4);for(const [frame,mask] of [[701,buses^3],[1703,buses^12],[2801,5],[3901,10],[5101,15]]){at(frame);write(0x1c0,mask<<4|1);}} ,{engine:buses===5,replay:buses===5});
  for(let waveform=0;waveform<8;waveform++)scenario(`compatibility/NEW-zero/wave${waveform}/high-bank-alias`,({voice,write,at})=>{
    write(0x105,0);voice(0,60,0,3,true,0,waveform);at(701);write(0x1c0,15);at(1703);write(0x1a0,0x51);at(2801);write(0xe0,waveform^7);at(3901);write(0x105,1);write(0xc0,0x31);at(5101);write(0x105,0);
  },{engine:waveform===7,replay:waveform===7});
  for(let flags=0;flags<4;flags++)scenario(`operators/AM-PM/flags${flags}/EGT-KSR`,({voice,write,at})=>{
    voice(9);const mod=0x21|(flags&1?128:0)|(flags&2?64:0);write(0x120,mod);write(0x123,mod);write(0xbd,0xc0);at(701);write(0x120,mod^0x10);at(1703);write(0x123,mod^0x20);at(2801);write(0x140,0xc7);at(3901);write(8,0x40);at(5101);write(0x163,0x96);write(0x183,0x2f);
  });
  for(const [name,mask,group] of [['bassDrum',16,6],['snare',8,7],['tom',4,8],['cymbal',2,8],['hiHat',1,7]])scenario(`rhythm/${name}/group${group}`,({drums,write,at})=>{drums(mask);at(701);write(0xbd,32);at(1703);write(0xbd,32|mask);at(2801);write(0x40+operatorAddress(group),14);at(3901);write(0xbd,32);at(5101);write(0xbd,32|mask);},{replay:true,engine:mask===1});
  for(let mask=0;mask<32;mask++)scenario(`rhythm/all-key-bits/mask${mask}/upper-melody`,({voice,drums,write,at})=>{
    for(const ch of [0,5,9,17])voice(ch,45+ch*2,ch%2,ch%8);drums(mask);at(701);write(0xbd,0xe0);at(1703);write(0xbd,0xff);at(2801);write(0xbd,32|mask);at(3901);write(0xbd,0);at(5101);voice(8,79,1,7);
  });
  for(const mode of [1,2,3,0x21,0x22,0x41,0x43,0x63])scenario(`timer/A-B/mask-clear-control${mode}`,({voice,write,at})=>{
    voice();write(2,255);write(3,253);write(4,mode);at(701);write(4,128);at(1703);write(4,mode);at(2801);write(4,0);write(4,128);at(3901);write(2,249);write(4,mode);at(5101);write(4,0);write(4,128);
  },{replay:mode===1||mode===2,timerExpectedFlag:((mode&1)&&!(mode&64)?64:0)|((mode&2)&&!(mode&32)?32:0)});
  for(const newMode of [0,1])scenario(`CSM/unsupported/NEW-${newMode}/ordinary-key-anchor`,({voice,write,at})=>{
    write(0x105,newMode);voice(0,60,0,3,false);write(8,128);write(2,255);write(4,1);at(701);write(8,0);at(1703);write(8,128);at(2801);write(0xb0,0x31);at(3901);write(0xb0,0x11);at(5101);write(0xb0,0x31);
  },{replay:true,timerExpectedFlag:64});
  scenario('mixed/two-banks/four-op/NEW-transitions/buses',({voice,four,drums,write,at})=>{
    for(let ch=0;ch<18;ch++)voice(ch,40+ch*2,ch%2,ch%8,true,ch%2?0xa0:0x50,ch%8);at(701);four(0,3);four(9,2);drums(31);at(1703);write(0x105,0);write(0x1e0,7);at(2801);write(0x105,1);write(0x1c0,0xa1);at(3901);write(0x104,0);write(0xbd,0);at(5101);four(0,1);four(9,3);
  },{replay:true,engine:true});
  scenario('mute/all-eighteen-groups/high-bits',({voice,add,at})=>{for(let ch=0;ch<18;ch++)voice(ch,40+ch*2,ch%2,7);for(let i=0;i<18;i++){at(101+i*307);add('mute',(1<<i)|(i&1?0xfffc0000:0));}} ,{replay:true});
  scenario('bus/shared-upper-address/pending-data/offset-aliases',({voice,write,add,at})=>{voice(9);at(701);add('bus',6,0xc0);at(1703);add('bus',1,0xf1);at(2309);add('bus',0,0xa0);at(2801);add('bus',7,0x5b);at(3901);write(0x105,0);write(0x1c0,1);at(5101);write(0x105,1);write(0x1b0,0x31);} ,{replay:true,engine:true});
  scenario('reset/raw-free-running/public-recreation',({voice,drums,add,at})=>{voice();drums(31);at(701);add('raw-reset');voice();drums(31);at(1703);add('reset');voice(9);at(2801);drums(31);at(3901);add('reset');at(5101);voice(17,79,1,7);},{replay:true});
  scenario('engine/master-gain/mute-controls',({voice,add,at})=>{voice();voice(17,79,1,7);at(701);add('channel-mute',0,true);at(1703);add('channel-mute',0,false);at(2101);add('volume',.5);at(2801);add('volume',2);at(3901);add('volume',99);at(5101);add('volume',1);},{engine:true,replay:true,engineOnly:true});
  scenario('cold-key-off/default-silence',()=>{},{allowSilent:true});return scenes;
}
const rawChip=actor=>actor.ymf262??actor;
const timing=actor=>actor.ymf262?[actor.remainder,actor.lastLeft,actor.lastRight,actor.volume]:null;
function observation(actor,frame,clock){const chip=rawChip(actor),result={frame,nativeRate:chip.sampleRate(clock),outputRate:actor===chip?null:actor.sampleRate(),status:chip.readStatus(),irq:chip.getIrq(),ports:[0,1,2,3].map(offset=>chip.read(offset))};assert.equal(result.status&0x1f,0);assert.equal(result.irq,Boolean(result.status&0x80));assert.equal(result.ports[0],result.status);assert.equal(result.ports[2],255);assert.equal(result.ports[1],255);assert.equal(result.ports[3],255);return result;}
function execute(actor,scenario,layout,{into=false}={}){
  const chip=rawChip(actor),left=new Float32Array(scenario.frames),right=new Float32Array(scenario.frames),observations=[],hooks=[];let frame=0,hookFrame=0,index=0,next=0;
  chip.setHooks({onWrite:e=>hooks.push({frame:hookFrame,type:'write',...e}),onRead:e=>hooks.push({frame:hookFrame,type:'read',...e}),onIrq:asserted=>hooks.push({frame:hookFrame,type:'irq',asserted})});
  const initialObservation=observation(actor,0,scenario.clock);
  while(frame<scenario.frames){
    hookFrame=frame;
    while(next<scenario.events.length&&scenario.events[next].frame===frame){const {op,args}=scenario.events[next++];
      if(op==='register')writeRegister(chip,...args);
      else if(op==='bus')chip.write(...args);else if(op==='reset')actor.reset();else if(op==='raw-reset')chip.api.reset(chip.handle);else if(op==='mute')chip.setMuteMask(args[0]);
      else if(op==='channel-mute')actor.setChannelMuted(...args);else if(op==='volume')actor.setMasterVolume(args[0]);else throw Error(op);
    }
    const end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity),count=end-frame;assert(count>0);hookFrame=end;
    const pcm=actor===chip?renderRaw(chip,count,into):actor.processFrames(count);assert(!pcm?.then);left.set(pcm.left,frame);right.set(pcm.right,frame);frame=end;observations.push(observation(actor,frame,scenario.clock));
  }
  hookFrame=scenario.frames+probeFrames;const probe=actor===chip?renderRaw(chip,probeFrames,into):actor.processFrames(probeFrames),endObservation=observation(actor,hookFrame,scenario.clock);chip.setHooks();
  for(const array of [left,right,probe.left,probe.right])for(const value of array)assert(Number.isFinite(value));
  return {left,right,probe,initialObservation,observations,hooks,endObservation,endTiming:timing(actor)};
}
function compareResult(actual,expected,label,{observations=true}={}){
  for(const key of ['left','right']){sameBytes(actual[key],expected[key],`${label}/${key}`);sameBytes(actual.probe[key],expected.probe[key],`${label}/post-scenario-${key}`);}
  assert.deepEqual(actual.endTiming,expected.endTiming,`${label}/held-resampler`);assert.deepEqual(actual.endObservation,expected.endObservation,`${label}/post-scenario-read-status-IRQ`);
  if(observations){assert.deepEqual(actual.initialObservation,expected.initialObservation,`${label}/initial-read-status-IRQ`);assert.deepEqual(actual.observations,expected.observations,`${label}/read-status-IRQ`);assert.deepEqual(actual.hooks,expected.hooks,`${label}/actual-hooks`);}
}
function pcmDigest(result){const hash=createHash('sha256');for(const array of [result.left,result.right])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');}
function writeRegister(chip,r,v){const bank=r>>8;assert(bank===0||bank===1);assert(!chip.write(bank*2,r&255)?.then);assert(!chip.write(bank*2+1,v)?.then);}
function renderRaw(chip,n,into=false){
  if(!into)return chip.generateStereo(n);
  const left=new Float32Array(n+4).fill(123.5),right=new Float32Array(n+4).fill(-222.5),l=left.subarray(2,n+2),r=right.subarray(2,n+2);
  assert.equal(chip.generateStereoInto(l,r,n),undefined);for(const i of [0,1,n+2,n+3]){assert.equal(left[i],123.5);assert.equal(right[i],-222.5);}return {left:l,right:r};
}
function program(chip,{ch=0,connection=0,feedback=3,key=true,operatorFlags=0x21,drum=0,skipConnection=false,modWave=0,carrierWave=0,newMode=1,pan=0x30,level=24,carrierLevel=level+6,steady=false}={}){
  writeRegister(chip,0x105,newMode);
  const configure=(channel,active)=>{const slot=operatorAddress(channel);for(const [op,offset] of [slot,slot+3].entries())for(const [r,v] of [[0x20,operatorFlags],[0x40,op?carrierLevel:level],[0x60,steady?0xf0:0xf4],[0x80,steady?0:0x48],[0xe0,op?carrierWave:modWave]])writeRegister(chip,r+offset,v);
    const r=bankChannel(channel);if(!skipConnection)writeRegister(chip,0xc0+r,pan|(feedback<<1)|connection);writeRegister(chip,0xa0+r,0x98);writeRegister(chip,0xb0+r,0x11|(active?32:0));};
  configure(ch,key);if(drum){for(let c=6;c<9;c++)configure(c,false);writeRegister(chip,0xbd,32|drum);}
}
function programFour(chip,primary,algorithm){
  program(chip,{ch:primary,connection:algorithm&1,feedback:7,key:false,level:12,carrierLevel:16});
  program(chip,{ch:primary+3,connection:algorithm>>1,feedback:0,key:false,level:20,carrierLevel:24});
  for(const [index,slot] of [operatorAddress(primary),operatorAddress(primary)+3,operatorAddress(primary+3),operatorAddress(primary+3)+3].entries()){writeRegister(chip,0x20+slot,0x21+index);writeRegister(chip,0xe0+slot,index);}
  writeRegister(chip,0x104,1<<fourPrimaries.indexOf(primary));writeRegister(chip,0xb0+bankChannel(primary),0x31);
}
async function wrapperChecks(backend){
  const chip=await backend.create(),other=await backend.create(),actors=[chip,other];let frames=0;
  const render=(actor,n,into=false)=>{frames+=n;return actor.ymf262?actor.processFrames(n):renderRaw(actor,n,into);};
  const reset=actor=>{actor.setMuteMask(0);actor.reset();};
  const makeEngine=async(outputRate,volume=1)=>{const engine=await Ymf262AudioEngine.create({ymf262ModuleFactory:()=>backend.module,outputSampleRate:outputRate,masterVolume:volume});actors.push(engine);return engine;};
  try{
    for(const name of ['saveState','loadState','supportsState'])assert.equal(typeof chip[name],'undefined');for(const name of ['_ymf262_save_state','_ymf262_load_state'])assert.equal(typeof backend.module[name],'undefined');
    program(chip);program(other);sameBytes(render(chip,701).left,render(other,701).left,'Initial voices match');
    const rates={};for(const clock of rateClocks){rates[clock]=chip.sampleRate(clock);assert.equal(rates[clock],Math.floor(clock/288));}
    chip.generateStereo(0);chip.generateStereoInto(new Float32Array(),new Float32Array(),0);
    for(const n of [-1,.5,Infinity,0x1000001]){assert.throws(()=>chip.generateStereo(n),RangeError);assert.throws(()=>chip.generateStereoInto(new Float32Array(1),new Float32Array(1),n),RangeError);}
    for(const [left,right,n] of [[[],new Float32Array(1),1],[new Float32Array(1),new Float64Array(1),1],[new Float32Array(1),new Float32Array(2),2],[null,new Float32Array(),0]])assert.throws(()=>chip.generateStereoInto(left,right,n),RangeError);
    sameBytes(render(chip,701).left,render(other,701).left,'Rate/zero/invalid queries do not advance source phase');
    for(const actor of [chip,other]){reset(actor);program(actor,{ch:9,pan:0x50});program(actor,{pan:0x20});}
    const ownedReference=render(chip,701),intoReference=render(other,701,true);sameBytes(intoReference.left,ownedReference.left,'Owned/Into left');sameBytes(intoReference.right,ownedReference.right,'Owned/Into right');assert(intoReference.left.some(v=>v!==0)&&intoReference.right.some(v=>v!==0));assert.notEqual(pcmDigest(intoReference),pcmDigest({left:intoReference.right,right:intoReference.left}),'Stereo reference must be asymmetric');
    for(const actor of [chip,other]){reset(actor);program(actor,{ch:9,pan:0xa0});}
    const left=new Float32Array(21).fill(12.5),right=new Float32Array(27).fill(-17.25),l=left.subarray(1,18),r=right.subarray(3,24);assert.equal(chip.generateStereoInto(l,r,13),undefined);frames+=13;
    const reference=render(other,13);sameBytes(l.subarray(0,13),reference.left,'Into caller left subarray');sameBytes(r.subarray(0,13),reference.right,'Into caller right subarray');assert(left.subarray(14).every(v=>v===12.5));assert(right.subarray(16).every(v=>v===-17.25));assert.equal(left[0],12.5);assert(right.subarray(0,3).every(v=>v===-17.25));
    const defaultLeft=new Float32Array(17),defaultRight=new Float32Array(21).fill(88.5);assert.equal(chip.generateStereoInto(defaultLeft,defaultRight),undefined);frames+=17;const defaultReference=render(other,17);sameBytes(defaultLeft,defaultReference.left,'Into default left-length frame count');sameBytes(defaultRight.subarray(0,17),defaultReference.right,'Into default right output');assert(defaultRight.subarray(17).every(v=>v===88.5));
    const waveforms=[];for(const newMode of [0,1])for(let waveform=0;waveform<8;waveform++){
      reset(chip);program(chip,{newMode,modWave:waveform,carrierWave:waveform});const pcm=render(chip,4096);assert(pcm.left.some(v=>v!==0));waveforms.push({newMode,waveform,pcmSha256:pcmDigest(pcm)});
    }
    const modern=waveforms.filter(row=>row.newMode===1),compat=waveforms.filter(row=>row.newMode===0);assert.equal(new Set(modern.map(row=>row.pcmSha256)).size,8);assert.equal(new Set(compat.slice(0,4).map(row=>row.pcmSha256)).size,4);for(let wave=0;wave<4;wave++)assert.equal(compat[wave].pcmSha256,compat[wave+4].pcmSha256,'Compatibility mode masks waveform to low2 bits');
    for(const newMode of [0,1]){for(const actor of [chip,other]){reset(actor);program(actor,{newMode,modWave:7,carrierWave:6});}writeRegister(chip,1,0);writeRegister(other,1,32);sameBytes(render(chip,1024).left,render(other,1024).left,'OPL3 waveform selection is always enabled and ignores OPL2 register01 gate');}
    for(const actor of [chip,other])reset(actor);program(chip,{ch:9,newMode:0});program(other,{ch:0,newMode:0});chip.setMuteMask(1<<9);const alias=render(chip,701);sameBytes(alias.left,render(other,701).left,'NEW0 upper addresses alias physical low-bank voice');assert(alias.left.some(v=>v!==0));sameBytes(alias.left,alias.right,'Compatibility routes mono to busesA+B');chip.setMuteMask(1);assert(render(chip,701).left.every(v=>v===0),'Aliased upper writes belong to physical lower channel0');
    for(const actor of [chip,other]){reset(actor);program(actor,{ch:9});render(actor,701);}writeRegister(chip,0x105,0);const compatibility=render(chip,701);sameBytes(compatibility.left,render(other,701).left,'Switching NEW off does not erase upper-bank phase/register contents');assert(compatibility.left.some(v=>v!==0));writeRegister(chip,0x105,1);sameBytes(render(chip,701).left,render(other,701).left,'Re-enabling NEW preserves upper voice without reprogramming');
    const fourOp=[];for(const primary of fourPrimaries){const algorithms=[];for(let algorithm=0;algorithm<4;algorithm++){
      for(const actor of [chip,other]){reset(actor);programFour(actor,primary,algorithm);}
      const pcm=render(chip,4096);render(other,4096);assert(pcm.left.some(v=>v!==0));algorithms.push(pcmDigest(pcm));
      for(const partner of [primary,primary+3]){other.setMuteMask(1<<partner);const normal=render(chip,701),muted=render(other,701);assert(normal.left.some(v=>v!==0));assert(muted.left.every(v=>v===0)&&muted.right.every(v=>v===0),'Either four-op partner mutes complete connected voice');other.setMuteMask(0);sameBytes(render(other,701).left,render(chip,701).left,'Four-op feedback continues while either partner is muted');}
    }assert.equal(new Set(algorithms).size,4,'All four nonzero-operator connection topologies must differ');fourOp.push({primary,secondary:primary+3,algorithmPcmSha256:algorithms,bothPartnersMuteWholeVoiceAndResume:true});}
    const folds=[];
    for(const voices of [1,2,18]){
      const outputs={};for(const bus of voices===18?[0x10,0x50]:[0x10,0x20,0x40,0x80,0x50,0xa0,0xf0]){
        reset(chip);for(let ch=0;ch<voices;ch++)program(chip,{ch,connection:1,feedback:0,pan:bus,level:0,carrierLevel:0,steady:true});outputs[bus]=render(chip,4096);
      }
      const a=outputs[0x10],fold=outputs[0x50],expected=Float32Array.from(a.left,v=>Math.max(-1,Math.min(32767/32768,v*2)));
      assert(a.left.some(v=>v!==0));assert(a.right.every(v=>v===0));sameBytes(fold.left,expected,'A+C folds then clamps exact single-bus integer sum');assert(fold.right.every(v=>v===0));
      if(voices<18){sameBytes(outputs[0x40].left,a.left,'A/C left buses equal');sameBytes(outputs[0x20].right,a.left,'B right bus equals A reference');sameBytes(outputs[0x80].right,a.left,'B/D right buses equal');for(const bus of [0x20,0x80,0xa0])assert(outputs[bus].left.every(v=>v===0));sameBytes(outputs[0xa0].right,expected,'B+D exact fold/clamp');sameBytes(outputs[0xf0].left,expected,'All buses fold left');sameBytes(outputs[0xf0].right,expected,'All buses fold right');}
      const positive=fold.left.filter(v=>v===32767/32768).length,negative=fold.left.filter(v=>v===-1).length;
      if(voices===1){assert(a.left.every(v=>Math.abs(v)<.5));sameBytes(fold.left,Float32Array.from(a.left,v=>v*2),'Unclipped fold is exactly twice one bus');}
      else {assert(positive>0&&negative>0,'Both actual folded clamp endpoints must be reached');if(voices===2)assert(a.left.every(v=>Math.abs(v)<1),'Two-voice single bus remains unclipped before fold');}
      folds.push({voices,framesPerBus:4096,renderedBusMasks:Object.keys(outputs).map(Number),positiveFoldClampSamples:positive,negativeFoldClampSamples:negative,singleBusPcmSha256:pcmDigest(a),foldPcmSha256:pcmDigest(fold)});
    }
    const timers=[];for(const [name,mode,flag,mask,expectedFirst] of [['A',1,64,64,4],['B',2,32,32,16]]){
      reset(chip);writeRegister(chip,2,255);writeRegister(chip,3,255);writeRegister(chip,4,mode);let first=0;while(first<128&&!chip.getIrq()){render(chip,1);first++;}assert.equal(first,expectedFirst);assert.equal(chip.readStatus()&flag,flag);writeRegister(chip,4,0);writeRegister(chip,4,128);assert.equal(chip.readStatus(),0);render(chip,64);assert.equal(chip.readStatus(),0);
      reset(chip);writeRegister(chip,2,255);writeRegister(chip,3,255);writeRegister(chip,4,mode|mask);render(chip,expectedFirst+1);assert.equal(chip.readStatus(),0);assert.equal(chip.getIrq(),false);writeRegister(chip,4,mode);assert.equal(chip.readStatus()&flag,flag);assert.equal(chip.getIrq(),true);timers.push({name,firstIrqFrame:first,maskVisibilityOnly:true,stopAndClear:true});
    }
    const csm=[];for(const newMode of [0,1]){reset(chip);program(chip,{newMode,key:false});writeRegister(chip,8,128);writeRegister(chip,2,255);writeRegister(chip,4,1);const silent=render(chip,1024);assert(silent.left.every(v=>v===0)&&silent.right.every(v=>v===0),'OPL3 CSM is unsupported even in compatibility mode');assert(chip.readStatus()&64);assert(chip.getIrq());writeRegister(chip,0xb0,0x31);const anchor=render(chip,512);assert(anchor.left.some(v=>v!==0));csm.push({newMode,csmRemainsSilent:true,timerStillAssertsIrq:true,ordinaryKeyOnPcmSha256:pcmDigest(anchor)});}
    const groups=[];for(const [mask,group] of [[16,6],[8,7],[4,8],[2,8],[1,7]]){
      for(const actor of [chip,other]){reset(actor);program(actor,{key:false,drum:mask});render(actor,103);}other.setMuteMask(1<<group);const normal=render(chip,701),muted=render(other,701);assert(normal.left.some(v=>v!==0));assert(muted.left.every(v=>v===0));other.setMuteMask(0);sameBytes(render(other,701).left,render(chip,701).left,'Rhythm mute preserves noise/feedback');groups.push({mask,physicalGroup:group,pcmSha256:pcmDigest(normal)});
    }assert.equal(new Set(groups.map(row=>row.pcmSha256)).size,5);
    for(let ch=0;ch<18;ch++){for(const actor of [chip,other]){reset(actor);program(actor,{ch,feedback:7});render(actor,103);}other.setMuteMask(1<<ch);assert(render(chip,701).left.some(v=>v!==0));assert(render(other,701).left.every(v=>v===0));other.setMuteMask(0);sameBytes(render(other,701).left,render(chip,701).left,'All eighteen melody mutes preserve phase/feedback');}
    for(const actor of [chip,other]){reset(actor);program(actor,{ch:9});}chip.setMuteMask(0xfffc0000);assert.equal(chip.muteMask,0);sameBytes(render(chip,701).left,render(other,701).left,'Public mute mask ignores bits above eighteen');
    chip.write(2,0xc0);sameBytes(render(chip,173).left,render(other,173).left,'Upper pending address does not alter PCM');chip.write(1,0xf1);writeRegister(other,0x1c0,0xf1);sameBytes(render(chip,701).left,render(other,701).left,'Both data ports share the upper pending address');
    for(const actor of [chip,other])actor.api.reset(actor.handle);chip.write(3,0xf1);writeRegister(other,0x105,1);writeRegister(other,0x1c0,0xf1);for(const actor of [chip,other])program(actor,{ch:9,skipConnection:true});const latched=render(chip,701);assert(latched.left.some(v=>v!==0));sameBytes(latched.left,render(other,701).left,'Raw reset retains upper latched address even though NEW resets');
    reset(chip);program(chip,{operatorFlags:0xe1,drum:31});render(chip,1733);chip.api.reset(chip.handle);program(chip,{operatorFlags:0xe1,drum:31});const rawReset=render(chip,4096);reset(other);program(other,{operatorFlags:0xe1,drum:31});const fresh=render(other,4096);assert.notEqual(pcmDigest(rawReset),pcmDigest(fresh));reset(chip);program(chip,{operatorFlags:0xe1,drum:31});const publicReset=render(chip,4096);sameBytes(publicReset.left,fresh.left,'Public reset recreates noise/LFO power-on phase');
    chip.setMuteMask(1<<17);chip.reset();assert.equal(chip.muteMask,1<<17);program(chip,{ch:17});assert(render(chip,701).left.every(v=>v===0));reset(chip);program(chip);render(chip,512);
    const owned=render(chip,17),heldLeft=owned.left.slice(),heldRight=owned.right.slice();assert(heldLeft.some(v=>v!==0));writeRegister(chip,0xa0,0x5f);render(chip,17,true);sameBytes(owned.left,heldLeft,'Owned left survives Into overwrite');sameBytes(owned.right,heldRight,'Owned right survives Into overwrite');const capacity=chip.bufferFrames;render(chip,capacity+1,true);assert(chip.bufferFrames>capacity);sameBytes(owned.left,heldLeft,'Owned left survives real buffer growth');sameBytes(owned.right,heldRight,'Owned right survives real buffer growth');
    const up=await makeEngine(96000),average=await makeEngine(22050),half=await makeEngine(22050,.5),engineChecks=[];
    for(const actor of [up,average,half]){for(const name of ['saveState','loadState','supportsState'])assert.equal(typeof actor[name],'undefined');program(actor.ymf262,{ch:9,pan:0x50});program(actor.ymf262,{pan:0x20});}
    for(const actor of [up,average]){let sourceFrames=0,calls=0;const scratchLeft=actor.scratchLeft,scratchRight=actor.scratchRight,into=actor.ymf262.generateStereoInto.bind(actor.ymf262);actor.ymf262.generateStereo=()=>{throw Error('Engine must use caller-owned Into path');};actor.ymf262.generateStereoInto=(l,r,n)=>{assert.equal(l,scratchLeft);assert.equal(r,scratchRight);assert(n<=scratchLeft.length);sourceFrames+=n;calls++;return into(l,r,n);};const pcm=render(actor,1024);assert.equal(sourceFrames,Math.floor(1024*actor.chipRate/actor.outputRate));assert.equal(actor.remainder,(1024*actor.chipRate)%actor.outputRate);assert.equal(actor.scratchLeft,scratchLeft);assert.equal(actor.scratchRight,scratchRight);assert(pcm.left.some(v=>v!==0)&&pcm.right.some(v=>v!==0));engineChecks.push({outputRate:actor.outputRate,sourceFrames,intoCalls:calls,scratchCapacity:scratchLeft.length,scratchReused:true,ownedGenerationNotCalled:true,outputFrames:1024,pcmSha256:pcmDigest(pcm)});}
    const halfPcm=render(half,1024);average.reset();program(average.ymf262,{ch:9,pan:0x50});program(average.ymf262,{pan:0x20});const fullPcm=render(average,1024);sameBytes(halfPcm.left,Float32Array.from(fullPcm.left,v=>v*.5),'Engine left gain applied once');sameBytes(halfPcm.right,Float32Array.from(fullPcm.right,v=>v*.5),'Engine right gain applied once');for(const v of [NaN,Infinity,'bad'])assert.throws(()=>average.setMasterVolume(v),RangeError);average.setMasterVolume(99);assert.equal(average.volume,3.8);average.setMasterVolume(-1);assert.equal(average.volume,0);
    const before=timing(up);up.processFrames(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>up.processFrames(n),RangeError);assert.deepEqual(timing(up),before);
    return {passed:true,stateApiAbsent:true,rates,intoCallerBuffersAndSentinels:true,intoDefaultCountAndInvalidBuffers:true,ownedAndIntoPcmEqual:true,waveforms,newModeOneHasEightWaves:true,compatibilityHasFourWavesWithoutOpl2Gate:true,upperBankAliasesWhenAddressLatchedInNewZero:true,upperBankContentsSurviveNewToggle:true,fourOp,folds,timers,csm,rhythmGroups:groups,allEighteenMelodyMuteGroups:true,sharedUpperPendingAddressSurvivesRawReset:true,rawResetPcmSha256:pcmDigest(rawReset),powerOnPcmSha256:pcmDigest(fresh),publicResetRecreatesPowerOnRetainsMute:true,ownedBothSidesSurviveIntoOverwriteAndGrowth:true,engineChecks,totalOutputStereoFrames:frames,
      frameCountScope:'All direct chip and Engine output frames in bounded positive self-checks. Engine internal native source frames are separately described and not double-counted.'};
  }finally{for(const actor of actors){actor.dispose();actor.dispose();}}
}
function vgmFixture(clock){
  const scene=scenariosFor(clock).find(s=>s.name.startsWith('mixed/two-banks/')),commands=[];let frame=0;
  for(const event of scene.events.filter(e=>e.op==='register')){const wait=event.frame-frame;if(wait){commands.push(0x61,wait&255,wait>>8);frame=event.frame;}commands.push(0x5e+(event.args[0]>>8),event.args[0]&255,event.args[1]);}
  const samples=7168,remaining=samples-frame;commands.push(0x61,remaining&255,remaining>>8,0x66);
  const bytes=new Uint8Array(0x100+commands.length),view=new DataView(bytes.buffer);bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x151,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x5c,clock,true);view.setUint32(0x18,samples,true);bytes.set(commands,0x100);return {bytes,samples};
}
async function playerChecks(backend){
  const rows=[];let generated=0,delivered=0,requested=0,renders=0,processCalls=0;
  for(const clock of clocks)for(const outputRate of [44100,48000,96000]){
    const engine=await Ymf262AudioEngine.create({ymf262ModuleFactory:()=>backend.module,ymf262Clock:clock,outputSampleRate:outputRate}),fixture=vgmFixture(clock),player=new VgmPlayer(engine);
    const actualProcess=engine.processFrames.bind(engine);engine.processFrames=n=>{generated+=n;renders++;return actualProcess(n);};
    const actualPlayerProcess=player.process.bind(player);player.process=(left,right,n,options)=>{requested+=n;processCalls++;const copied=actualPlayerProcess(left,right,n,options);delivered+=copied;return copied;};
    const read=(frames,layout)=>{const left=new Float32Array(frames),right=new Float32Array(frames);let offset=0,index=0;while(offset<frames){const n=Math.min(frames-offset,layout[index++%layout.length]);assert.equal(player.process(left.subarray(offset,offset+n),right.subarray(offset,offset+n),n),n,'Player must deliver every requested track frame');offset+=n;}return {left,right};};
    try{
      player.load(fixture.bytes);assert.equal(player.supportsState(),false);assert.throws(()=>player.saveState(),/unavailable/);player.setPrefetchFactor(1);player.reset();player.play();
      const total=Math.floor(fixture.samples*outputRate/44100),baseline=read(total,layouts.irregular);assert(baseline.left.some(v=>v!==0));assert(baseline.right.some(v=>v!==0));assert.notEqual(pcmDigest(baseline),pcmDigest({left:baseline.right,right:baseline.left}),'VGM fixture must exercise asymmetric stereo');
      player.reset();player.play();const again=read(total,layouts.regular);sameBytes(again.left,baseline.left,'Real VgmPlayer reset/replay matches complete left PCM');sameBytes(again.right,baseline.right,'Real VgmPlayer reset/replay matches complete right PCM');
      const seeks=[];for(const target of [0,1,701,1703,2345,5101]){
        const outputFrame=Math.floor(target*outputRate/44100),position=await seekPlayback(player,target,{yieldTask:async()=>{}});assert.equal(position,outputFrame*44100/outputRate);assert.equal(player.renderedPositionFrames(),outputFrame);assert.deepEqual(player.checkpointStats(),{count:0,bytes:0});
        player.resume();const pcm=read(257,[17,127,1,64]);sameBytes(pcm.left,baseline.left.subarray(outputFrame,outputFrame+257),'Seek replay from zero restores exact continuation');sameBytes(pcm.right,baseline.right.subarray(outputFrame,outputFrame+257),'Seek replay restores exact right continuation');seeks.push({targetVgmSample:target,outputFrame,frames:257,pcmSha256:pcmDigest(pcm)});
      }
      rows.push({clock,outputRate,fixtureBytes:fixture.bytes.length,fixtureSha256:sha256(fixture.bytes),fixtureVgmSamples:fixture.samples,completeOutputFrames:total,baselinePcmSha256:pcmDigest(baseline),seeks,noStateCheckpoints:true});
    }finally{engine.dispose();}
  }
  return {passed:true,rows,generatedEngineOutputStereoFrames:generated,deliveredPlayerOutputStereoFrames:delivered,requestedPlayerOutputStereoFrames:requested,engineRenderExecutions:renders,playerProcessCalls:processCalls,
    frameCountScope:'Actual Engine processFrames calls include parser render-ahead queues during baseline, reset/replay and all silent seek prefixes. Delivered/requested player frames include the seek-discarded prefix and are a separate view, not added again to generated frame totals.'};
}
async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');
  assert(!sdk.metadata.exports.some(e=>/save_state|load_state/.test(e.name)),'No invented state exports');
  const wrappers=['web/ymf262.js','docs/js/ymf262.js','web/ymf262audioengine.js','docs/js/ymf262audioengine.js'];
  const normalized=bytes=>bytes.toString().replace(/(\.\/(?:ymf262|soundchip|segapsg)\.js)\?v=[^"'\s)]+/g,'$1');for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,layouts,probeFrames,
    method:'Actual generated JS/WASM and unchanged synchronous Ymf262 wrapper/AudioEngine. Exact independent stereo PCM, explicit post-scenario PCM probes, rate/read/status/IRQ hooks, held resampler timing and public reset/replay. Actual VgmPlayer seek rebuilds from zero; no synthetic snapshot/state API, tolerance, mock, Mixer or device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),helpers:await Promise.all(['web/opl_synth.js','web/vgmplayer.js','web/ym2612vgm.js','docs/vgm_analyzer/seek_playback.js'].map(p=>inputFile(resolve(root,p))))},
    wrapperSync:'Byte-identical after removing only deployed ymf262.js/soundchip.js/segapsg.js import cache suffixes; actual hashes retained.',
    authoredInput:'Original synthetic OPL3 two-bank programs: eighteen two-op voices, six four-op pairs and four topologies, eight waveforms, compatibility restrictions, four output buses and five rhythm voices. Into buffers and existing Engine scratch reuse are exercised with actual PCM.',wrapperChecks:{},playerChecks:{},cases:[],scenarioBodyOutputStereoFrames:0,postScenarioProbeOutputStereoFrames:0,totalOutputStereoFrames:0,resetReplayExecutions:0,maximumDifference:0,
    limits:['Native PCM runs at floor(clock/288). Four clamped core buses are folded A+C to left and B+D to right with an additional signed16 clamp, then normalized. Engine cases test averaging/holding at separate output rates, without optional Sega PSG.',
      'NEW1 supplies eighteen channels, six four-op pairs and eight waveforms. NEW0 high addresses alias the lower bank when latched except register105, and waveform selection uses low2 bits. The OPL2 register01 gate is ignored in both modes. Switching NEW does not erase upper register contents.',
      'Actual caller-owned generateStereoInto buffers include offset subarrays, partial counts and sentinel guards. Owned outputs survive Into overwrites and actual capacity growth. Engine source calls use the same preallocated scratch arrays; native source frames are not output frame totals.',
      'No raw save/load exports or public state API exist for this wrapper/Engine. Internal state bytes are not inspected or claimed equivalent; continuation PCM probes, public reset/replay and VgmPlayer seek replay are compared instead.',
      'Raw reset preserves existing free-running counters and pending address; public reset recreates the native handle and reapplies the JS mute mask. Both existing paths are exercised without changing them.',
      'Status has TimerA0x40/TimerB0x20 and IRQ0x80 without fixed0x06. Only bus offset0 modulo4 reads status; others return0xff. Timer minima are4/16 native frames. CSM key-on is disabled in both NEW modes, positively checked with timer IRQ and an ordinary-key audible anchor. Hooks are compared at synchronous chunk boundaries.',
      'VgmPlayer seeks use the existing replay-from-zero helper. Actual rendered Engine frames include prefetch queues and are counted separately from delivered/discarded player frames.',
      'No browser, Worklet scheduling, Native backend, physical hardware, Mixer or listening judgement is tested.']};
  report.wrapperChecks.legacy=await wrapperChecks(legacy);report.wrapperChecks.sdk=await wrapperChecks(sdk);assert.deepEqual(report.wrapperChecks.sdk,report.wrapperChecks.legacy);
  report.totalWrapperSelfCheckOutputStereoFrames=report.wrapperChecks.legacy.totalOutputStereoFrames+report.wrapperChecks.sdk.totalOutputStereoFrames;
  report.playerChecks.legacy=await playerChecks(legacy);report.playerChecks.sdk=await playerChecks(sdk);assert.deepEqual(report.playerChecks.sdk,report.playerChecks.legacy);
  report.totalPlayerGeneratedEngineOutputStereoFrames=report.playerChecks.legacy.generatedEngineOutputStereoFrames+report.playerChecks.sdk.generatedEngineOutputStereoFrames;
  report.totalPlayerDeliveredOutputStereoFrames=report.playerChecks.legacy.deliveredPlayerOutputStereoFrames+report.playerChecks.sdk.deliveredPlayerOutputStereoFrames;
  const jobs=[];for(const clock of clocks)for(const scene of scenariosFor(clock)){
    if(!scene.engineOnly)jobs.push({...scene,kind:'chip',outputRate:null});
    if(scene.engine)for(const outputRate of [44100,48000,96000,192000])jobs.push({...scene,kind:'engine',outputRate,replay:scene.replay&&outputRate===48000,frames:3072,events:scene.events.filter(e=>e.frame<3072)});
  }
  for(const scenario of jobs){
    let regular;
    for(const [layoutName,layout] of Object.entries(layouts)){
      const make=async backend=>{const chip=await backend.create();return scenario.kind==='chip'?chip:new Ymf262AudioEngine(chip,undefined,chip.sampleRate(scenario.clock),scenario.outputRate,1);};
      const a=await make(legacy),b=await make(sdk),label=`${scenario.kind}/${scenario.name}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
      try{
        const options={into:layoutName==='irregular'},x=execute(a,scenario,layout,options),y=execute(b,scenario,layout,options);compareResult(y,x,label);if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        if(scenario.timerExpectedFlag)assert(x.observations.some(o=>(o.status&scenario.timerExpectedFlag)===scenario.timerExpectedFlag&&o.irq),`${label}: timer must actually assert expected status/IRQ`);
        let peak=0;for(const array of [x.left,x.right])for(const value of array)peak=Math.max(peak,Math.abs(value));if(scenario.allowSilent)assert.equal(peak,0,`${label}: intentional key-off silence`);else assert(peak>1e-5,`${label}: reference must actually sound`);
        if(layoutName==='regular'&&scenario.replay){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){rawChip(actor).setMuteMask(0);if(actor.ymf262)actor.setMasterVolume(1);actor.reset();const replayed=execute(actor,scenario,layout);compareResult(replayed,result,`${name}/public-reset-replay`);report.resetReplayExecutions++;report.scenarioBodyOutputStereoFrames+=scenario.frames;report.postScenarioProbeOutputStereoFrames+=probeFrames;}
        }
        report.cases.push({name:scenario.name,kind:scenario.kind,clock:scenario.clock,nativeRate:Math.floor(scenario.clock/288),outputRate:scenario.outputRate,layout:layoutName,generation:scenario.kind==='engine'?'engine-into-scratch':layoutName==='irregular'?'into-caller-buffers':'owned-output',frames:scenario.frames,probeFrames,resetReplayTested:scenario.replay&&layoutName==='regular',peak,pcmSha256:pcmDigest(x),probePcmSha256:pcmDigest(x.probe),observations:x.observations.length,hookEvents:x.hooks.length,maximumDifference:0});report.scenarioBodyOutputStereoFrames+=scenario.frames*2;report.postScenarioProbeOutputStereoFrames+=probeFrames*2;
      }finally{a.dispose();b.dispose();}
    }
  }
  report.rawScenariosPerClock=scenariosFor(clocks[0]).filter(s=>!s.engineOnly).length;report.scenarioConfigurations=jobs.length;report.scenarioRenderExecutions=report.cases.length*2+report.resetReplayExecutions;
  report.totalOutputStereoFrames=report.scenarioBodyOutputStereoFrames+report.postScenarioProbeOutputStereoFrames;report.totalGeneratedOutputStereoFrames=report.totalOutputStereoFrames+report.totalWrapperSelfCheckOutputStereoFrames+report.totalPlayerGeneratedEngineOutputStereoFrames;
  report.frameCountScope='Both builds: main complete body renders plus explicit257-frame post-scenario probes, including selected public reset/replays. Bounded wrapper positives and actual VgmPlayer Engine render-ahead/seek-prefix frames are separate components of totalGeneratedOutputStereoFrames. Engine internal native source frames and player delivered frames are not added twice.';
  report.passed=true;report.completedAt=new Date().toISOString();if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,chipComparisons:report.cases.filter(c=>c.kind==='chip').length,engineComparisons:report.cases.filter(c=>c.kind==='engine').length,totalOutputStereoFrames:report.totalOutputStereoFrames,totalWrapperSelfCheckOutputStereoFrames:report.totalWrapperSelfCheckOutputStereoFrames,totalPlayerGeneratedEngineOutputStereoFrames:report.totalPlayerGeneratedEngineOutputStereoFrames,resetReplayExecutions:report.resetReplayExecutions,maximumDifference:0,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
