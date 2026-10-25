/** Compare two real YM2413 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ym2413} from '../web/ym2413.js';
import {Ym2413AudioEngine} from '../web/ym2413audioengine.js';
import {ym2413PitchFromHz} from '../web/ym2413synth.js';
import {VgmPlayer} from '../web/vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ym2413_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[3579545,4000000,8000000];
const rateClocks=[100000,3579545,3993600,7670454,8000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const totalFrames=6144,probeFrames=257;
const requiredExports=['ym2413_create','ym2413_destroy','ym2413_reset','ym2413_write',
  'ym2413_read','ym2413_read_status','ym2413_get_irq','ym2413_sample_rate',
  'ym2413_generate','ym2413_set_mute_mask','malloc','free'];

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
    assert(!['ym2413_wasm.js','ym2413_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ym2413_wasm.js'),wasm=resolve(directory,'ym2413_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  const create=()=>Ym2413.create({moduleFactory:()=>module});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ym2413');assert(artifact,'YM2413 build receipt entry');
    for(const [name,record] of [['ym2413_wasm.js',metadata.javascript],['ym2413_wasm.wasm',metadata.wasm]]){
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
const userPatch=Uint8Array.of(0x21,0x21,0x10,0x07,0xf6,0xf6,0x45,0x45);
function scenariosFor(clock){
  const scenes=[];
  function scenario(name,build,{engine=false,replay=false,allowSilent=false,engineOnly=false}={}){
    let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v)=>add('register',r,v);
    const patch=bytes=>{for(let i=0;i<8;i++)write(i,bytes[i]);};
    const pitch=(ch,midi,key=true,sustain=false)=>{const p=ym2413PitchFromHz(440*2**((midi-69)/12),clock);write(0x10+ch,p.fnum&255);write(0x20+ch,(p.fnum>>8)|(p.block<<1)|(key?16:0)|(sustain?32:0));};
    const voice=(ch=0,midi=60,instrument=0,attenuation=3)=>{write(0x30+ch,(instrument<<4)|attenuation);pitch(ch,midi);};
    const drums=mask=>{for(let ch=6;ch<9;ch++){write(0x30+ch,0x24);pitch(ch,48+ch*4,false);}write(0x0e,32|mask);};
    patch(userPatch);write(0x0e,0);add('mute',0);
    build({write,add,patch,pitch,voice,drums,at:value=>{assert(Number.isInteger(value)&&value>=0&&value<totalFrames);frame=value;}});
    events.sort((a,b)=>a.frame-b.frame);scenes.push({name,clock,events,frames:totalFrames,engine,replay,allowSilent,engineOnly});
  }
  for(let ch=0;ch<9;ch++)for(let instrument=0;instrument<16;instrument++)scenario(`melody/channel${ch}/instrument${instrument}/sustain-pitch-release`,({voice,pitch,write,at})=>{
    voice(ch,48+ch*4,instrument);at(701);pitch(ch,48+ch*4,true,true);at(1703);write(0x10+ch,253);write(0x20+ch,0x3b);at(2801);write(0x30+ch,(instrument<<4)|11);at(3901);write(0x20+ch,0x0b);at(5101);pitch(ch,72+ch);
  },{engine:ch===0&&(instrument===0||instrument===1),replay:ch===0&&(instrument===0||instrument===1)});
  for(const [name,mask,group] of [['bassDrum',16,6],['snare',8,7],['tom',4,8],['cymbal',2,8],['hiHat',1,7]])scenario(`rhythm/${name}/group${group}/retrigger-level`,({drums,write,at})=>{
    drums(mask);at(701);write(0x0e,32);at(1703);write(0x0e,32|mask);at(2801);write(0x30+group,0x91);at(3901);write(0x0e,32);at(5101);write(0x0e,32|mask);
  },{replay:true,engine:mask===1});
  for(let mask=0;mask<32;mask++)scenario(`rhythm/all-key-bits/mask${mask}/six-melody-voices`,({voice,drums,write,at})=>{
    for(let ch=0;ch<6;ch++)voice(ch,48+ch*4,ch+1,8);drums(mask);at(701);write(0x0e,32);at(1703);write(0x0e,63);at(2801);write(0x0e,32|mask);at(3901);write(0x0e,0);at(5101);voice(8,79,15);
  });
  for(let flags=0;flags<4;flags++)scenario(`user-patch/AM-PM/flags${flags}/waveforms-feedback-EGT`,({patch,voice,write,at})=>{
    const next=userPatch.slice();next[0]|=(flags&1?128:0)|(flags&2?64:0);next[1]|=(flags&1?128:0)|(flags&2?64:0);patch(next);voice();at(701);write(3,0x1f);at(1703);write(2,0xc7);at(2801);write(0,next[0]^0x20);write(1,next[1]^0x20);at(3901);write(4,0x96);write(5,0xc9);at(5101);write(6,0x7f);write(7,0x1f);
  },{replay:flags===3});
  scenario('shared-user-patch/all-nine-voices/independent-instrument-switch',({voice,patch,write,at})=>{
    for(let ch=0;ch<9;ch++)voice(ch,48+ch*4,0,7);at(701);const next=userPatch.map((v,i)=>i<2?v|0xc0:v);patch(next);at(1703);write(0x34,0x13);at(2801);write(1,0xe7);at(3901);write(0x34,3);at(5101);patch(userPatch);
  },{replay:true,engine:true});
  scenario('mute/all-nine-groups/high-bit-mask/feedback-keeps-evolving',({voice,add,at})=>{
    for(let ch=0;ch<9;ch++)voice(ch,48+ch*4,0,7);for(let i=0;i<9;i++){at(101+i*601);add('mute',(1<<i)|(i&1?0xfe00:0));}
  },{replay:true});
  scenario('bus/pending-address/aliases/ignored-high-registers',({voice,write,add,at})=>{
    voice();at(701);add('bus',2,0x30);at(1703);add('bus',3,0x13);at(2309);add('bus',0,0x10);at(2801);add('bus',1,0x5b);at(3901);for(const r of [0x3f,0x40,0x7f,0xff])write(r,0xff);at(5101);write(0x20,0x1b);
  },{replay:true,engine:true});
  scenario('reset/raw-free-running-vs-public-recreation/pending-latch',({voice,drums,write,add,at})=>{
    voice(0,60,0);drums(31);at(701);add('raw-reset');voice(0,60,0);drums(31);at(1703);add('reset');voice(0,60,0);drums(31);at(2801);add('bus',0,0x30);add('raw-reset');add('bus',1,0x13);write(0x10,0x80);write(0x20,0x17);at(3901);add('reset');at(5101);voice(8,79,1);
  },{replay:true});
  scenario('engine/master-gain/mute-controls',({voice,add,at})=>{
    voice(0,60,0);voice(8,79,1);at(701);add('channel-mute',0,true);at(1703);add('channel-mute',0,false);at(2101);add('volume',.5);at(2801);add('volume',2);at(3901);add('volume',99);at(5101);add('volume',1);
  },{engine:true,replay:true,engineOnly:true});
  scenario('cold-key-off/default-silence',()=>{},{allowSilent:true});
  return scenes;
}
const rawChip=actor=>actor.ym2413??actor;
const timing=actor=>actor.ym2413?[actor.remainder,actor.lastSample,actor.volume]:null;
function observation(actor,frame,clock){const chip=rawChip(actor),result={frame,nativeRate:chip.sampleRate(clock),outputRate:actor===chip?null:actor.sampleRate(),status:chip.readStatus(),irq:chip.getIrq(),ports:[0,1,2,3].map(offset=>chip.read(offset))};assert.equal(result.status,0);assert.equal(result.irq,false);assert(result.ports.every(v=>v===0));return result;}
function execute(actor,scenario,layout){
  const chip=rawChip(actor),left=new Float32Array(scenario.frames),right=new Float32Array(scenario.frames),observations=[],hooks=[];let frame=0,hookFrame=0,index=0,next=0;
  chip.setHooks({onWrite:e=>hooks.push({frame:hookFrame,type:'write',...e}),onRead:e=>hooks.push({frame:hookFrame,type:'read',...e}),onIrq:asserted=>hooks.push({frame:hookFrame,type:'irq',asserted})});
  const initialObservation=observation(actor,0,scenario.clock);
  while(frame<scenario.frames){
    hookFrame=frame;
    while(next<scenario.events.length&&scenario.events[next].frame===frame){const {op,args}=scenario.events[next++];
      if(op==='register'){assert(!chip.write(0,args[0])?.then);assert(!chip.write(1,args[1])?.then);}
      else if(op==='bus')chip.write(...args);else if(op==='reset')actor.reset();else if(op==='raw-reset')chip.api.reset(chip.handle);else if(op==='mute')chip.setMuteMask(args[0]);
      else if(op==='channel-mute')actor.setChannelMuted(...args);else if(op==='volume')actor.setMasterVolume(args[0]);else throw Error(op);
    }
    const end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity),count=end-frame;assert(count>0);hookFrame=end;
    const pcm=actor===chip?chip.generateStereo(count):actor.processFrames(count);assert(!pcm?.then);left.set(pcm.left,frame);right.set(pcm.right,frame);frame=end;observations.push(observation(actor,frame,scenario.clock));
  }
  hookFrame=scenario.frames+probeFrames;const probe=actor===chip?chip.generateStereo(probeFrames):actor.processFrames(probeFrames),endObservation=observation(actor,hookFrame,scenario.clock);chip.setHooks();
  for(const array of [left,right,probe.left,probe.right])for(const value of array)assert(Number.isFinite(value));sameBytes(left,right,'OPLL melody/rhythm mix reaches both sides');sameBytes(probe.left,probe.right,'OPLL continuation probe remains mono');
  return {left,right,probe,initialObservation,observations,hooks,endObservation,endTiming:timing(actor)};
}
function compareResult(actual,expected,label,{observations=true}={}){
  for(const key of ['left','right']){sameBytes(actual[key],expected[key],`${label}/${key}`);sameBytes(actual.probe[key],expected.probe[key],`${label}/post-scenario-${key}`);}
  assert.deepEqual(actual.endTiming,expected.endTiming,`${label}/held-resampler`);assert.deepEqual(actual.endObservation,expected.endObservation,`${label}/post-scenario-read-status-IRQ`);
  if(observations){assert.deepEqual(actual.initialObservation,expected.initialObservation,`${label}/initial-read-status-IRQ`);assert.deepEqual(actual.observations,expected.observations,`${label}/read-status-IRQ`);assert.deepEqual(actual.hooks,expected.hooks,`${label}/actual-hooks`);}
}
function pcmDigest(result){const hash=createHash('sha256');for(const array of [result.left,result.right])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');}
function writeRegister(chip,r,v){chip.write(0,r);chip.write(1,v);}
function program(chip,{instrument=0,ch=0,patch=userPatch,key=true,sustain=false,attenuation=3,drum=0}={}){
  for(let i=0;i<8;i++)writeRegister(chip,i,patch[i]);writeRegister(chip,0x30+ch,(instrument<<4)|attenuation);writeRegister(chip,0x10+ch,0x80);writeRegister(chip,0x20+ch,7|(key?16:0)|(sustain?32:0));
  if(drum){for(let c=6;c<9;c++){writeRegister(chip,0x30+c,0x24);writeRegister(chip,0x10+c,0x80);writeRegister(chip,0x20+c,7);}writeRegister(chip,0x0e,32|drum);}
}
async function wrapperChecks(backend){
  const chip=await backend.create(),other=await backend.create(),actors=[chip,other];let frames=0;
  const render=(actor,n)=>{frames+=n;return actor.ym2413?actor.processFrames(n):actor.generateStereo(n);};
  const makeEngine=async(outputRate,volume=1)=>{const engine=await Ym2413AudioEngine.create({ym2413ModuleFactory:()=>backend.module,outputSampleRate:outputRate,masterVolume:volume});actors.push(engine);return engine;};
  try{
    for(const name of ['saveState','loadState','supportsState'])assert.equal(typeof chip[name],'undefined','No synthetic state API');
    for(const name of ['_ym2413_save_state','_ym2413_load_state'])assert.equal(typeof backend.module[name],'undefined','No unsupported state exports');
    const rates={};for(const clock of rateClocks){rates[clock]=chip.sampleRate(clock);assert.equal(rates[clock],Math.floor(clock/72));}
    chip.generateStereo(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>chip.generateStereo(n),RangeError);
    program(chip);program(other);sameBytes(render(chip,701).left,render(other,701).left,'Rate/zero/invalid frame queries do not advance synthesis');
    const builtIn=[];for(let instrument=1;instrument<16;instrument++){chip.reset();program(chip,{instrument});const pcm=render(chip,4096);assert(pcm.left.some(v=>v!==0));builtIn.push({instrument,pcmSha256:pcmDigest(pcm)});}
    assert.equal(new Set(builtIn.map(row=>row.pcmSha256)).size,15,'All built-in instruments select distinct audible voices');
    const modulation=[];for(let flags=0;flags<4;flags++){chip.reset();const patch=userPatch.slice();patch[0]|=(flags&1?128:0)|(flags&2?64:0);patch[1]|=(flags&1?128:0)|(flags&2?64:0);program(chip,{patch});const pcm=render(chip,8192);assert(pcm.left.some(v=>v!==0));modulation.push({flags,pcmSha256:pcmDigest(pcm)});}
    assert.notEqual(modulation[0].pcmSha256,modulation[1].pcmSha256,'AM user-patch bits affect PCM');assert.notEqual(modulation[0].pcmSha256,modulation[2].pcmSha256,'Vibrato user-patch bits affect PCM');
    const waveforms=[];for(let waveform=0;waveform<4;waveform++){chip.reset();const patch=userPatch.slice();patch[3]=(patch[3]&7)|((waveform&1)<<3)|((waveform&2)<<3);program(chip,{patch});const pcm=render(chip,4096);waveforms.push({waveform,pcmSha256:pcmDigest(pcm)});}
    assert.equal(new Set(waveforms.map(row=>row.pcmSha256)).size,4,'Both user operator waveform bits affect PCM');
    const sustain=[];for(const enabled of [false,true]){chip.reset();const patch=userPatch.slice();patch[6]=patch[7]=0x2f;program(chip,{patch,sustain:enabled});render(chip,701);writeRegister(chip,0x20,7|(enabled?32:0));const pcm=render(chip,4096);sustain.push({enabled,releasePcmSha256:pcmDigest(pcm)});}
    assert.notEqual(sustain[0].releasePcmSha256,sustain[1].releasePcmSha256,'Channel sustain changes key-off envelope');
    const groups=[];
    for(const [mask,group] of [[16,6],[8,7],[4,8],[2,8],[1,7]]){
      for(const actor of [chip,other]){actor.setMuteMask(0);actor.reset();program(actor,{key:false,drum:mask});render(actor,103);}
      other.setMuteMask(1<<group);const normal=render(chip,701),muted=render(other,701);assert(normal.left.some(v=>v!==0),`Drum bit${mask} must sound`);assert(muted.left.every(v=>v===0),`Physical group${group} must mute drum bit${mask}`);
      other.setMuteMask(0);const resumed=render(other,701);sameBytes(resumed.left,render(chip,701).left,'Rhythm mute preserves noise/envelope/feedback progression');groups.push({mask,physicalGroup:group,pcmSha256:pcmDigest(normal),unmutePcmSha256:pcmDigest(resumed)});
    }
    assert.equal(new Set(groups.map(row=>row.pcmSha256)).size,5,'Five rhythm keys produce distinct audible instruments');
    for(let ch=0;ch<9;ch++){
      for(const actor of [chip,other]){actor.setMuteMask(0);actor.reset();program(actor,{ch});render(actor,103);}
      other.setMuteMask(1<<ch);const normal=render(chip,701),muted=render(other,701);assert(normal.left.some(v=>v!==0));assert(muted.left.every(v=>v===0));other.setMuteMask(0);sameBytes(render(other,701).left,render(chip,701).left,'Melody mute preserves feedback progression');
    }
    for(const actor of [chip,other]){actor.setMuteMask(0);actor.reset();program(actor);}
    chip.setMuteMask(0xfe00);assert.equal(chip.muteMask,0);sameBytes(render(chip,701).left,render(other,701).left,'Public mute mask ignores high bits');
    chip.reset();other.reset();program(chip);program(other);chip.write(0,0x30);sameBytes(render(chip,173).left,render(other,173).left,'Pending address alone does not alter PCM');chip.write(1,0x13);writeRegister(other,0x30,0x13);sameBytes(render(chip,701).left,render(other,701).left,'Address latch survives generation until data write');
    // Both chips now have the same free-running phase and pending0x30.
    // A raw reset keeps that address; data-only must equal an explicit write.
    for(const actor of [chip,other])actor.api.reset(actor.handle);
    chip.write(1,0xf3);writeRegister(other,0x30,0xf3);
    for(const actor of [chip,other]){writeRegister(actor,0x10,0x80);writeRegister(actor,0x20,0x17);}
    const latchedAfterRawReset=render(chip,701),explicitAfterRawReset=render(other,701);assert(latchedAfterRawReset.left.some(v=>v!==0));sameBytes(latchedAfterRawReset.left,explicitAfterRawReset.left,'Raw reset retains the pending bus address');
    const phasePatch=userPatch.slice();phasePatch[0]=phasePatch[1]=0xe1;
    chip.reset();program(chip,{patch:phasePatch,drum:31});render(chip,1733);chip.api.reset(chip.handle);program(chip,{patch:phasePatch,drum:31});const rawReset=render(chip,4096);
    other.reset();program(other,{patch:phasePatch,drum:31});const fresh=render(other,4096);assert.notEqual(pcmDigest(rawReset),pcmDigest(fresh),'Raw reset retains free-running noise/LFO/envelope phase');
    chip.reset();program(chip,{patch:phasePatch,drum:31});const publicReset=render(chip,4096);sameBytes(publicReset.left,fresh.left,'Public reset recreates exact power-on waveform');
    chip.setMuteMask(0x100);chip.reset();assert.equal(chip.muteMask,0x100);program(chip,{ch:8});assert(render(chip,701).left.every(v=>v===0),'Public reset reapplies mute mask');chip.setMuteMask(0);chip.reset();program(chip);render(chip,512);
    const owned=render(chip,17),held=owned.left.slice();assert(held.some(v=>v!==0));writeRegister(chip,0x10,0x5f);render(chip,17);sameBytes(owned.left,held,'Owned PCM survives same-buffer overwrite');const capacity=chip.bufferFrames;render(chip,capacity+1);assert(chip.bufferFrames>capacity);sameBytes(owned.left,held,'Owned PCM survives buffer growth');
    const up=await makeEngine(96000),average=await makeEngine(22050),half=await makeEngine(22050,.5);const engineChecks=[];
    for(const actor of [up,average,half]){for(const name of ['saveState','loadState','supportsState'])assert.equal(typeof actor[name],'undefined');program(actor.ym2413);}
    for(const actor of [up,average]){let sourceFrames=0;const generate=actor.ym2413.generateStereo.bind(actor.ym2413);actor.ym2413.generateStereo=n=>{sourceFrames+=n;return generate(n);};const pcm=render(actor,1024);assert.equal(sourceFrames,Math.floor(1024*actor.chipRate/actor.outputRate));assert.equal(actor.remainder,(1024*actor.chipRate)%actor.outputRate);assert(pcm.left.some(v=>v!==0));engineChecks.push({outputRate:actor.outputRate,sourceFrames,outputFrames:1024,pcmSha256:pcmDigest(pcm)});}
    const halfPcm=render(half,1024);average.reset();program(average.ym2413);const fullPcm=render(average,1024);sameBytes(halfPcm.left,Float32Array.from(fullPcm.left,v=>v*.5),'Engine master gain applied once');
    for(const value of [NaN,Infinity,'bad'])assert.throws(()=>average.setMasterVolume(value),RangeError);average.setMasterVolume(99);assert.equal(average.volume,3.8);average.setMasterVolume(-1);assert.equal(average.volume,0);
    const before=timing(up);up.processFrames(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>up.processFrames(n),RangeError);assert.deepEqual(timing(up),before);
    return {passed:true,stateApiAbsent:true,rates,builtIn,modulation,waveforms,sustain,rhythmGroups:groups,allNineMelodyMuteGroups:true,unknownMuteBitsIgnored:true,pendingAddressSurvivesGeneration:true,rawResetRetainsPendingAddress:true,rawResetDiffersFromPowerOn:true,publicResetRecreatesPowerOnRetainsMute:true,resetPcm:{raw:pcmDigest(rawReset),fresh:pcmDigest(fresh),public:pcmDigest(publicReset)},ownedPcmSurvivesOverwriteAndGrowth:true,engineChecks,totalOutputStereoFrames:frames,
      frameCountScope:'All raw/public chip and Engine output frames in bounded positive self-checks. Native source frames produced internally by Engine resampling are reported separately and not double-counted.'};
  }finally{for(const actor of actors){actor.dispose();actor.dispose();}}
}
function vgmFixture(clock){
  const scene=scenariosFor(clock).find(s=>s.name.startsWith('shared-user-patch/')),commands=[];let frame=0;
  for(const event of scene.events.filter(e=>e.op==='register')){const wait=event.frame-frame;if(wait){commands.push(0x61,wait&255,wait>>8);frame=event.frame;}commands.push(0x51,...event.args);}
  const samples=7168,remaining=samples-frame;commands.push(0x61,remaining&255,remaining>>8,0x66);
  const bytes=new Uint8Array(0x40+commands.length),view=new DataView(bytes.buffer);bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x150,true);view.setUint32(0x10,clock,true);view.setUint32(0x18,samples,true);bytes.set(commands,0x40);return {bytes,samples};
}
async function playerChecks(backend){
  const rows=[];let generated=0,delivered=0,requested=0,renders=0,processCalls=0;
  for(const clock of clocks)for(const outputRate of [44100,48000,96000]){
    const engine=await Ym2413AudioEngine.create({ym2413ModuleFactory:()=>backend.module,ym2413Clock:clock,outputSampleRate:outputRate}),fixture=vgmFixture(clock),player=new VgmPlayer(engine);
    const actualProcess=engine.processFrames.bind(engine);engine.processFrames=n=>{generated+=n;renders++;return actualProcess(n);};
    const actualPlayerProcess=player.process.bind(player);player.process=(left,right,n,options)=>{requested+=n;processCalls++;const copied=actualPlayerProcess(left,right,n,options);delivered+=copied;return copied;};
    const read=(frames,layout)=>{const left=new Float32Array(frames),right=new Float32Array(frames);let offset=0,index=0;while(offset<frames){const n=Math.min(frames-offset,layout[index++%layout.length]);assert.equal(player.process(left.subarray(offset,offset+n),right.subarray(offset,offset+n),n),n,'Player must deliver every requested track frame');offset+=n;}return {left,right};};
    try{
      player.load(fixture.bytes);assert.equal(player.supportsState(),false);assert.throws(()=>player.saveState(),/unavailable/);player.setPrefetchFactor(1);player.reset();player.play();
      const total=Math.floor(fixture.samples*outputRate/44100),baseline=read(total,layouts.irregular);assert(baseline.left.some(v=>v!==0));sameBytes(baseline.left,baseline.right,'VGM mono reaches both sides');
      player.reset();player.play();const again=read(total,layouts.regular);sameBytes(again.left,baseline.left,'Real VgmPlayer reset/replay matches complete reference PCM');
      const seeks=[];for(const target of [0,1,701,1703,2345,5101]){
        const outputFrame=Math.floor(target*outputRate/44100),position=await seekPlayback(player,target,{yieldTask:async()=>{}});assert.equal(position,outputFrame*44100/outputRate);assert.equal(player.renderedPositionFrames(),outputFrame);assert.deepEqual(player.checkpointStats(),{count:0,bytes:0});
        player.resume();const pcm=read(257,[17,127,1,64]);sameBytes(pcm.left,baseline.left.subarray(outputFrame,outputFrame+257),'Seek replay from zero restores exact continuation');sameBytes(pcm.left,pcm.right,'Seek continuation mono');seeks.push({targetVgmSample:target,outputFrame,frames:257,pcmSha256:pcmDigest(pcm)});
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
  const wrappers=['web/ym2413.js','docs/js/ym2413.js','web/ym2413audioengine.js','docs/js/ym2413audioengine.js'];
  const normalized=bytes=>bytes.toString().replace(/(\.\/(?:ym2413|soundchip|segapsg)\.js)\?v=[^"'\s)]+/g,'$1');for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,layouts,probeFrames,
    method:'Actual generated JS/WASM and unchanged synchronous Ym2413 wrapper/AudioEngine. Exact mono stereo PCM, explicit post-scenario PCM probes, rate/read/status/IRQ hooks, held resampler timing and public reset/replay. Actual VgmPlayer seek rebuilds from zero; no synthetic snapshot/state API, tolerance, mock, Mixer or device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),helpers:await Promise.all(['web/ym2413synth.js','web/vgmplayer.js','web/ym2612vgm.js','docs/vgm_analyzer/seek_playback.js'].map(p=>inputFile(resolve(root,p))))},
    wrapperSync:'Byte-identical after removing only deployed ym2413.js/soundchip.js/segapsg.js import cache suffixes; actual hashes retained.',
    userPatch:{bytes:Array.from(userPatch),sha256:sha256(userPatch),origin:'Original synthetic authored user patch; built-in instruments are supplied by the existing core.'},wrapperChecks:{},playerChecks:{},cases:[],scenarioBodyOutputStereoFrames:0,postScenarioProbeOutputStereoFrames:0,totalOutputStereoFrames:0,resetReplayExecutions:0,maximumDifference:0,
    limits:['Native PCM runs at floor(clock/72). The wrapper sums melody and percussion mono outputs to both sides. Engine cases test averaging/holding at separate output rates, without optional Sega PSG.',
      'No raw save/load exports or public state API exist for this wrapper/Engine. Internal state bytes are not inspected or claimed equivalent; continuation PCM probes, public reset/replay and VgmPlayer seek replay are compared instead.',
      'Raw reset preserves existing free-running counters and pending address; public reset recreates the native handle and reapplies the JS mute mask. Both existing paths are exercised without changing them.',
      'OPLL read/status compatibility APIs return zero and IRQ remains false; real hook notifications are compared at synchronous API/chunk boundaries.',
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
      const make=async backend=>{const chip=await backend.create();return scenario.kind==='chip'?chip:new Ym2413AudioEngine(chip,undefined,chip.sampleRate(scenario.clock),scenario.outputRate,1);};
      const a=await make(legacy),b=await make(sdk),label=`${scenario.kind}/${scenario.name}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
      try{
        const x=execute(a,scenario,layout),y=execute(b,scenario,layout);compareResult(y,x,label);if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        let peak=0;for(const value of x.left)peak=Math.max(peak,Math.abs(value));if(scenario.allowSilent)assert.equal(peak,0,`${label}: intentional key-off silence`);else assert(peak>1e-5,`${label}: reference must actually sound`);
        if(layoutName==='regular'&&scenario.replay){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){rawChip(actor).setMuteMask(0);if(actor.ym2413)actor.setMasterVolume(1);actor.reset();const replayed=execute(actor,scenario,layout);compareResult(replayed,result,`${name}/public-reset-replay`);report.resetReplayExecutions++;report.scenarioBodyOutputStereoFrames+=scenario.frames;report.postScenarioProbeOutputStereoFrames+=probeFrames;}
        }
        report.cases.push({name:scenario.name,kind:scenario.kind,clock:scenario.clock,nativeRate:Math.floor(scenario.clock/72),outputRate:scenario.outputRate,layout:layoutName,frames:scenario.frames,probeFrames,resetReplayTested:scenario.replay&&layoutName==='regular',peak,pcmSha256:pcmDigest(x),probePcmSha256:pcmDigest(x.probe),observations:x.observations.length,hookEvents:x.hooks.length,maximumDifference:0});report.scenarioBodyOutputStereoFrames+=scenario.frames*2;report.postScenarioProbeOutputStereoFrames+=probeFrames*2;
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
