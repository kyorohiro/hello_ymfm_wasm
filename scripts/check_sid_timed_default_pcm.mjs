// SPDX-License-Identifier: BSD-3-Clause
// Exact old/new ordinary-path comparison: real WASM Worklets, no audio device.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {YM2612Synth} from '../tetorica_src/runtime/ym2612synth.js';

const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
const option=(name,fallback)=>args.find(value=>value.startsWith(name+'='))?.slice(name.length+1)??fallback;
const base=option('--base','8f1b7563ea1d845e67f4fbdfd06aaf597936bc33');
const out=resolve(root,option('--out','docs/issues/sid_timed_default_pcm_01.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const saved=new Map(['AudioWorkletProcessor','registerProcessor','sampleRate','currentFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const sourceNames=['playground_sid_worklet.js','playground_sid.js','playground_performance_processor.js','playground_opn_worklet.js'];
const sourceBytes={},sources={},sidTypes={},primaryTypes={},clients={};
function moduleUrl(bytes,path,overrides={}){
 const text=bytes.toString().replace(/(from\s*["'])(\.[^"']+)(["'])/g,(_all,a,p,b)=>a+(overrides[p.split('?')[0]]??new URL(p,new URL('../'+path,import.meta.url)).href)+b);
 return 'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
}
class Port{messages=[];postMessage(value){this.messages.push(value);}start(){}close(){}addEventListener(){}removeEventListener(){}}
globalThis.AudioWorkletProcessor=class{constructor(){this.port=new Port();}};
async function ready(processor,label){
 for(let tries=0;!processor.port.messages.some(message=>message.ready);tries++){
  const failure=processor.port.messages.find(message=>message.error);if(failure)throw Error(failure.error);
  assert(tries<1000,label+' initialization');await new Promise(resolve=>setTimeout(resolve,0));
 }
}

const renderScene=async({processors,scene,rate,metadata,invoke})=>{
 const hash=createHash('sha256');let frame=0,maximumDifference=0,nonzero=0;
 invoke('start');
 for(const [until,action]of [[257,'edit'],[1024,'release'],[4096,null]]){
  let block=0;while(frame<until){
   const size=Math.min([1,7,31,64,127,128][block++%6],until-frame);globalThis.currentFrame=frame;
   const rendered=processors.map(processor=>{const left=new Float32Array(size),right=new Float32Array(size);assert.equal(processor.process([],[[left,right]]),true);return{left,right};});
   for(const side of ['left','right']){
    for(let i=0;i<size;i++){assert(Number.isFinite(rendered[1][side][i]));maximumDifference=Math.max(maximumDifference,Math.abs(rendered[0][side][i]-rendered[1][side][i]));if(rendered[1][side][i]!==0)nonzero++;}
    assert.deepEqual(rendered[1][side],rendered[0][side],`${scene.name}/${rate}/${JSON.stringify(metadata)} at ${frame}`);
    hash.update(Buffer.from(rendered[1][side].buffer));
   }frame+=size;
  }if(action)invoke(action);
 }
 assert(nonzero>0,`non-silent test data ${scene.name}`);
 return{...metadata,rate,scene:scene.name,frames:frame,nonzero,maximumDifference,pcmSha256:hash.digest('hex')};
};

try{
 for(const name of sourceNames){
  const path='tetorica_src/runtime/'+name,after=await readFile(resolve(root,path));
  const before=execFileSync('git',['show',`${base}:${path}`],{cwd:root,maxBuffer:8*1024*1024});
  sourceBytes[name]={before,after};sources[path]={before:record(before),after:record(after)};
 }
 for(const side of ['before','after']){
  const performanceUrl=moduleUrl(sourceBytes['playground_performance_processor.js'][side],'tetorica_src/runtime/playground_performance_processor.js');
  let Type;globalThis.registerProcessor=(_name,value)=>{Type=value;};
  const override={'./playground_performance_processor.js':performanceUrl};
  await import(moduleUrl(sourceBytes['playground_sid_worklet.js'][side],'tetorica_src/runtime/playground_sid_worklet.js',override));
  assert(Type,'SID Worklet registers');sidTypes[side]=Type;
  clients[side]=(await import(moduleUrl(sourceBytes['playground_sid.js'][side],'tetorica_src/runtime/playground_sid.js'))).createSidClient;
  Type=null;
  await import(moduleUrl(sourceBytes['playground_opn_worklet.js'][side],'tetorica_src/runtime/playground_opn_worklet.js',override));
  assert(Type,'ordinary primary OPN Worklet registers');primaryTypes[side]=Type;
 }
 const sidBinaries={
  '6581':new Uint8Array(await readFile(resolve(root,'tetorica_src/runtime/generated/sid/sid.wasm'))),
  '8580':new Uint8Array(await readFile(resolve(root,'docs/generated/sid8580-machine/sid8580-endpoint.wasm'))),
 };
 const scenes=[];
 for(const channel of [0,1,2])for(const waveform of ['triangle','saw','pulse','noise'])scenes.push({name:`voice-${channel}-${waveform}`,
  start:a=>{a.setVoice(channel,{waveform,pulseWidth:1300,attack:2,decay:6,sustain:12,release:5});a.noteOn(channel,'C4');},
  edit:a=>{a.setVoice(channel,{decay:3,release:3,pulseWidth:2900});a.setFrequency(channel,330);},release:a=>a.noteOff(channel)});
 for(const mode of ['lowpass','bandpass','lowpass+bandpass','highpass','notch','bandpass+highpass','lowpass+bandpass+highpass'])for(const routing of [1,7])for(const cutoff of [200,1100])scenes.push({name:`filter-${mode}-${routing}-${cutoff}`,
  start:a=>{a.setFilter({mode,routing,cutoff,resonance:8,volume:11,voice3off:true});for(let ch=0;ch<3;ch++)a.noteOn(ch,60+ch*4);},
  edit:a=>{a.setFilter({cutoff:700,volume:7});a.setVoice(0,{waveform:'triangle+saw'});},release:a=>a.allNotesOff()});
 for(const channel of [0,1,2])scenes.push({name:`sync-ring-${channel}`,
  start:a=>{a.setVoice(channel,{waveform:'triangle',sync:true,ring:true});a.setFrequency((channel+2)%3,70);a.noteOn(channel,'E3');},
  edit:a=>{a.setFrequency((channel+2)%3,120);a.setVoice(channel,{sync:false});},release:a=>a.keyOff(channel)});
 scenes.push({name:'three-voice-mix',start:a=>{for(let ch=0;ch<3;ch++)a.noteOn(ch,60+ch*4);},edit:a=>{a.setVoice(1,{waveform:'pulse'});a.setFilter({volume:4});},release:a=>a.allNotesOff()});
 scenes.push({name:'reset-reinitialize',start:a=>a.noteOn(0,'C4'),edit:a=>{a.reset();a.initialize();a.noteOn(2,'E4');},release:a=>a.keyOff(2)});
 assert.equal(scenes.length,45);
 const cases=[];
 for(const rate of [44100,48000])for(const [model,clock]of [['6581',985248],['6581',1022727],['8580',985248]])for(const scene of scenes){
  globalThis.sampleRate=rate;globalThis.currentFrame=0;const processors=[],apis=[];
  try{
   for(const side of ['before','after']){
    const p=new sidTypes[side]({processorOptions:{clock,model,wasmBinary:sidBinaries[model]}});processors.push(p);await ready(p,'SID');
    const port=new Port();port.postMessage=value=>p.receive(value,p.port);
    const api=clients[side](port,{clock,model});api.initialize();apis.push(api);
   }
   cases.push(await renderScene({processors,scene,rate,metadata:{chip:'sid',model,clock},invoke:method=>processors.forEach((p,i)=>scene[method](apis[i],p))}));
  }finally{for(const p of processors)p.dispose();}
 }
 // The same shared Performance Processor also serves the ordinary primary
 // YM2612 route. Exercise both established cores without the added SID API.
 const fmBinaries={ymfm:new Uint8Array(await readFile(resolve(root,'tetorica_src/runtime/generated/ym2612_wasm.wasm'))),nuked:new Uint8Array(await readFile(resolve(root,'tetorica_src/runtime/generated/nuked_opn2_wasm.wasm')))};
 const fmScenes=[];
 for(const channel of [0,2,5])fmScenes.push({name:`primary-fm-${channel}`,
  start:a=>{a.reset();a.setAlgo(channel,7,2);a.setPan(channel,true,true);for(let op=0;op<4;op++)a.setOperator(channel,op,{multi:op+1,tl:op?50:24,ar:31,d1r:5,d2r:3,sl:7,rr:8});a.noteOn(channel,'C4');},
  edit:a=>{a.setOperator(channel,0,{tl:31});a.setNote(channel,'E4');},release:a=>a.noteOff(channel)});
 for(const rate of [44100,48000])for(const engine of ['ymfm','nuked'])for(const scene of fmScenes){
  globalThis.sampleRate=rate;globalThis.currentFrame=0;const processors=[],apis=[];
  try{
   for(const side of ['before','after']){
    const p=new primaryTypes[side]({processorOptions:{name:'ym2612',engine,wasmBinary:fmBinaries[engine]}});processors.push(p);await ready(p,'primary OPN');
    const send=value=>p.receive(value,p.port);
    apis.push(new YM2612Synth({transport:{write:(port,register,value)=>send({type:'write',port,register,value}),writeBatch:commands=>commands.forEach(command=>send({type:'write',...command})),reset:()=>send({method:'reset',args:[]})}}));
   }
   cases.push(await renderScene({processors,scene,rate,metadata:{chip:'ym2612',engine},invoke:method=>processors.forEach((p,i)=>scene[method](apis[i],p))}));
  }finally{for(const p of processors)p.dispose();}
 }
 const totalStereoFrames=cases.reduce((sum,row)=>sum+row.frames,0);
 const report={schemaVersion:1,scope:'sid-timed-api-default-worklet-pcm',baseCommit:base,passed:true,physicalAudio:false,audioContextCreated:false,timedOperationsUsed:false,
  sources,cases,totalStereoFrames,maximumDifference:Math.max(...cases.map(row=>row.maximumDifference)),
  method:'Actual pre-change and current SID clients, SID/primary OPN Worklet classes and shared Performance Processor; same real 6581, 8580, YMFM and Nuked WASM, immediate register/voice/filter/key operations and irregular render partitions. No added timed API is invoked. Existing mixer gain policy remains byte-identical.'};
 await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
 console.log(`SID timed default PCM: ${cases.length} cases / ${totalStereoFrames} stereo frames, exact; ${out}`);
}finally{for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
