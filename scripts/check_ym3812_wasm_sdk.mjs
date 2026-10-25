/** Compare two real YM3812 WASM builds through the unchanged synchronous JS wrapper.
 * No compiler, browser, AudioContext or physical output device is used here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Ym3812} from '../web/ym3812.js';
import {Ym3812AudioEngine} from '../web/ym3812audioengine.js';
import {oplPitchFromHz} from '../web/opl_synth.js';
import {VgmPlayer} from '../web/vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_ym3812_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const clocks=[3579545,4000000,8000000];
const rateClocks=[100000,3579545,3993600,7670454,8000000,100000000];
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const totalFrames=6144,probeFrames=257;
const requiredExports=['ym3812_create','ym3812_destroy','ym3812_reset','ym3812_write',
  'ym3812_read','ym3812_read_status','ym3812_get_irq','ym3812_sample_rate',
  'ym3812_generate','ym3812_set_mute_mask','malloc','free'];

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
    assert(!['ym3812_wasm.js','ym3812_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'ym3812_wasm.js'),wasm=resolve(directory,'ym3812_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);
  assert.equal(typeof factory,'function',`Missing generated JS factory: ${js}`);
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert.equal(typeof module.cwrap,'function');assert(module.HEAPF32 instanceof Float32Array);
  const create=()=>Ym3812.create({moduleFactory:()=>module});
  const metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');
  let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='ym3812');assert(artifact,'YM3812 build receipt entry');
    for(const [name,record] of [['ym3812_wasm.js',metadata.javascript],['ym3812_wasm.wasm',metadata.wasm]]){
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
function scenariosFor(clock){
  const scenes=[];
  function scenario(name,build,{engine=false,replay=false,allowSilent=false,engineOnly=false,timerExpectedFlag}={}){
    let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args}),write=(r,v)=>add('register',r,v);
    const pitch=(ch,midi,key=true)=>{const p=oplPitchFromHz(440*2**((midi-69)/12),clock,'ym3812');write(0xa0+ch,p.fnum&255);write(0xb0+ch,(p.fnum>>8)|(p.block<<2)|(key?32:0));};
    const voice=(ch=0,midi=60,connection=0,feedback=3,key=true)=>{
      const slot=operatorSlots[ch];for(const [op,offset] of [slot,slot+3].entries())for(const [r,v] of [[0x20,0x21+op],[0x40,24+op*6],[0x60,0xf4],[0x80,0x48],[0xe0,0]])write(r+offset,v);
      write(0xc0+ch,(feedback<<1)|connection);pitch(ch,midi,key);
    };
    const drums=mask=>{for(let ch=6;ch<9;ch++)voice(ch,48+ch*4,0,3,false);write(0xbd,0x20|mask);};
    write(4,0x80);write(4,0);write(8,0);write(1,32);write(0xbd,0);add('mute',0);
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
  for(let ch=0;ch<9;ch++)for(let waveform=0;waveform<4;waveform++)scenario(`waveform/channel${ch}/type${waveform}/enable-gate`,({voice,write,at})=>{
    voice(ch,48+ch*4,0,3);const slot=operatorSlots[ch];write(1,32);write(0xe0+slot,waveform);write(0xe3+slot,waveform);
    at(701);write(1,0);at(1703);write(0xe0+slot,waveform^3);write(0xe3+slot,waveform^1);at(2801);write(1,32);at(3901);write(0xe0+slot,0xfc|waveform);write(0xe3+slot,0xfc|(waveform^2));at(5101);write(1,0);
  },{engine:ch===0&&waveform===3,replay:ch===0&&waveform===3});
  for(let mod=0;mod<4;mod++)for(let carrier=0;carrier<4;carrier++)scenario(`waveform/pairs/mod${mod}/carrier${carrier}`,({voice,write,at})=>{
    voice();write(1,32);write(0xe0,mod);write(0xe3,carrier);at(701);write(0x40,7);at(1703);write(0xe0,carrier);write(0xe3,mod);at(2801);write(0xb0,0x11);at(3901);write(0xb0,0x31);at(5101);write(1,0);
  },{engine:mod===3&&carrier===2,replay:mod===3&&carrier===2});
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
    for(let ch=0;ch<9;ch++)voice(ch,48+ch*4,ch%2,ch%8);at(701);drums(31);write(0xe0,3);write(0xe3,2);at(1703);write(0xbd,0xe9);write(1,0);at(2801);write(0xbd,0);for(let ch=6;ch<9;ch++)voice(ch,60+ch,1,7);write(0xe0,1);write(0xe3,3);at(3901);drums(6);write(1,32);at(5101);write(0xbd,0);
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
  scenario('cold-key-off/default-silence',()=>{},{allowSilent:true});
  return scenes;
}
const rawChip=actor=>actor.ym3812??actor;
const timing=actor=>actor.ym3812?[actor.remainder,actor.lastLeft,actor.lastRight,actor.volume]:null;
function observation(actor,frame,clock){const chip=rawChip(actor),result={frame,nativeRate:chip.sampleRate(clock),outputRate:actor===chip?null:actor.sampleRate(),status:chip.readStatus(),irq:chip.getIrq(),ports:[0,1,2,3].map(offset=>chip.read(offset))};assert.equal(result.status&6,6);assert.equal(result.irq,Boolean(result.status&0x80));assert.equal(result.ports[0],result.status);assert.equal(result.ports[2],result.status);assert.equal(result.ports[1],255);assert.equal(result.ports[3],255);return result;}
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
  for(const array of [left,right,probe.left,probe.right])for(const value of array)assert(Number.isFinite(value));sameBytes(left,right,'OPL melody/rhythm mix reaches both sides');sameBytes(probe.left,probe.right,'OPL continuation probe remains mono');
  return {left,right,probe,initialObservation,observations,hooks,endObservation,endTiming:timing(actor)};
}
function compareResult(actual,expected,label,{observations=true}={}){
  for(const key of ['left','right']){sameBytes(actual[key],expected[key],`${label}/${key}`);sameBytes(actual.probe[key],expected.probe[key],`${label}/post-scenario-${key}`);}
  assert.deepEqual(actual.endTiming,expected.endTiming,`${label}/held-resampler`);assert.deepEqual(actual.endObservation,expected.endObservation,`${label}/post-scenario-read-status-IRQ`);
  if(observations){assert.deepEqual(actual.initialObservation,expected.initialObservation,`${label}/initial-read-status-IRQ`);assert.deepEqual(actual.observations,expected.observations,`${label}/read-status-IRQ`);assert.deepEqual(actual.hooks,expected.hooks,`${label}/actual-hooks`);}
}
function pcmDigest(result){const hash=createHash('sha256');for(const array of [result.left,result.right])hash.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));return hash.digest('hex');}
function writeRegister(chip,r,v){chip.write(0,r);chip.write(1,v);}
function program(chip,{ch=0,connection=0,feedback=3,key=true,operatorFlags=0x21,drum=0,skipConnection=false,modWave=0,carrierWave=0,waveEnable=true}={}){
  writeRegister(chip,1,waveEnable?32:0);
  const configure=(channel,active)=>{const slot=operatorSlots[channel];for(const [op,offset] of [slot,slot+3].entries())for(const [r,v] of [[0x20,operatorFlags],[0x40,24+op*6],[0x60,0xf4],[0x80,0x48],[0xe0,op?carrierWave:modWave]])writeRegister(chip,r+offset,v);
    if(!skipConnection)writeRegister(chip,0xc0+channel,(feedback<<1)|connection);writeRegister(chip,0xa0+channel,0x80);writeRegister(chip,0xb0+channel,0x11|(active?32:0));};
  configure(ch,key);if(drum){for(let c=6;c<9;c++)configure(c,false);writeRegister(chip,0xbd,0x20|drum);}
}
async function wrapperChecks(backend){
  const chip=await backend.create(),other=await backend.create(),actors=[chip,other];let frames=0;
  const render=(actor,n)=>{frames+=n;return actor.ym3812?actor.processFrames(n):actor.generateStereo(n);};
  const makeEngine=async(outputRate,volume=1)=>{const engine=await Ym3812AudioEngine.create({ym3812ModuleFactory:()=>backend.module,outputSampleRate:outputRate,masterVolume:volume});actors.push(engine);return engine;};
  try{
    for(const name of ['saveState','loadState','supportsState'])assert.equal(typeof chip[name],'undefined','No synthetic state API');for(const name of ['_ym3812_save_state','_ym3812_load_state'])assert.equal(typeof backend.module[name],'undefined');
    const rates={};for(const clock of rateClocks){rates[clock]=chip.sampleRate(clock);assert.equal(rates[clock],Math.floor(clock/72));}
    chip.generateStereo(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>chip.generateStereo(n),RangeError);program(chip);program(other);sameBytes(render(chip,701).left,render(other,701).left,'Rate/zero/invalid queries do not advance synthesis');
    const connectionFeedback=[];for(let connection=0;connection<2;connection++)for(let feedback=0;feedback<8;feedback++){chip.reset();program(chip,{connection,feedback});const pcm=render(chip,4096);assert(pcm.left.some(v=>v!==0));connectionFeedback.push({connection,feedback,pcmSha256:pcmDigest(pcm)});}
    assert.notEqual(connectionFeedback[0].pcmSha256,connectionFeedback[7].pcmSha256,'Feedback0/7 affect PCM');assert.notEqual(connectionFeedback[0].pcmSha256,connectionFeedback[8].pcmSha256,'FM and additive connections differ');
    const modulation=[];for(let flags=0;flags<4;flags++){chip.reset();program(chip,{operatorFlags:0x21|(flags&1?128:0)|(flags&2?64:0)});writeRegister(chip,0xbd,0xc0);const pcm=render(chip,8192);assert(pcm.left.some(v=>v!==0));modulation.push({flags,pcmSha256:pcmDigest(pcm)});}
    assert.notEqual(modulation[0].pcmSha256,modulation[1].pcmSha256,'AM operator bits affect PCM');assert.notEqual(modulation[0].pcmSha256,modulation[2].pcmSha256,'Vibrato operator bits affect PCM');
    const waveforms=[];for(let waveform=0;waveform<4;waveform++){chip.reset();program(chip,{modWave:waveform,carrierWave:waveform});const pcm=render(chip,4096);assert(pcm.left.some(v=>v!==0));waveforms.push({waveform,pcmSha256:pcmDigest(pcm)});}
    assert.equal(new Set(waveforms.map(row=>row.pcmSha256)).size,4,'Enabled OPL2 waveforms produce four distinct audible outputs');
    const disabledWaveforms=[];for(let waveform=0;waveform<4;waveform++){chip.reset();program(chip,{modWave:waveform,carrierWave:waveform,waveEnable:false});const pcm=render(chip,4096);assert.equal(pcmDigest(pcm),waveforms[0].pcmSha256,'Disabled waveform gate forces sine regardless of E0 contents');disabledWaveforms.push({waveform,pcmSha256:pcmDigest(pcm)});}
    const waveformPairs=[];for(let mod=0;mod<4;mod++)for(let carrier=0;carrier<4;carrier++){chip.reset();program(chip,{modWave:mod,carrierWave:carrier});const pcm=render(chip,4096);assert(pcm.left.some(v=>v!==0));waveformPairs.push({mod,carrier,pcmSha256:pcmDigest(pcm)});}
    assert.notEqual(waveformPairs[0].pcmSha256,waveformPairs[12].pcmSha256,'Modulator waveform select independently affects PCM');assert.notEqual(waveformPairs[0].pcmSha256,waveformPairs[3].pcmSha256,'Carrier waveform select independently affects PCM');
    for(let waveform=0;waveform<4;waveform++){chip.reset();other.reset();program(chip,{modWave:waveform,carrierWave:waveform^2});program(other,{modWave:waveform|0xfc,carrierWave:(waveform^2)|0xfc});sameBytes(render(chip,1024).left,render(other,1024).left,'OPL2 waveform selection uses only low2 bits');}
    chip.reset();other.reset();program(chip);program(other);writeRegister(chip,1,0);writeRegister(other,1,0);writeRegister(chip,0xe0,3);writeRegister(chip,0xe3,2);sameBytes(render(chip,701).left,render(other,701).left,'Waveform edits stay inactive while gate is disabled');
    // Both advanced701 frames as sine. Compare disabled-time writes against
    // the same selections written only after enabling the reference gate.
    writeRegister(chip,1,32);writeRegister(other,1,32);writeRegister(other,0xe0,3);writeRegister(other,0xe3,2);const gateEnabled=render(chip,701);assert(gateEnabled.left.some(v=>v!==0));sameBytes(gateEnabled.left,render(other,701).left,'Disabled-time waveform writes survive and match enabled-time writes at the same source phase');
    const envelopes=[];for(const sustain of [false,true]){chip.reset();program(chip,{operatorFlags:sustain?0x21:1});for(const r of [0x60,0x63])writeRegister(chip,r,0xff);for(const r of [0x80,0x83])writeRegister(chip,r,0x28);const pcm=render(chip,8192);envelopes.push({sustain,pcmSha256:pcmDigest(pcm)});}assert.notEqual(envelopes[0].pcmSha256,envelopes[1].pcmSha256,'EGT sustain changes held envelope');
    const timers=[];for(const [name,mode,flag,mask,expectedFirst] of [['A',1,64,64,4],['B',2,32,32,16]]){
      chip.reset();writeRegister(chip,2,255);writeRegister(chip,3,255);writeRegister(chip,4,mode);let first=0;while(first<128&&!chip.getIrq()){render(chip,1);first++;}
      assert.equal(first,expectedFirst);assert.equal(chip.readStatus()&flag,flag);assert.equal(chip.readStatus()&0x86,0x86);writeRegister(chip,4,0);writeRegister(chip,4,128);assert.equal(chip.readStatus(),6);assert.equal(chip.getIrq(),false);render(chip,64);assert.equal(chip.readStatus(),6,'Stopped timer cannot reassert after clear');
      chip.reset();writeRegister(chip,2,255);writeRegister(chip,3,255);writeRegister(chip,4,mode|mask);render(chip,expectedFirst+1);assert.equal(chip.readStatus(),6,'Mask suppresses timer status/IRQ');assert.equal(chip.getIrq(),false);writeRegister(chip,4,mode);assert.equal(chip.readStatus()&flag,flag,'Unmask reveals flag from a timer that kept running');assert.equal(chip.getIrq(),true);
      timers.push({name,firstIrqFrame:first,flag,maskStopsVisibilityButNotTimer:true,stopAndIrqClear:true});
    }
    const csm=[];for(let ch=0;ch<9;ch++){
      chip.reset();program(chip,{ch,key:false});const silence=render(chip,32);assert(silence.left.every(v=>v===0));writeRegister(chip,8,128);writeRegister(chip,2,255);writeRegister(chip,4,0x41);const pcm=render(chip,512);assert(pcm.left.some(v=>v!==0),`Masked Timer A CSM must sound on physical channel${ch}`);assert.equal(chip.getIrq(),false);assert.equal(chip.readStatus(),6);csm.push({channel:ch,maskedTimerCsmPcmSha256:pcmDigest(pcm)});
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
    chip.setMuteMask(0xfe00);assert.equal(chip.muteMask,0);sameBytes(render(chip,701).left,render(other,701).left,'High mute bits are ignored');
    chip.reset();other.reset();program(chip);program(other);chip.write(0,0xc0);sameBytes(render(chip,173).left,render(other,173).left,'Pending address alone does not alter PCM');chip.write(1,15);writeRegister(other,0xc0,15);sameBytes(render(chip,701).left,render(other,701).left,'Pending address survives generation until data write');
    for(const actor of [chip,other])actor.api.reset(actor.handle);chip.write(1,15);writeRegister(other,0xc0,15);for(const actor of [chip,other])program(actor,{skipConnection:true});const latched=render(chip,701);assert(latched.left.some(v=>v!==0));sameBytes(latched.left,render(other,701).left,'Raw reset retains pending bus address');
    chip.reset();program(chip,{operatorFlags:0xe1,drum:31});render(chip,1733);chip.api.reset(chip.handle);program(chip,{operatorFlags:0xe1,drum:31});const rawReset=render(chip,4096);
    other.reset();program(other,{operatorFlags:0xe1,drum:31});const fresh=render(other,4096);assert.notEqual(pcmDigest(rawReset),pcmDigest(fresh),'Raw reset retains free-running noise/LFO/envelope phase');chip.reset();program(chip,{operatorFlags:0xe1,drum:31});const publicReset=render(chip,4096);sameBytes(publicReset.left,fresh.left,'Public reset recreates exact power-on waveform');
    chip.setMuteMask(0x100);chip.reset();assert.equal(chip.muteMask,0x100);program(chip,{ch:8});assert(render(chip,701).left.every(v=>v===0));chip.setMuteMask(0);chip.reset();program(chip);render(chip,512);
    const owned=render(chip,17),held=owned.left.slice();assert(held.some(v=>v!==0));writeRegister(chip,0xa0,0x5f);render(chip,17);sameBytes(owned.left,held,'Owned PCM survives same-buffer overwrite');const capacity=chip.bufferFrames;render(chip,capacity+1);assert(chip.bufferFrames>capacity);sameBytes(owned.left,held,'Owned PCM survives buffer growth');
    const up=await makeEngine(96000),average=await makeEngine(22050),half=await makeEngine(22050,.5),engineChecks=[];
    for(const actor of [up,average,half]){for(const name of ['saveState','loadState','supportsState'])assert.equal(typeof actor[name],'undefined');program(actor.ym3812);}
    for(const actor of [up,average]){let sourceFrames=0;const generate=actor.ym3812.generateStereo.bind(actor.ym3812);actor.ym3812.generateStereo=n=>{sourceFrames+=n;return generate(n);};const pcm=render(actor,1024);assert.equal(sourceFrames,Math.floor(1024*actor.chipRate/actor.outputRate));assert.equal(actor.remainder,(1024*actor.chipRate)%actor.outputRate);assert(pcm.left.some(v=>v!==0));engineChecks.push({outputRate:actor.outputRate,sourceFrames,outputFrames:1024,pcmSha256:pcmDigest(pcm)});}
    const halfPcm=render(half,1024);average.reset();program(average.ym3812);const fullPcm=render(average,1024);sameBytes(halfPcm.left,Float32Array.from(fullPcm.left,v=>v*.5),'Engine master gain applied once');for(const v of [NaN,Infinity,'bad'])assert.throws(()=>average.setMasterVolume(v),RangeError);average.setMasterVolume(99);assert.equal(average.volume,3.8);average.setMasterVolume(-1);assert.equal(average.volume,0);
    const before=timing(up);up.processFrames(0);for(const n of [-1,.5,Infinity,0x1000001])assert.throws(()=>up.processFrames(n),RangeError);assert.deepEqual(timing(up),before);
    return {passed:true,stateApiAbsent:true,rates,connectionFeedback,modulation,waveforms,disabledWaveforms,waveformPairs,waveformLow2BitsOnly:true,liveWaveformGatePreservesPendingSelections:true,envelopes,timers,csm,rhythmGroups:groups,allNineMelodyMuteGroups:true,unknownMuteBitsIgnored:true,pendingAddressSurvivesGeneration:true,rawResetRetainsPendingAddress:true,rawResetDiffersFromPowerOn:true,publicResetRecreatesPowerOnRetainsMute:true,resetPcm:{raw:pcmDigest(rawReset),fresh:pcmDigest(fresh),public:pcmDigest(publicReset)},ownedPcmSurvivesOverwriteAndGrowth:true,engineChecks,totalOutputStereoFrames:frames,
      frameCountScope:'All raw/public chip and Engine output frames in bounded positive self-checks. Native source frames produced internally by Engine resampling are reported separately and not double-counted.'};
  }finally{for(const actor of actors){actor.dispose();actor.dispose();}}
}
function vgmFixture(clock){
  const scene=scenariosFor(clock).find(s=>s.name.startsWith('mixed/nine-operators/')),commands=[];let frame=0;
  for(const event of scene.events.filter(e=>e.op==='register')){const wait=event.frame-frame;if(wait){commands.push(0x61,wait&255,wait>>8);frame=event.frame;}commands.push(0x5a,...event.args);}
  const samples=7168,remaining=samples-frame;commands.push(0x61,remaining&255,remaining>>8,0x66);
  const bytes=new Uint8Array(0x100+commands.length),view=new DataView(bytes.buffer);bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x151,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x50,clock,true);view.setUint32(0x18,samples,true);bytes.set(commands,0x100);return {bytes,samples};
}
async function playerChecks(backend){
  const rows=[];let generated=0,delivered=0,requested=0,renders=0,processCalls=0;
  for(const clock of clocks)for(const outputRate of [44100,48000,96000]){
    const engine=await Ym3812AudioEngine.create({ym3812ModuleFactory:()=>backend.module,ym3812Clock:clock,outputSampleRate:outputRate}),fixture=vgmFixture(clock),player=new VgmPlayer(engine);
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
  const wrappers=['web/ym3812.js','docs/js/ym3812.js','web/ym3812audioengine.js','docs/js/ym3812audioengine.js'];
  const normalized=bytes=>bytes.toString().replace(/(\.\/(?:ym3812|soundchip|segapsg)\.js)\?v=[^"'\s)]+/g,'$1');for(let i=0;i<wrappers.length;i+=2)sameBytes(normalized(await readFile(resolve(root,wrappers[i]))),normalized(await readFile(resolve(root,wrappers[i+1]))),'Web/deployed wrapper sync except import cache keys');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),clocks,layouts,probeFrames,
    method:'Actual generated JS/WASM and unchanged synchronous Ym3812 wrapper/AudioEngine. Exact mono stereo PCM, explicit post-scenario PCM probes, rate/read/status/IRQ hooks, held resampler timing and public reset/replay. Actual VgmPlayer seek rebuilds from zero; no synthetic snapshot/state API, tolerance, mock, Mixer or device.',
    inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),helpers:await Promise.all(['web/opl_synth.js','web/vgmplayer.js','web/ym2612vgm.js','docs/vgm_analyzer/seek_playback.js'].map(p=>inputFile(resolve(root,p))))},
    wrapperSync:'Byte-identical after removing only deployed ym3812.js/soundchip.js/segapsg.js import cache suffixes; actual hashes retained.',
    authoredInput:'Original synthetic two-operator register programs. OPL2 four-wave selection, independent operator waveforms, low2-bit masks and register01 bit5 gate are exercised with actual PCM.',wrapperChecks:{},playerChecks:{},cases:[],scenarioBodyOutputStereoFrames:0,postScenarioProbeOutputStereoFrames:0,totalOutputStereoFrames:0,resetReplayExecutions:0,maximumDifference:0,
    limits:['Native PCM runs at floor(clock/72). The OPL2 core supplies one mono output copied to both sides. Engine cases test averaging/holding at separate output rates, without optional Sega PSG.',
      'No raw save/load exports or public state API exist for this wrapper/Engine. Internal state bytes are not inspected or claimed equivalent; continuation PCM probes, public reset/replay and VgmPlayer seek replay are compared instead.',
      'Raw reset preserves existing free-running counters and pending address; public reset recreates the native handle and reapplies the JS mute mask. Both existing paths are exercised without changing them.',
      'Status includes fixed0x06, TimerA0x40/TimerB0x20 and IRQ0x80. Even bus reads alias status; odd reads return0xff. Positive timer masks/clear/stop/CSM tests supplement real hooks compared at synchronous chunk boundaries.',
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
      const make=async backend=>{const chip=await backend.create();return scenario.kind==='chip'?chip:new Ym3812AudioEngine(chip,undefined,chip.sampleRate(scenario.clock),scenario.outputRate,1);};
      const a=await make(legacy),b=await make(sdk),label=`${scenario.kind}/${scenario.name}/${scenario.clock}/${scenario.outputRate}/${layoutName}`;
      try{
        const x=execute(a,scenario,layout),y=execute(b,scenario,layout);compareResult(y,x,label);if(regular)compareResult(x,regular,'Chunk partition invariance',{observations:false});else regular=x;
        if(scenario.timerExpectedFlag)assert(x.observations.some(o=>(o.status&scenario.timerExpectedFlag)===scenario.timerExpectedFlag&&o.irq),`${label}: timer must actually assert expected status/IRQ`);
        let peak=0;for(const value of x.left)peak=Math.max(peak,Math.abs(value));if(scenario.allowSilent)assert.equal(peak,0,`${label}: intentional key-off silence`);else assert(peak>1e-5,`${label}: reference must actually sound`);
        if(layoutName==='regular'&&scenario.replay){
          for(const [actor,result,name] of [[a,x,'legacy'],[b,y,'sdk']]){rawChip(actor).setMuteMask(0);if(actor.ym3812)actor.setMasterVolume(1);actor.reset();const replayed=execute(actor,scenario,layout);compareResult(replayed,result,`${name}/public-reset-replay`);report.resetReplayExecutions++;report.scenarioBodyOutputStereoFrames+=scenario.frames;report.postScenarioProbeOutputStereoFrames+=probeFrames;}
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
