/** Compare two real Y8950 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Y8950} from '../web/y8950.js';
import {Y8950AudioEngine} from '../web/y8950audioengine.js';
import {oplPitchFromHz} from '../web/opl_synth.js';
import {VgmPlayer} from '../web/vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_y8950_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[3579545,4000000,8000000];
const rateClocks=[100000,3579545,3993600,7670454,8000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const totalFrames=6144,probeFrames=257;
const requiredExports=['y8950_create','y8950_destroy','y8950_reset','y8950_write',
  'y8950_read','y8950_read_status','y8950_get_irq','y8950_sample_rate',
  'y8950_generate','y8950_set_mute_mask','y8950_load_memory','y8950_clear_memory','malloc','free'];

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
    assert(!['y8950_wasm.js','y8950_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'y8950_wasm.js'),wasm=resolve(directory,'y8950_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);assert(module.HEAPU8 instanceof Uint8Array);
  const create=()=>Y8950.create({moduleFactory:()=>module});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='y8950');assert(artifact,'Y8950 build receipt entry');
    for(const [name,record] of [['y8950_wasm.js',metadata.javascript],['y8950_wasm.wasm',metadata.wasm]]){
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
const operatorSlots=[0,1,2,8,9,10,16,17,18];
const sampleBytes=Uint8Array.from({length:512},(_,i)=>[0x77,0x77,0xff,0xff,0x13,0x9a,0x45,0xcd][i%8]);
function adpcmWrites(write,{start=0,bytes=sampleBytes.length,delta=10546,repeat=true,level=220,mode=2,control}={}){
  const shift=(mode&3)?5:2;assert.equal(start%(1<<shift),0);assert.equal(bytes%(1<<shift),0);const first=start>>shift,last=((start+bytes)>>shift)-1;
  for(const [r,v] of [[8,mode],[9,first&255],[10,first>>8],[11,last&255],[12,last>>8],[13,0x23],[14,3],[16,delta&255],[17,delta>>8],[18,level],[7,control??(repeat?0xb0:0xa0)]])write(r,v);
}
function startAdpcm(chip,options={}){adpcmWrites((r,v)=>writeRegister(chip,r,v),options);}

function scenariosFor(clock){
  const scenes=[];
  function scenario(name,build,{engine=false,replay=false,allowSilent=false,engineOnly=false,timerExpectedFlag}={}){
    let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v)=>add('register',r,v);
    const pitch=(ch,midi,key=true)=>{const p=oplPitchFromHz(440*2**((midi-69)/12),clock,'y8950');write(0xa0+ch,p.fnum&255);write(0xb0+ch,(p.fnum>>8)|(p.block<<2)|(key?32:0));};
    const voice=(ch=0,midi=60,connection=0,feedback=3,key=true)=>{
      const slot=operatorSlots[ch];for(const [op,offset] of [slot,slot+3].entries())for(const [r,v] of [[0x20,0x21+op],[0x40,24+op*6],[0x60,0xf4],[0x80,0x48],[0xe0,0]])write(r+offset,v);
      write(0xc0+ch,(feedback<<1)|connection);pitch(ch,midi,key);
    };
    const drums=mask=>{for(let ch=6;ch<9;ch++)voice(ch,48+ch*4,0,3,false);write(0xbd,0x20|mask);};
    write(4,0x80);write(4,0);write(8,0);write(0xbd,0);add('mute',0);
    build({add,write,pitch,voice,drums,at:value=>{assert(Number.isInteger(value)&&value>=0&&value<totalFrames);frame=value;}});
    events.sort((a,b)=>a.frame-b.frame);scenes.push({name,clock,events,frames:totalFrames,engine,replay,allowSilent,engineOnly,timerExpectedFlag});
  }
  for(let ch=0;ch<9;ch++)for(let connection=0;connection<2;connection++)for(let feedback=0;feedback<8;feedback++)scenario(`melody/channel${ch}/connection${connection}/feedback${feedback}`,({voice,write,pitch,at})=>{
    voice(ch,48+ch*4,connection,feedback);const slot=operatorSlots[ch];at(701);write(0x20+slot,0x77);write(0x40+slot,0xdf);at(1703);write(0x80+slot+3,0x9c);at(2801);pitch(ch,72+ch,false);at(3901);pitch(ch,72+ch);at(5101);write(0x60+slot,0xd8);
  },{engine:ch===0&&feedback===7,replay:ch===0&&feedback===7});
  for(let flags=0;flags<4;flags++)for(let depth=0;depth<4;depth++)scenario(`operators/AM-PM/flags${flags}/depth${depth}/EGT-KSR`,({voice,write,at})=>{
    voice();const mod=0x21|(flags&1?128:0)|(flags&2?64:0);write(0x20,mod);write(0x23,mod);write(0xbd,depth<<6);
    at(701);write(0x20,mod^0x10);at(1703);write(0x23,mod^0x20);at(2801);write(0x40,0xc7);at(3901);write(8,0x40);at(5101);write(0x63,0x96);write(0x83,0x2f);
  },{engine:flags===3&&depth===3,replay:flags===3&&depth===3});
  scenario('operators/all-multipliers/half-rate-aliases',({voice,write,at})=>{voice();for(let multiple=0;multiple<16;multiple++){at(multiple*347);write(0x20,0x20|multiple);write(0x23,0x20|(15-multiple));}});
  scenario('OPL1/sine-only/ignored-OPL2-waveform-registers',({voice,write,at})=>{voice();write(1,0x20);for(let waveform=0;waveform<8;waveform++){at(101+waveform*701);write(0xe0,waveform);write(0xe3,waveform^3);}} ,{replay:true});
  for(const [name,mask,group] of [['bassDrum',16,6],['snare',8,7],['tom',4,8],['cymbal',2,8],['hiHat',1,7]])scenario(`rhythm/${name}/group${group}/retrigger`,({drums,write,at})=>{
    drums(mask);at(701);write(0xbd,32);at(1703);write(0xbd,32|mask);at(2801);write(0x40+operatorSlots[group],14);at(3901);write(0xbd,32);at(5101);write(0xbd,32|mask);
  },{replay:true,engine:mask===1});
  for(let mask=0;mask<32;mask++)scenario(`rhythm/all-key-bits/mask${mask}/six-melody-voices`,({voice,drums,write,at})=>{
    for(let ch=0;ch<6;ch++)voice(ch,48+ch*4,ch%2,ch%8);drums(mask);at(701);write(0xbd,0xe0);at(1703);write(0xbd,0xff);at(2801);write(0xbd,32|mask);at(3901);write(0xbd,0);at(5101);voice(8,79,1,7);
  });
  for(const mode of [1,2,3,0x21,0x22,0x41,0x43,0x63])scenario(`timer/A-B/mask-clear-control${mode}`,({voice,write,at})=>{
    voice();write(2,255);write(3,253);write(4,mode);at(701);write(4,128);at(1703);write(4,mode);at(2801);write(4,0);write(4,128);at(3901);write(2,249);write(4,mode);at(5101);write(4,0);write(4,128);
  },{replay:mode===1||mode===2,timerExpectedFlag:((mode&1)&&!(mode&64)?64:0)|((mode&2)&&!(mode&32)?32:0)});
  for(const mode of [1,3,0x21,0x41,0x61])scenario(`CSM/all-nine/no-ordinary-key-on/control${mode}`,({voice,write,at})=>{
    for(let ch=0;ch<9;ch++)voice(ch,48+ch*4,0,ch%8,false);write(2,255);write(3,253);write(8,128);write(4,mode);at(701);write(4,128);at(1703);write(4,mode);at(2801);write(8,0);at(3901);write(8,128);at(5101);write(2,249);
  },{engine:mode===0x41,replay:mode===1||mode===0x41,timerExpectedFlag:((mode&1)&&!(mode&64)?64:0)|((mode&2)&&!(mode&32)?32:0)});
  scenario('mixed/nine-operators/rhythm-mode-transitions',({voice,drums,write,at})=>{
    for(let ch=0;ch<9;ch++)voice(ch,48+ch*4,ch%2,ch%8);at(701);drums(31);at(1703);write(0xbd,0xe9);at(2801);write(0xbd,0);for(let ch=6;ch<9;ch++)voice(ch,60+ch,1,7);at(3901);drums(6);at(5101);write(0xbd,0);
  },{replay:true,engine:true});
  scenario('mute/all-nine-groups/high-bit-mask/feedback-keeps-evolving',({voice,add,at})=>{
    for(let ch=0;ch<9;ch++)voice(ch,48+ch*4,ch%2,7);for(let i=0;i<9;i++){at(101+i*601);add('mute',(1<<i)|(i&1?0xfe00:0));}
  },{replay:true});
  scenario('bus/pending-address/aliases/byte-truncation',({voice,write,add,at})=>{
    voice();at(701);add('bus',2,0xc0);at(1703);add('bus',3,15);at(2309);add('bus',0,0xa0);at(2801);add('bus',1,0x5b);at(3901);write(0xff,0xff);write(0x1c0,0x10f);at(5101);write(0xb0,0x31);
  },{replay:true,engine:true});
  scenario('reset/raw-free-running-vs-public-recreation/LFO-noise-latch',({voice,drums,write,add,at})=>{
    voice(0,60,0,7);drums(31);at(701);add('raw-reset');voice(0,60,0,7);drums(31);at(1703);add('reset');voice(0,60,0,7);drums(31);at(2801);add('bus',0,0xc0);add('raw-reset');add('bus',1,15);at(3901);add('reset');at(5101);voice(8,79,1,7);
  },{replay:true});
  scenario('engine/master-gain/mute-controls',({voice,add,at})=>{
    voice(0,60,0,7);voice(8,79,1,7);at(701);add('channel-mute',0,true);at(1703);add('channel-mute',0,false);at(2101);add('volume',.5);at(2801);add('volume',2);at(3901);add('volume',99);at(5101);add('volume',1);
  },{engine:true,replay:true,engineOnly:true});
  for(const delta of [1,2048,10546,32768,65535])for(const mode of [0,1,2,3])scenario(`ADPCM/external/delta${delta}/memory-mode${mode}`,({write,add,at})=>{
    add('memory',sampleBytes,0,512);adpcmWrites(write,{delta,mode});at(701);write(18,73);at(1703);write(7,1);at(2801);adpcmWrites(write,{delta,mode,repeat:false});at(3901);write(8,mode|0xc0);at(5101);adpcmWrites(write,{delta:65535,mode});
  },{replay:true,engine:mode===2&&(delta===10546||delta===65535)});
  for(const address of [0,0x1fffc0])scenario(`ADPCM/sample-memory/address${address}/end-stop-repeat`,({write,add,at})=>{
    add('memory',sampleBytes.subarray(0,64),address,address+64);adpcmWrites(write,{start:address,bytes:64,delta:65535,repeat:false});at(701);adpcmWrites(write,{start:address,bytes:64,delta:65535});at(1703);add('mute',512);at(2801);add('mute',0);at(3901);write(7,1);at(5101);adpcmWrites(write,{start:address,bytes:64,delta:32768});
  },{replay:true,engine:address===0});
  scenario('ADPCM/resize-grow-shrink-clear/outside-memory-zero',({voice,write,add,at})=>{
    voice();add('memory',sampleBytes,0,512);adpcmWrites(write);at(701);add('memory',Uint8Array.of(0x77,0xff),511,4096);at(1703);add('memory',new Uint8Array(),0,16);at(2801);add('clear-memory');at(3901);add('memory',sampleBytes,4096,4608);adpcmWrites(write,{start:4096});at(5101);add('memory',new Uint8Array(),0,8192);
  },{replay:true});
  scenario('ADPCM/CPU-external-record/raw-and-public-reset',({voice,write,add,at})=>{
    voice();add('memory',sampleBytes,0,512);adpcmWrites(write,{control:0x60});for(let i=0;i<64;i++)write(15,(i*53)&255);adpcmWrites(write);at(701);add('raw-reset');voice();adpcmWrites(write);at(1703);add('reset');voice();adpcmWrites(write);at(2801);adpcmWrites(write,{control:0x60});for(let i=0;i<32;i++)write(15,255-i);adpcmWrites(write);at(3901);add('memory',Uint8Array.of(0x77,0xff),31,512);at(5101);add('reset');voice();adpcmWrites(write);
  },{replay:true,engine:true});
  scenario('ADPCM/CPU-driven-ready-data-feed',({voice,write,at})=>{
    voice();adpcmWrites(write,{control:0x80,delta:65535});for(let frame=0;frame<totalFrames;frame+=97){at(frame);write(15,(frame*13)&255);}at(1703);write(7,1);at(2801);adpcmWrites(write,{control:0x80,delta:32768});
  },{replay:true});
  scenario('mixed/FM-rhythm-ADPCM/sample-data-patches',({voice,drums,write,add,at})=>{
    for(let ch=0;ch<6;ch++)voice(ch,48+ch*4,ch%2,ch%8);add('memory',sampleBytes,0,512);adpcmWrites(write);at(701);drums(31);at(1703);add('memory',sampleBytes.map(v=>v^0x88),0,512);write(18,80);at(2801);write(7,1);at(3901);add('memory',sampleBytes,1024,1536);adpcmWrites(write,{start:1024});at(5101);write(18,220);write(0xbd,0);
  },{replay:true,engine:true});
  scenario('engine/FM-ADPCM-independent-mutes',({voice,write,add,at})=>{
    voice();add('memory',sampleBytes,0,512);adpcmWrites(write);at(701);add('adpcm-mute',true);at(1703);add('adpcm-mute',false);add('channel-mute',0,true);at(2101);add('all-mute',true);at(2801);add('all-mute',false);at(3901);add('channel-mute',0,false);at(5101);write(7,1);
  },{replay:true,engine:true,engineOnly:true});
  scenario('cold-key-off/default-silence',()=>{},{allowSilent:true});
  return scenes;
}
const rawChip=actor=>actor.y8950??actor;
const timing=actor=>actor.y8950?[actor.remainder,actor.lastLeft,actor.lastRight,actor.volume]:null;
function observation(actor,frame,clock){
  const chip=rawChip(actor),result={frame,nativeRate:chip.sampleRate(clock),outputRate:actor===chip?null:actor.sampleRate(),status:chip.readStatus(),irq:chip.getIrq(),evenPorts:[chip.read(0),chip.read(2)]};
  assert.equal(result.status&6,0);assert.equal(result.irq,Boolean(result.status&0x80));for(const value of result.evenPorts)assert.equal(value,result.status);return result;
}
function execute(actor,scenario,layout){
  const chip=rawChip(actor),left=new Float32Array(scenario.frames),right=new Float32Array(scenario.frames),observations=[],hooks=[];let frame=0,hookFrame=0,index=0,next=0;
  chip.setHooks({onWrite:e=>hooks.push({frame:hookFrame,type:'write',...e}),onRead:e=>hooks.push({frame:hookFrame,type:'read',...e}),onIrq:asserted=>hooks.push({frame:hookFrame,type:'irq',asserted})});
  const initialObservation=observation(actor,0,scenario.clock);
  while(frame<scenario.frames){
    hookFrame=frame;
    while(next<scenario.events.length&&scenario.events[next].frame===frame){const {op,args}=scenario.events[next++];
      if(op==='register'){assert(!chip.write(0,args[0])?.then);assert(!chip.write(1,args[1])?.then);}
      else if(op==='bus')chip.write(...args);else if(op==='reset')actor.reset();else if(op==='raw-reset')chip.api.reset(chip.handle);else if(op==='mute')chip.setMuteMask(args[0]);
      else if(op==='memory')chip.loadSampleMemory(...args);else if(op==='clear-memory')chip.clearSampleMemory();else if(op==='adpcm-mute')actor.setAdpcmMuted(...args);else if(op==='all-mute')actor.setY8950Muted(...args);else if(op==='read')chip.read(...args);
      else if(op==='channel-mute')actor.setChannelMuted(...args);else if(op==='volume')actor.setMasterVolume(args[0]);else throw Error(op);
    }
    const end=Math.min(scenario.frames,frame+layout[index++%layout.length],scenario.events[next]?.frame??Infinity),count=end-frame;assert(count>0);hookFrame=end;
    const pcm=actor===chip?chip.generateStereo(count):actor.processFrames(count);assert(!pcm?.then);left.set(pcm.left,frame);right.set(pcm.right,frame);frame=end;observations.push(observation(actor,frame,scenario.clock));
  }
  hookFrame=scenario.frames+probeFrames;const probe=actor===chip?chip.generateStereo(probeFrames):actor.processFrames(probeFrames),endObservation=observation(actor,hookFrame,scenario.clock);chip.setHooks();
  for(const array of [left,right,probe.left,probe.right])for(const value of array)assert(Number.isFinite(value));sameBytes(left,right,'OPL melody/rhythm mix reaches both sides');sameBytes(probe.left,probe.right,'OPL continuation probe remains mono');
  return {left,right,probe,initialObservation,observations,hooks,endObservation,endTiming:timing(actor),uploadedMirrorSha256:sha256(chip.sampleMemory)};
}
function compareResult(actual,expected,label,{observations=true}={}){
  for(const key of ['left','right']){sameBytes(actual[key],expected[key],`${label}/${key}`);sameBytes(actual.probe[key],expected.probe[key],`${label}/post-scenario-${key}`);}
  assert.equal(actual.uploadedMirrorSha256,expected.uploadedMirrorSha256,`${label}/uploaded-memory-mirror`);assert.deepEqual(actual.endTiming,expected.endTiming,`${label}/held-resampler`);assert.deepEqual(actual.endObservation,expected.endObservation,`${label}/post-scenario-read-status-IRQ`);
  if(observations){assert.deepEqual(actual.initialObservation,expected.initialObservation,`${label}/initial-read-status-IRQ`);assert.deepEqual(actual.observations,expected.observations,`${label}/read-status-IRQ`);assert.deepEqual(actual.hooks,expected.hooks,`${label}/actual-hooks`);}
}
function pcmDigest(result){const hash=createHash('sha256');for(const array of [result.left,result.right])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');}
function writeRegister(chip,r,v){chip.write(0,r);chip.write(1,v);}
function program(chip,{ch=0,connection=0,feedback=3,key=true,operatorFlags=0x21,drum=0,skipConnection=false}={}){
  const configure=(channel,active)=>{const slot=operatorSlots[channel];for(const [op,offset] of [slot,slot+3].entries())for(const [r,v] of [[0x20,operatorFlags],[0x40,24+op*6],[0x60,0xf4],[0x80,0x48]])writeRegister(chip,r+offset,v);
    if(!skipConnection)writeRegister(chip,0xc0+channel,(feedback<<1)|connection);writeRegister(chip,0xa0+channel,0x80);writeRegister(chip,0xb0+channel,0x11|(active?32:0));};
  configure(ch,key);if(drum){for(let c=6;c<9;c++)configure(c,false);writeRegister(chip,0xbd,0x20|drum);}
}
async function memoryChecks(backend){
  const a=await backend.create(),b=await backend.create(),c=await backend.create(),actors=[a,b,c];let frames=0;
  const render=(actor,n)=>{frames+=n;return actor.y8950?actor.processFrames(n):actor.generateStereo(n);};
  const fresh=(chip,data=sampleBytes)=>{chip.clearSampleMemory();chip.setMuteMask(0);chip.reset();if(data.length)chip.loadSampleMemory(data);};
  const equal=(x,y,label)=>{sameBytes(x.left,y.left,label+'/left');sameBytes(x.right,y.right,label+'/right');};
  const rawLoad=(chip,data,offset,memorySize)=>{const ptr=chip.module._malloc(data.length||1);try{chip.module.HEAPU8.set(data,ptr);assert.equal(chip.api.loadMemory(chip.handle,ptr,data.length,offset,memorySize),1);}finally{chip.module._free(ptr);}};
  try{
    for(const chip of [a,b]){fresh(chip);program(chip);render(chip,103);}
    for(const args of [[[],0,0],[sampleBytes,-1,512],[sampleBytes,0,511],[new Uint8Array(),0,2097153],[new Uint8Array(),.5,1],[new Uint8Array(),2,1]])assert.throws(()=>a.loadSampleMemory(...args),RangeError);
    for(const args of [[0,0,0,2097153],[0,0,2097153,2097152],[0,1,2097152,2097152]])assert.equal(a.api.loadMemory(a.handle,...args),0,'Raw invalid ranges reject before reading the source pointer');
    equal(render(a,701),render(b,701),'Invalid memory calls do not advance FM phase');
    fresh(a,new Uint8Array());const upload=Uint8Array.of(17,34,51);a.loadSampleMemory(upload,5,16);upload.fill(255);assert.deepEqual(Array.from(a.sampleMemory),[0,0,0,0,0,17,34,51,0,0,0,0,0,0,0,0]);
    a.loadSampleMemory(Uint8Array.of(68),6,24);assert.equal(a.sampleMemory.length,24);assert.equal(a.sampleMemory[5],17);assert.equal(a.sampleMemory[6],68);assert(a.sampleMemory.subarray(16).every(v=>v===0));a.loadSampleMemory(new Uint8Array(),0,8);assert.equal(a.sampleMemory.length,8);a.loadSampleMemory(new Uint8Array(),0,24);assert(a.sampleMemory.subarray(8).every(v=>v===0));
    const memoryCases=[];
    for(const [name,setupA,setupB,options] of [
      ['grow-zero-fills-and-preserves-prefix',chip=>{chip.loadSampleMemory(sampleBytes.subarray(0,64));chip.loadSampleMemory(new Uint8Array(),0,512);},chip=>{const bytes=new Uint8Array(512);bytes.set(sampleBytes.subarray(0,64));chip.loadSampleMemory(bytes);},{bytes:512,delta:65535}],
      ['shrink-drops-trailing-data-before-zero-regrowth',chip=>{chip.loadSampleMemory(sampleBytes.subarray(0,128));chip.loadSampleMemory(new Uint8Array(),0,32);chip.loadSampleMemory(new Uint8Array(),0,128);},chip=>{const bytes=new Uint8Array(128);bytes.set(sampleBytes.subarray(0,32));chip.loadSampleMemory(bytes);},{start:32,bytes:96,delta:65535}],
      ['clear-retains-decoder-independent-zero-external-reads',chip=>{chip.loadSampleMemory(sampleBytes);chip.clearSampleMemory();},chip=>{chip.loadSampleMemory(new Uint8Array(512));},{bytes:512,delta:65535}],
      ['out-of-range-external-reads-equal-allocated-zeroes',chip=>{chip.loadSampleMemory(sampleBytes.subarray(0,32));},chip=>{const bytes=new Uint8Array(128);bytes.set(sampleBytes.subarray(0,32));chip.loadSampleMemory(bytes);},{start:64,bytes:64,delta:65535}],
      ['last-64-bytes-at-2MiB-equal-low-address-reference',chip=>{chip.loadSampleMemory(sampleBytes.subarray(0,64),2097088,2097152);},chip=>chip.loadSampleMemory(sampleBytes.subarray(0,64)),{start:2097088,bytes:64,delta:65535}],
    ]){
      fresh(a,new Uint8Array());fresh(b,new Uint8Array());setupA(a);setupB(b);startAdpcm(a,options);startAdpcm(b,{...options,start:name.startsWith('last-')?0:options.start});const pcm=render(a,1024);equal(pcm,render(b,1024),name);assert(pcm.left.some(v=>v!==0));memoryCases.push({name,renderedOutputStereoFrames:2048,pcmSha256:pcmDigest(pcm),uploadedMirrorBytes:[a.sampleMemory.length,b.sampleMemory.length]});
    }
    // Clear changes external storage only; held decoder history is deliberately not called an immediate stop.
    for(const chip of [a,b]){fresh(chip);startAdpcm(chip);render(chip,173);}a.clearSampleMemory();rawLoad(b,new Uint8Array(),0,0);const clearTail=render(a,64);equal(clearTail,render(b,64),'Public clear and raw storage clear preserve the same in-flight decoder history');assert(clearTail.left.some(v=>v!==0),'Clear does not reset the decoder accumulator immediately');
    const patch=Uint8Array.from({length:64},(_,i)=>(i*53+19)&255),patched=sampleBytes.slice();patched.set(patch,31);
    for(const chip of [a,b,c])fresh(chip);rawLoad(a,patch,31,512);b.loadSampleMemory(patched);assert.deepEqual(a.sampleMemory,sampleBytes,'Raw C memory writes do not update the JS upload mirror');for(const chip of [a,b])startAdpcm(chip);const rawPatch=render(a,1024);equal(rawPatch,render(b,1024),'Raw C upload patches actual RAM independently of JS mirror');
    for(const chip of [a,b]){chip.api.reset(chip.handle);startAdpcm(chip);}equal(render(a,1024),render(b,1024),'Raw reset retains actual externally patched RAM');
    for(const chip of [a,b,c]){chip.reset();startAdpcm(chip);}const restoredMirror=render(a,1024),patchedAfterReset=render(b,1024);equal(restoredMirror,render(c,1024),'Public reset reloads JS-uploaded bytes');assert.notEqual(pcmDigest(restoredMirror),pcmDigest(patchedAfterReset));
    const cpuPatch=Uint8Array.from({length:64},(_,i)=>(i*29+7)&255),cpuExpected=sampleBytes.slice();cpuExpected.set(cpuPatch);
    for(const chip of [a,b,c])fresh(chip);adpcmWrites((r,v)=>writeRegister(a,r,v),{control:0x60});for(const value of cpuPatch)writeRegister(a,15,value);writeRegister(a,7,1);b.loadSampleMemory(cpuExpected);assert.deepEqual(a.sampleMemory,sampleBytes,'CPU external recording also bypasses JS mirror');for(const chip of [a,b])startAdpcm(chip,{delta:65535});const recorded=render(a,2048);equal(recorded,render(b,2048),'CPU record data bytes enter native RAM in order');
    for(const chip of [a,b]){chip.api.reset(chip.handle);startAdpcm(chip,{delta:65535});}equal(render(a,1024),render(b,1024),'Raw reset preserves CPU-recorded bytes');
    for(const chip of [a,b,c]){chip.reset();startAdpcm(chip,{delta:65535});}const cpuPublicReset=render(a,1024);equal(cpuPublicReset,render(c,1024),'Public reset intentionally replaces CPU-recorded RAM with upload mirror');assert.notEqual(pcmDigest(cpuPublicReset),pcmDigest(render(b,1024)));
    fresh(a);fresh(b);adpcmWrites((r,v)=>writeRegister(a,r,v),{bytes:32,control:0x60});for(let i=0;i<64;i++)writeRegister(a,15,cpuPatch[i]);const endExpected=sampleBytes.slice();endExpected.set(cpuPatch.subarray(0,31));b.loadSampleMemory(endExpected);for(const chip of [a,b]){writeRegister(chip,7,1);startAdpcm(chip,{bytes:32,delta:65535});}equal(render(a,1024),render(b,1024),'Existing CPU record endpoint refuses writes when current address is the configured final byte');
    for(const chip of [a,b])fresh(chip,new Uint8Array());adpcmWrites((r,v)=>writeRegister(a,r,v),{bytes:32,control:0x60});for(const value of cpuPatch)writeRegister(a,15,value);for(const chip of [a,b]){writeRegister(chip,7,1);chip.loadSampleMemory(new Uint8Array(),0,32);startAdpcm(chip,{bytes:32,delta:65535});}equal(render(a,1024),render(b,1024),'Writes outside allocated memory are discarded rather than retained after growth');
    const speed=[];for(const delta of [2048,10546,32768,65535]){fresh(a);startAdpcm(a,{delta});const pcm=render(a,1024);assert(pcm.left.some(v=>v!==0));speed.push({delta,pcmSha256:pcmDigest(pcm)});}assert.equal(new Set(speed.map(row=>row.pcmSha256)).size,4,'Delta-N audibly changes playback speed');
    fresh(a);fresh(b,sampleBytes.map(v=>((v&15)<<4)|(v>>4)));for(const chip of [a,b])startAdpcm(chip,{delta:65535});assert.notEqual(pcmDigest(render(a,1024)),pcmDigest(render(b,1024)),'High/low sample nibbles affect decoder output in order');
    for(const chip of [a,b])fresh(chip);startAdpcm(a,{level:0});startAdpcm(b,{level:220});assert(render(a,701).left.every(v=>v===0));assert(render(b,701).left.some(v=>v!==0));
    const granularity=[];for(const mode of [0,1,2,3]){fresh(a);for(const [r,v]of[[8,mode],[9,1],[10,0],[11,2],[12,0],[16,255],[17,255],[18,220],[7,0xb0]])writeRegister(a,r,v);const pcm=render(a,1024);granularity.push({mode,pcmSha256:pcmDigest(pcm)});}assert.notEqual(granularity[0].pcmSha256,granularity[2].pcmSha256,'Register08 memory mode changes start/end address granularity');assert.equal(granularity[1].pcmSha256,granularity[2].pcmSha256);assert.equal(granularity[2].pcmSha256,granularity[3].pcmSha256);
    fresh(a);startAdpcm(a,{bytes:32,delta:65535,repeat:false});assert(a.readStatus()&1);let endFrame=0;while(endFrame<256&&!(a.readStatus()&16)){render(a,1);endFrame++;}assert(endFrame>0&&endFrame<256);assert.equal(a.readStatus()&1,0);assert.equal(a.getIrq(),false,'The current FM IRQ mask does not include ADPCM EOS');writeRegister(a,4,128);assert(a.readStatus()&16,'IRQ clear does not erase a live decoder EOS flag');writeRegister(a,4,16);assert.equal(a.readStatus()&16,0,'Control mask hides live EOS');writeRegister(a,4,0);assert(a.readStatus()&16);writeRegister(a,7,1);assert.equal(a.readStatus()&17,0);assert(render(a,64).left.every(v=>v===0));
    fresh(a);startAdpcm(a,{bytes:32,delta:65535});const repeating=render(a,512);assert.equal(a.readStatus()&17,1);assert(repeating.left.subarray(400).some(v=>v!==0),'Repeat actually wraps beyond several32-byte passes without EOS');writeRegister(a,7,1);assert(render(a,64).left.every(v=>v===0),'ADPCM reset/stop clears decoder output');
    fresh(a,new Uint8Array());startAdpcm(a,{control:0x80,delta:65535});let cpuFeedAudible=false;const cpuReady=[];for(const value of [0x77,0xff,0x15,0xa3]){writeRegister(a,15,value);assert.equal(a.readStatus()&8,0);const pcm=render(a,8);cpuFeedAudible ||= pcm.left.some(v=>v!==0);assert(a.readStatus()&8);cpuReady.push({value,afterEightFramesStatus:a.readStatus(),pcmSha256:pcmDigest(pcm)});}assert(cpuFeedAudible,'CPU-driven data feed actually reaches the decoder');
    const reads=[];for(const [register,want]of[[5,0],[9,0],[0x19,0],[0x1a,0],[15,255],[255,255]]){writeRegister(a,0x18,15);writeRegister(a,0x19,255);a.write(0,register);const values=[a.read(1),a.read(3)];assert.deepEqual(values,[want,want]);reads.push({register,values});}
    // ADPCM output is mono; register08 high bits belong to FM and cannot fictitiously pan it.
    for(const chip of [a,b])fresh(chip);startAdpcm(a,{mode:2});startAdpcm(b,{mode:0xc2});const mono=render(a,1024);equal(mono,render(b,1024),'Register08 FM bits do not pan the ADPCM output');sameBytes(mono.left,mono.right,'ADPCM is copied to both external outputs');
    for(const chip of [a,b,c]){fresh(chip);program(chip);if(chip!==c)startAdpcm(chip);render(chip,103);}a.setMuteMask(512);equal(render(a,701),render(c,701),'ADPCM mute leaves FM intact');render(b,701);a.setMuteMask(0);equal(render(a,701),render(b,701),'ADPCM mute continues decoding and resumes exact phase');
    for(const chip of [a,b,c]){fresh(chip);if(chip!==b)program(chip);startAdpcm(chip);render(chip,103);}a.setMuteMask(511);equal(render(a,701),render(b,701),'Nine FM mute bits leave the tenth ADPCM voice intact');render(c,701);a.setMuteMask(0);equal(render(a,701),render(c,701),'FM muted feedback and ADPCM resume exact mixed continuation');
    const makeEngine=async()=>{const engine=await Y8950AudioEngine.create({y8950ModuleFactory:()=>backend.module,outputSampleRate:96000});actors.push(engine);fresh(engine.y8950);program(engine.y8950);startAdpcm(engine.y8950);return engine;},engine=await makeEngine(),referenceEngine=await makeEngine();
    render(engine,103);render(referenceEngine,103);engine.setY8950Muted(true);const muted=render(engine,701);assert(muted.left.every(v=>v===0)&&muted.right.every(v=>v===0));render(referenceEngine,701);engine.setY8950Muted(false);const clearedHeldPrefix=Math.max(0,Math.ceil((engine.outputRate-engine.remainder)/engine.chipRate)-1),resumed=render(engine,701),running=render(referenceEngine,701);assert(resumed.left.subarray(0,clearedHeldPrefix).every(v=>v===0));equal({left:resumed.left.subarray(clearedHeldPrefix),right:resumed.right.subarray(clearedHeldPrefix)},{left:running.left.subarray(clearedHeldPrefix),right:running.right.subarray(clearedHeldPrefix)},'Engine resumes both running sources at the next native sample after clearing held output');
    engine.setAdpcmMuted(true);assert.equal(engine.y8950.muteMask,512);engine.setChannelMuted(0,true);assert.equal(engine.y8950.muteMask,513);engine.reset();assert.equal(engine.y8950.muteMask,513);engine.setAdpcmMuted(false);engine.setChannelMuted(0,false);assert.equal(engine.y8950.muteMask,0);
    return {passed:true,memoryCases,rangeValidation:true,publicUploadCopiesBytes:true,growZeroFillsAndShrinkDropsData:true,rawCUploadDoesNotUpdateJsMirror:true,cpuRecordDoesNotUpdateJsMirror:true,rawResetRetainsActualRam:true,publicResetReloadsUploadedMirror:true,cpuRecordEndpointOmitsFinalByte:true,outOfBoundsCpuWritesDiscarded:true,clearPreservesDecoderHistory:true,clearTailPcmSha256:pcmDigest(clearTail),rawPatchPcmSha256:pcmDigest(rawPatch),cpuRecordPcmSha256:pcmDigest(recorded),speed,granularity,levelZeroSilent:true,endFlags:{firstEosFrame:endFrame,repeatWrapFrames:512,repeatPcmSha256:pcmDigest(repeating),maskHidesButDoesNotErase:true,irqClearDoesNotEraseDecoderEos:true,adpcmEosDoesNotAssertCurrentIrqMask:true},cpuReady,explicitDataReads:reads,
      dataReadLimit:'The current Y8950 read_data switch exposes09/1a as ADPCM read indices0x02/0x13, not CPU-data index8. They return0;0f returnsff. No public external-RAM readback/dummy-cursor or serialized-memory API is invented. RAM contents are observed through independently uploaded expected ADPCM PCM.',
      adpcmMonoNotFictitiousPan:true,independentFmAndAdpcmMutesPreservePhase:true,engineMutePreservesBothSourcePhases:true,engineMuteClearsHeldPrefixUntilNextSourceSample:clearedHeldPrefix,totalOutputStereoFrames:frames};
  }finally{for(const actor of actors){actor.dispose();actor.dispose();}}
}
async function wrapperChecks(backend){
  const chip=await backend.create(),other=await backend.create(),actors=[chip,other];let frames=0;
  const render=(actor,n)=>{frames+=n;return actor.y8950?actor.processFrames(n):actor.generateStereo(n);};
  const makeEngine=async(outputRate,volume=1)=>{const engine=await Y8950AudioEngine.create({y8950ModuleFactory:()=>backend.module,outputSampleRate:outputRate,masterVolume:volume});actors.push(engine);return engine;};
  try{
    for(const name of ['saveState','loadState','supportsState','generateStereoInto'])assert.equal(typeof chip[name],'undefined','No synthetic state or Into API');for(const name of ['_y8950_save_state','_y8950_load_state'])assert.equal(typeof backend.module[name],'undefined');
    const rates={};for(const clock of rateClocks){rates[clock]=chip.sampleRate(clock);assert.equal(rates[clock],Math.floor(clock/72));}
    chip.generateStereo(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>chip.generateStereo(n),RangeError);program(chip);program(other);sameBytes(render(chip,701).left,render(other,701).left,'Rate/zero/invalid queries do not advance synthesis');
    const connectionFeedback=[];for(let connection=0;connection<2;connection++)for(let feedback=0;feedback<8;feedback++){chip.reset();program(chip,{connection,feedback});const pcm=render(chip,4096);assert(pcm.left.some(v=>v!==0));connectionFeedback.push({connection,feedback,pcmSha256:pcmDigest(pcm)});}
    assert.notEqual(connectionFeedback[0].pcmSha256,connectionFeedback[7].pcmSha256,'Feedback0/7 affect PCM');assert.notEqual(connectionFeedback[0].pcmSha256,connectionFeedback[8].pcmSha256,'FM and additive connections differ');
    const modulation=[];for(let flags=0;flags<4;flags++){chip.reset();program(chip,{operatorFlags:0x21|(flags&1?128:0)|(flags&2?64:0)});writeRegister(chip,0xbd,0xc0);const pcm=render(chip,8192);assert(pcm.left.some(v=>v!==0));modulation.push({flags,pcmSha256:pcmDigest(pcm)});}
    assert.notEqual(modulation[0].pcmSha256,modulation[1].pcmSha256,'AM operator bits affect PCM');assert.notEqual(modulation[0].pcmSha256,modulation[2].pcmSha256,'Vibrato operator bits affect PCM');
    const sineOnly=[];for(const waveform of [0,1,2,3,7,255]){chip.reset();program(chip);writeRegister(chip,1,0x20);writeRegister(chip,0xe0,waveform);writeRegister(chip,0xe3,waveform^3);const pcm=render(chip,4096);sineOnly.push({waveform,pcmSha256:pcmDigest(pcm)});}
    assert.equal(new Set(sineOnly.map(row=>row.pcmSha256)).size,1,'Y8950 OPL1 ignores OPL2 waveform selection and remains sine-only');
    const envelopes=[];for(const sustain of [false,true]){chip.reset();program(chip,{operatorFlags:sustain?0x21:1});for(const r of [0x60,0x63])writeRegister(chip,r,0xff);for(const r of [0x80,0x83])writeRegister(chip,r,0x28);const pcm=render(chip,8192);envelopes.push({sustain,pcmSha256:pcmDigest(pcm)});}assert.notEqual(envelopes[0].pcmSha256,envelopes[1].pcmSha256,'EGT sustain changes held envelope');
    const timers=[];for(const [name,mode,flag,mask,expectedFirst] of [['A',1,64,64,4],['B',2,32,32,16]]){
      chip.reset();writeRegister(chip,2,255);writeRegister(chip,3,255);writeRegister(chip,4,mode);let first=0;while(first<128&&!chip.getIrq()){render(chip,1);first++;}
      assert.equal(first,expectedFirst);assert.equal(chip.readStatus()&flag,flag);assert.equal(chip.readStatus()&0x80,0x80);writeRegister(chip,4,0);writeRegister(chip,4,128);assert.equal(chip.readStatus(),8);assert.equal(chip.getIrq(),false);render(chip,64);assert.equal(chip.readStatus(),8,'Stopped timer cannot reassert after clear');
      chip.reset();writeRegister(chip,2,255);writeRegister(chip,3,255);writeRegister(chip,4,mode|mask);render(chip,expectedFirst+1);assert.equal(chip.getIrq(),false);writeRegister(chip,4,mode);assert.equal(chip.readStatus()&flag,flag,'Unmask without a masked status read reveals the running timer flag');assert.equal(chip.getIrq(),true);
      chip.reset();writeRegister(chip,2,255);writeRegister(chip,3,255);writeRegister(chip,4,mode|mask);render(chip,expectedFirst+1);assert.equal(chip.readStatus(),8,'Masked status read suppresses the flag and synchronizes the visible live status back into FM');writeRegister(chip,4,mode);assert.equal(chip.readStatus()&flag,0,'Y8950 status synchronization clears a timer flag that was hidden at read time');render(chip,expectedFirst);assert.equal(chip.readStatus()&flag,flag,'The timer nevertheless kept running and reasserts');
      timers.push({name,firstIrqFrame:first,flag,unmaskWithoutReadRevealsRunningFlag:true,maskedStatusReadClearsHiddenFlag:true,timerReassertsAfterUnmask:true,stopAndIrqClear:true});
    }
    const csm=[];for(let ch=0;ch<9;ch++){
      chip.reset();program(chip,{ch,key:false});const silence=render(chip,32);assert(silence.left.every(v=>v===0));writeRegister(chip,8,128);writeRegister(chip,2,255);writeRegister(chip,4,0x41);const pcm=render(chip,512);assert(pcm.left.some(v=>v!==0),`Masked Timer A CSM must sound on physical channel${ch}`);assert.equal(chip.getIrq(),false);assert.equal(chip.readStatus(),8);csm.push({channel:ch,maskedTimerCsmPcmSha256:pcmDigest(pcm)});
    }
    const groups=[];for(const [mask,group] of [[16,6],[8,7],[4,8],[2,8],[1,7]]){
      for(const actor of [chip,other]){actor.setMuteMask(0);actor.reset();program(actor,{key:false,drum:mask});render(actor,103);}
      other.setMuteMask(1<<group);const normal=render(chip,701),muted=render(other,701);assert(normal.left.some(v=>v!==0));assert(muted.left.every(v=>v===0));other.setMuteMask(0);const resumed=render(other,701);sameBytes(resumed.left,render(chip,701).left,'Rhythm mute preserves noise/envelope/feedback progression');groups.push({mask,physicalGroup:group,pcmSha256:pcmDigest(normal)});
    }
    assert.equal(new Set(groups.map(row=>row.pcmSha256)).size,5,'Five drum keys produce distinct audible instruments');
    for(let ch=0;ch<9;ch++){
      for(const actor of [chip,other]){actor.setMuteMask(0);actor.reset();program(actor,{ch,feedback:7});render(actor,103);}
      other.setMuteMask(1<<ch);const normal=render(chip,701),muted=render(other,701);assert(normal.left.some(v=>v!==0));assert(muted.left.every(v=>v===0));other.setMuteMask(0);sameBytes(render(other,701).left,render(chip,701).left,'Melody mute preserves feedback progression');
    }
    for(const actor of [chip,other]){actor.setMuteMask(0);actor.reset();program(actor);}
    chip.setMuteMask(0xfffffc00);assert.equal(chip.muteMask,0);sameBytes(render(chip,701).left,render(other,701).left,'High mute bits are ignored');
    chip.reset();other.reset();program(chip);program(other);chip.write(0,0xc0);sameBytes(render(chip,173).left,render(other,173).left,'Pending address alone does not alter PCM');chip.write(1,15);writeRegister(other,0xc0,15);sameBytes(render(chip,701).left,render(other,701).left,'Pending address survives generation until data write');
    for(const actor of [chip,other])actor.api.reset(actor.handle);chip.write(1,15);writeRegister(other,0xc0,15);for(const actor of [chip,other])program(actor,{skipConnection:true});const latched=render(chip,701);assert(latched.left.some(v=>v!==0));sameBytes(latched.left,render(other,701).left,'Raw reset retains pending bus address');
    chip.reset();program(chip,{operatorFlags:0xe1,drum:31});render(chip,1733);chip.api.reset(chip.handle);program(chip,{operatorFlags:0xe1,drum:31});const rawReset=render(chip,4096);
    other.reset();program(other,{operatorFlags:0xe1,drum:31});const fresh=render(other,4096);assert.notEqual(pcmDigest(rawReset),pcmDigest(fresh),'Raw reset retains free-running noise/LFO/envelope phase');chip.reset();program(chip,{operatorFlags:0xe1,drum:31});const publicReset=render(chip,4096);sameBytes(publicReset.left,fresh.left,'Public reset recreates exact power-on waveform');
    chip.setMuteMask(0x100);chip.reset();assert.equal(chip.muteMask,0x100);program(chip,{ch:8});assert(render(chip,701).left.every(v=>v===0));chip.setMuteMask(0);chip.reset();program(chip);render(chip,512);
    const owned=render(chip,17),held=owned.left.slice(),heldRight=owned.right.slice();assert(held.some(v=>v!==0));writeRegister(chip,0xa0,0x5f);render(chip,17);sameBytes(owned.left,held,'Owned left survives same-buffer overwrite');sameBytes(owned.right,heldRight,'Owned right survives same-buffer overwrite');const capacity=chip.bufferFrames;render(chip,capacity+1);assert(chip.bufferFrames>capacity);sameBytes(owned.left,held,'Owned left survives buffer growth');sameBytes(owned.right,heldRight,'Owned right survives buffer growth');
    const up=await makeEngine(96000),average=await makeEngine(22050),half=await makeEngine(22050,.5),engineChecks=[];
    for(const actor of [up,average,half]){for(const name of ['saveState','loadState','supportsState'])assert.equal(typeof actor[name],'undefined');program(actor.y8950);}
    for(const actor of [up,average]){let sourceFrames=0;const generate=actor.y8950.generateStereo.bind(actor.y8950);actor.y8950.generateStereo=n=>{sourceFrames+=n;return generate(n);};const pcm=render(actor,1024);assert.equal(sourceFrames,Math.floor(1024*actor.chipRate/actor.outputRate));assert.equal(actor.remainder,(1024*actor.chipRate)%actor.outputRate);assert(pcm.left.some(v=>v!==0));engineChecks.push({outputRate:actor.outputRate,sourceFrames,outputFrames:1024,pcmSha256:pcmDigest(pcm)});}
    const halfPcm=render(half,1024);average.reset();program(average.y8950);const fullPcm=render(average,1024);sameBytes(halfPcm.left,Float32Array.from(fullPcm.left,v=>v*.5),'Engine master gain applied once');for(const v of [NaN,Infinity,'bad'])assert.throws(()=>average.setMasterVolume(v),RangeError);average.setMasterVolume(99);assert.equal(average.volume,3.8);average.setMasterVolume(-1);assert.equal(average.volume,0);
    const before=timing(up);up.processFrames(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>up.processFrames(n),RangeError);assert.deepEqual(timing(up),before);
    const adpcmMemory=await memoryChecks(backend);frames+=adpcmMemory.totalOutputStereoFrames;
    return {passed:true,stateApiAbsent:true,adpcmMemory,rates,connectionFeedback,modulation,sineOnly,envelopes,timers,csm,rhythmGroups:groups,allNineMelodyMuteGroups:true,unknownMuteBitsIgnored:true,pendingAddressSurvivesGeneration:true,rawResetRetainsPendingAddress:true,rawResetDiffersFromPowerOn:true,publicResetRecreatesPowerOnRetainsMute:true,resetPcm:{raw:pcmDigest(rawReset),fresh:pcmDigest(fresh),public:pcmDigest(publicReset)},ownedPcmSurvivesOverwriteAndGrowth:true,engineChecks,totalOutputStereoFrames:frames,
      frameCountScope:'All raw/public chip and Engine output frames in bounded positive self-checks. Native source frames produced internally by Engine resampling are reported separately and not double-counted.'};
  }finally{for(const actor of actors){actor.dispose();actor.dispose();}}
}
function vgmFixture(clock){
  const scene=scenariosFor(clock).find(s=>s.name.startsWith('mixed/FM-rhythm-ADPCM/')),commands=[];let frame=0;
  for(const event of scene.events.filter(e=>['register','memory','clear-memory'].includes(e.op))){
    const wait=event.frame-frame;if(wait){commands.push(0x61,wait&255,wait>>8);frame=event.frame;}
    if(event.op==='register')commands.push(0x5c,...event.args);
    else if(event.op==='memory'){
      const [data,offset,memorySize]=event.args,size=data.length+8,le=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
      commands.push(0x67,0x66,0x88,...le(size),...le(memorySize),...le(offset),...data);
    }else throw Error('This authored fixture does not include an unsupported clear-memory VGM command');
  }
  const samples=7168,remaining=samples-frame;commands.push(0x61,remaining&255,remaining>>8,0x66);
  const bytes=new Uint8Array(0x100+commands.length),view=new DataView(bytes.buffer);bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x151,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x58,clock,true);view.setUint32(0x18,samples,true);bytes.set(commands,0x100);return {bytes,samples};
}
async function playerChecks(backend){
  const rows=[];let generated=0,delivered=0,requested=0,renders=0,processCalls=0;
  for(const clock of clocks)for(const outputRate of [44100,48000,96000]){
    const engine=await Y8950AudioEngine.create({y8950ModuleFactory:()=>backend.module,y8950Clock:clock,outputSampleRate:outputRate}),fixture=vgmFixture(clock),player=new VgmPlayer(engine);
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
      const expectedMemory=new Uint8Array(1536);expectedMemory.set(sampleBytes.map(v=>v^0x88));expectedMemory.set(sampleBytes,1024);assert.deepEqual(engine.y8950.sampleMemory,expectedMemory,'Real VGM sample blocks apply patches, offsets and growth during seek replay');
      rows.push({clock,outputRate,fixtureSampleDataBlockType:0x88,loadedMemoryVerifiedAgainstAuthoredData:true,fixtureBytes:fixture.bytes.length,fixtureSha256:sha256(fixture.bytes),fixtureVgmSamples:fixture.samples,loadedSampleMemoryBytes:engine.y8950.sampleMemory.length,loadedSampleMemorySha256:sha256(engine.y8950.sampleMemory),completeOutputFrames:total,baselinePcmSha256:pcmDigest(baseline),seeks,noStateCheckpoints:true});
    }finally{engine.dispose();}
  }
  return {passed:true,rows,generatedEngineOutputStereoFrames:generated,deliveredPlayerOutputStereoFrames:delivered,requestedPlayerOutputStereoFrames:requested,engineRenderExecutions:renders,playerProcessCalls:processCalls,
    frameCountScope:'Actual Engine processFrames calls include parser render-ahead queues during baseline, reset/replay and all silent seek prefixes. Delivered/requested player frames include the seek-discarded prefix and are a separate view, not added again to generated frame totals.'};
}
async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');
  assert(!sdk.metadata.exports.some(e=>/save_state|load_state/.test(e.name)),'No invented state exports');
  const wrappers=['web/y8950.js','docs/js/y8950.js','web/y8950audioengine.js','docs/js/y8950audioengine.js'];
  const normalized=bytes=>bytes.toString().replace(/(\.\/(?:y8950|soundchip|segapsg)\.js)\?v=[^"'\s)]+/g,'$1');for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,layouts,probeFrames,
    method:'Actual generated JS/WASM and unchanged synchronous Y8950 wrapper/AudioEngine. Exact mono stereo PCM, explicit post-scenario PCM probes, rate/status/IRQ hooks (ordinary observations exclude data-port reads), held resampler timing and public reset/replay. Actual VgmPlayer seek rebuilds from zero; no synthetic snapshot/state API, tolerance, mock, Mixer or device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),helpers:await Promise.all(['web/opl_synth.js','web/vgmplayer.js','web/ym2612vgm.js','docs/vgm_analyzer/seek_playback.js'].map(p=>inputFile(resolve(root,p))))},
    wrapperSync:'Byte-identical after removing only deployed y8950.js/soundchip.js/segapsg.js import cache suffixes; actual hashes retained.',
    authoredInput:'Original synthetic OPL1 FM/rhythm programs and ADPCM bytes only. Nine FM voices, five drums, external/CPU ADPCM, up to2MiB memory boundaries and VGM type0x88 sample blocks are exercised without copyrighted ROMs.',wrapperChecks:{},playerChecks:{},cases:[],scenarioBodyOutputStereoFrames:0,postScenarioProbeOutputStereoFrames:0,totalOutputStereoFrames:0,resetReplayExecutions:0,maximumDifference:0,
    limits:['Native PCM runs at floor(clock/72), with each generated sample advancing interface clocks by72. Nine OPL1 FM/rhythm voices and one ADPCM-B voice are summed to mono and copied to both outputs. OPL2 waveform selection is ignored. Engine cases test separate averaging/holding rates without optional Sega PSG.',
      'No raw save/load exports or public state API exist for this wrapper/Engine. Internal state bytes are not inspected or claimed equivalent; continuation PCM probes, public reset/replay and VgmPlayer seek replay are compared instead.',
      'Raw reset preserves existing free-running counters and pending address; public reset recreates the native handle and reapplies the JS mute mask. Both existing paths are exercised without changing them.',
      'Status supplies live ADPCM PLAYING0x01/BRDY0x08/EOS0x10, TimerA0x40/TimerB0x20 and IRQ0x80 without fixed0x06. Status reads synchronize live ADPCM flags into FM IRQ. Ordinary observations read status/even ports only; explicit bounded data-port reads are separate.',
      'Y8950 exposes no generateStereoInto, snapshots or direct external-RAM readback. Existing09/1a data reads dispatch ADPCM indices0x02/0x13 and return0;0f returnsff. Explicit tests record actual behavior, without inventing dummy/data cursor semantics.',
      'Public memory upload can grow or shrink storage; growth zero-fills and out-of-bounds external reads return0. Raw C uploads and CPU record writes change native RAM without updating JS sampleMemory. Raw reset retains that RAM; public reset recreates the handle and reloads the uploaded JS mirror. Clear empties storage without immediately resetting decoder history.',
      'Y8950 readStatus synchronizes visible status into the FM engine: a masked timer flag can be cleared by reading while masked; timers continue and reassert. ADPCM EOS remains live until decoder reset and is maskable; current FM IRQ mask does not assert on EOS. Ordinary observations exclude data-port reads.',
      'Public reset retains mute/gain controls. Replay tests explicitly reapply neutral controls before reset, then replay authored register/memory setup; separate positives verify retained mute and uploaded memory. Engine mute clears held resampling values until the next native sample while both sources continue.',
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
      const make=async backend=>{const chip=await backend.create();return scenario.kind==='chip'?chip:new Y8950AudioEngine(chip,undefined,chip.sampleRate(scenario.clock),scenario.outputRate,1);};
      const a=await make(legacy),b=await make(sdk),label=`${scenario.kind}/${scenario.name}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
      try{
        const x=execute(a,scenario,layout),y=execute(b,scenario,layout);compareResult(y,x,label);if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        if(scenario.timerExpectedFlag)assert(x.observations.some(o=>(o.status&scenario.timerExpectedFlag)===scenario.timerExpectedFlag&&o.irq),`${label}: timer must actually assert expected status/IRQ`);
        let peak=0;for(const value of x.left)peak=Math.max(peak,Math.abs(value));if(scenario.allowSilent)assert.equal(peak,0,`${label}: intentional key-off silence`);else assert(peak>1e-5,`${label}: reference must actually sound`);
        if(layoutName==='regular'&&scenario.replay){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){rawChip(actor).setMuteMask(0);if(actor.y8950){actor.setMasterVolume(1);for(let ch=0;ch<9;ch++)actor.setChannelMuted(ch,false);actor.setAdpcmMuted(false);actor.setY8950Muted(false);}actor.reset();const replayed=execute(actor,scenario,layout);compareResult(replayed,result,`${label}/${name}/public-reset-replay`);report.resetReplayExecutions++;report.scenarioBodyOutputStereoFrames+=scenario.frames;report.postScenarioProbeOutputStereoFrames+=probeFrames;}
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
