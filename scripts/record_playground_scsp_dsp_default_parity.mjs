// SPDX-License-Identifier: BSD-3-Clause
// Compare the exact pre-DSP default path with current code using real SCSP WASM.
// The CPU-only Worklet harness never creates an AudioContext or audio device.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
import factory from '../docs/generated/scsp_wasm.js';
import {Scsp} from '../tetorica_src/runtime/scsp.js';
import {ScspSynth,createScspInitSample} from '../tetorica_src/runtime/scspsynth.js';
import {Pcm44100Resampler} from '../tetorica_src/runtime/pcm_44100_resampler.js';
import {SCSP_CONTROLS,SCSP_DSP_METHODS,createScspValidation,scspCommandArgs,validateScspDspCommand} from '../tetorica_src/runtime/playground_scsp.js';
import {ScspVoiceInspector} from '../tetorica_src/runtime/playground_scsp_inspector.js';
import {receiveChipInspector} from '../tetorica_src/runtime/playground_chip_inspector_state.js';
import {createProcessorPerformance} from '../tetorica_src/runtime/playground_performance_processor.js';
import {createPerformanceSender} from '../tetorica_src/runtime/playground_performance_sender.js';

export const SCSP_DSP_PARITY_BASE_COMMIT='c2ba69cb78d318265ad03282b67d710349a0e3fc';
export const SCSP_DSP_PARITY_RECEIPT='docs/issues/playground_scsp_dsp_execution_source_revision_01.json';
export const SCSP_DSP_PARITY_REPORT='docs/issues/playground_scsp_dsp_default_parity_01.json';
const predecessors=Object.freeze({
  'tetorica_src/runtime/scspsynth.js':{sha256:'d9f22336310d263c5af909cfcee0590895d0411a648f9e81e998fc5ec3dc4274'},
  'tetorica_src/runtime/playground_scsp_worklet.js':{sha256:'8e5243be46dead94422b86e56fce284069207729547ca8210c56738b4910a994'},
  'tetorica_src/runtime/playground_performance_sender.js':{sha256:'467a1a2143e3b3df65bc1bff61272203629ca534a098234d9c5336b25c1a288e'},
});
const root=new URL('../',import.meta.url),path=name=>new URL(name,root);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});
const f32bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
const compare=(a,b,label)=>assert.deepEqual(a,b,label);

/** This recorder independently pins the original source SHA; it does not grant
 * calibration exceptions. CI reconstructs from exact reviewed reverse hunks,
 * without needing historical Git objects or running git. */
export function reconstructScspDspParityPredecessor(name,current,receipt) {
  const entry=receipt.sources[name],pin=predecessors[name];
  assert(pin,'Only independently pinned predecessor paths may be loaded');
  assert.equal(receipt.baseCommit,SCSP_DSP_PARITY_BASE_COMMIT);
  compare(record(current),entry.after,'Current parity source matches its reviewed complete body');
  const parts=[];let cursor=0;
  for(const h of entry.reverseHunks){assert(Number.isSafeInteger(h.afterOffset)&&h.afterOffset>=cursor&&h.afterOffset+h.afterBytes<=current.length);parts.push(current.subarray(cursor,h.afterOffset),Buffer.from(h.beforeText));cursor=h.afterOffset+h.afterBytes;}
  parts.push(current.subarray(cursor));const before=Buffer.concat(parts);
  compare(record(before),entry.before,'Complete predecessor reconstruction');
  assert.equal(sha(before),pin.sha256,'Independent pre-feature source identity');
  return before.toString();
}
function importsFromRuntime(source) {
  return source.replace(/from (['"])(\.\/[^'"\n]+)\1/g,(_all,quote,name)=>'from '+quote+new URL(name,new URL('tetorica_src/runtime/',root)).href+quote);
}
async function originalSynth(source) {
  return (await import('data:text/javascript;base64,'+Buffer.from(importsFromRuntime(source)).toString('base64'))).ScspSynth;
}
function senderPackets(create,kind,policy) {
  const packets=[],loop={performanceOwner:'legacy-loop',keyboard:policy==='keyboard'};
  const sender=create({getLoop:()=>loop,now:()=>1000,leaseUntimed:policy==='native'});
  sender.configure({session:7,audioSeconds:.125,performanceEpochMs:1000,lookaheadSeconds:.5});
  const port=sender.port({postMessage:message=>packets.push(structuredClone(message))},kind);
  const commands=kind==='chip'
    ? [{type:'write',port:0,address:40,value:240},{type:'schedule-writes',writes:[]},{type:'reset'}]
    : kind==='fx'?[{op:'filter',value:.5},{op:'sample',action:'load',name:'original'}]
    : [{method:'noteOn',args:[0,69]},{method:'setMix',args:[0,{pan:15}]},{method:'getState',args:[],id:1},
      {method:'loadPCM',args:[new Int8Array([1,-1]),{rootNote:69}],id:2},{method:'noteOff',args:[0]}];
  if(kind==='spc')for(const command of commands)port.postMessage(command);
  else port.postMessage(commands);
  return packets;
}
function tracedCore(core,trace) {
  const write=core.write.bind(core),load=core.loadRam.bind(core);
  core.write=(offset,value,mask)=>{write(offset,value,mask);trace.push([offset,core.read(offset)]);};
  core.loadRam=(bytes,address=0)=>{load(bytes,address);trace.push(['ram',address,bytes.length,sha(bytes)]);};
  return core;
}
const validation=Class=>new Class({sampleRate:44100,nativeFrames:0,reset(){},write(){},loadRam(){},renderInto(){},dispose(){}});
function metadata(synth) {
  const state=synth.getState();
  return {...state,bankId:'bank',samples:state.samples.map(sample=>({...sample,bankId:'bank'})),
    slots:state.slots.map(slot=>({...slot,dspSend:slot.dspSend??0,sample:slot.sample?{...slot.sample,bankId:'bank'}:null}))};
}
const OLD_CONTROLS=Object.freeze(['setPreset','setEnvelope','setLfo','setModulation','setFrequency','setNote','setMix','keyOn','keyOff','noteOn','noteOff','allNotesOff','reset']);

async function worklet(source,Class,rate,wasmBinary,legacy) {
  const trace=[],messages=[],port={postMessage:data=>messages.push(data),start(){},close(){}};
  let Processor,core;
  const scope={factory,Scsp:{async create(options){core=tracedCore(await Scsp.create(options),trace);return core;}},
    ScspSynth:Class,createScspInitSample,Pcm44100Resampler,
    SCSP_CONTROLS:legacy?OLD_CONTROLS:SCSP_CONTROLS,SCSP_DSP_METHODS,
    createScspValidation:legacy?()=>validation(Class):createScspValidation,
    scspCommandArgs,validateScspDspCommand,ScspVoiceInspector,receiveChipInspector,
    sampleRate:rate,currentFrame:0,Float32Array,Uint16Array,Int16Array,Uint8Array,Int8Array,DataView,ArrayBuffer,
    AudioWorkletProcessor:class{constructor(){this.port=port;}},
    registerProcessor(name,Class){assert.equal(name,'tetorica-playground-scsp');Processor=Class;},
  };
  scope.createProcessorPerformance=options=>createProcessorPerformance({...options,rate,nowFrame:()=>scope.currentFrame});
  vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,'').replace('export class ScspInstrumentProcessor','class ScspInstrumentProcessor'),scope,{filename:legacy?'scsp-worklet-before.js':'scsp-worklet-current.js'});
  const processor=new Processor({processorOptions:{wasmBinary}});await processor.ready;
  assert(!processor.dead,'Actual SCSP Worklet initialized');assert(processor.synth);assert(messages.some(message=>message.ready));
  return {synth:processor.synth,trace,core,
    immediate(method,args=[]){const previous=messages.length;const value=processor.apply({method,args,id:messages.length+1},port);const error=messages.slice(previous).find(message=>message.error);if(error)throw Error(error.error);return value;},
    scheduled(method,args,time){processor.receive({performance:{session:7,owner:'parity-worker',time},commands:[{method,args}]},port);},
    start(){processor.receive({type:'performance-start',session:7},port);},
    stop(){processor.receive({type:'performance-stop',session:7},port);},
    render(frames){const left=new Float32Array(frames),right=new Float32Array(frames);assert(processor.process([],[[left,right]]));scope.currentFrame+=frames;return{left,right};},
    dispose(){processor.dispose();},
  };
}
async function local(Class,rate,wasmBinary) {
  const trace=[],core=tracedCore(await Scsp.create({moduleFactory:factory,moduleOptions:{wasmBinary}}),trace),synth=new Class(core),converter=new Pcm44100Resampler(synth,rate);
  const {pcm,options}=createScspInitSample(),sample=synth.loadPCM(pcm,options);
  for(let slot=0;slot<32;slot++)synth.setPreset(slot,{sample,totalLevel:12});
  return{synth,core,trace,
    immediate(method,args=[]){return synth[method](...scspCommandArgs(synth,method,args));},
    stop(){synth.stopVoices();converter.reset();},
    render(frames){const left=new Float32Array(frames),right=new Float32Array(frames);converter.render(left,right);return{left,right};},
    dispose(){synth.dispose();},
  };
}
async function exercise(owner,route,rate,hz,scenario) {
  const chunks=[];
  const render=frames=>{chunks.push(owner.render(frames));};
  const call=(method,args=[])=>owner.immediate(method,args);
  if(scenario==='pcm8') {
    const pcm=Int8Array.from([0,30,60,90,120,90,60,30,0,-30,-60,-90,-120,-90,-60,-30]);
    const handle=call('loadPCM',[pcm,{baseFrequencyHz:44100/16,loopStartSamples:0}]);
    call('setPreset',[31,{sample:handle,totalLevel:20,envelope:{attackRate:31,releaseRate:24}}]);
  }
  if(route==='worker') {
    owner.start();owner.scheduled('setFrequency',[31,hz],0);
    owner.scheduled('keyOn',[31],256/rate);render(256);render(4096);
    owner.scheduled('setMix',[31,{pan:15,totalLevel:18}],4352/rate);render(1024);
    owner.scheduled('keyOff',[31],5376/rate);render(4096);
    owner.scheduled('noteOn',[31,69],1);owner.stop();render(1024);
  }else{
    render(256);call('setFrequency',[31,hz]);call('keyOn',[31]);render(4096);
    call('setMix',[31,{pan:15,totalLevel:18}]);render(1024);
    call('keyOff',[31]);render(4096);owner.stop();render(1024);
  }
  const length=chunks.reduce((total,chunk)=>total+chunk.left.length,0),left=new Float32Array(length),right=new Float32Array(length);
  let at=0;for(const chunk of chunks){left.set(chunk.left,at);right.set(chunk.right,at);at+=chunk.left.length;}
  return{left,right,state:metadata(owner.synth),ram:owner.core.readRam()};
}

export async function measureScspDspDefaultParity() {
  const receipt=JSON.parse(await readFile(path(SCSP_DSP_PARITY_RECEIPT),'utf8'));
  const currentSynth=await readFile(path('tetorica_src/runtime/scspsynth.js'));
  const currentWorklet=await readFile(path('tetorica_src/runtime/playground_scsp_worklet.js'));
  const beforeSynth=reconstructScspDspParityPredecessor('tetorica_src/runtime/scspsynth.js',currentSynth,receipt);
  const beforeWorklet=reconstructScspDspParityPredecessor('tetorica_src/runtime/playground_scsp_worklet.js',currentWorklet,receipt);
  const BeforeSynth=await originalSynth(beforeSynth),wasmBinary=await readFile(path('docs/generated/scsp_wasm.wasm'));
  const sourceNames=['tetorica_src/runtime/scspsynth.js','tetorica_src/runtime/playground_scsp_worklet.js','tetorica_src/runtime/playground_scsp.js',
    'tetorica_src/runtime/scsp.js','tetorica_src/runtime/pcm_44100_resampler.js','tetorica_src/runtime/playground_performance_processor.js',
    'tetorica_src/runtime/playground_performance_queue.js','tetorica_src/runtime/playground_performance_sender.js','tetorica_src/runtime/playground_scsp_inspector.js'];
  const sources={};for(const name of sourceNames)sources[name]=record(await readFile(path(name)));
  const cases=[];
  for(const route of ['local','main','worker'])for(const rate of [44100,48000])for(const scenario of ['pcm16','pcm8'])for(const hz of [220,440,880]) {
    const before=route==='local'?await local(BeforeSynth,rate,wasmBinary):await worklet(beforeWorklet,BeforeSynth,rate,wasmBinary,true);
    const after=route==='local'?await local(ScspSynth,rate,wasmBinary):await worklet(currentWorklet.toString(),ScspSynth,rate,wasmBinary,false);
    try{
      const a=await exercise(before,route,rate,hz,scenario),b=await exercise(after,route,rate,hz,scenario);
      const label=[route,rate,scenario,hz].join('/');
      compare(b.left,a.left,label+' exact left PCM');compare(b.right,a.right,label+' exact right PCM');
      compare(after.trace,before.trace,label+' effective register / PCM-upload trace');
      compare(b.ram,a.ram,label+' sample RAM');compare(b.state,a.state,label+' legacy authored state');
      assert(a.left.every(Number.isFinite)&&a.right.every(Number.isFinite));
      cases.push({route,sampleRate:rate,scenario,frequencyHz:hz,stereoFrames:a.left.length,
        exactPcmEqual:true,exactEffectiveWriteTraceEqual:true,exactRamEqual:true,legacyStateEqual:true,
        pcmLeftSha256:sha(f32bytes(a.left)),pcmRightSha256:sha(f32bytes(a.right)),
        traceWrites:after.trace.length,traceSha256:sha(JSON.stringify(after.trace)),ramSha256:sha(a.ram)});
    }finally{before.dispose();after.dispose();}
  }
  const senderPath='tetorica_src/runtime/playground_performance_sender.js';
  const oldSenderSource=reconstructScspDspParityPredecessor(senderPath,await readFile(path(senderPath)),receipt);
  const oldSender=(await import('data:text/javascript;base64,'+Buffer.from(oldSenderSource).toString('base64'))).createPerformanceSender;
  const transportCases=[];
  for(const kind of ['chip','fx','spc','independent','primary'])for(const policy of ['timed','native','keyboard']) {
    const before=senderPackets(oldSender,kind,policy),after=senderPackets(createPerformanceSender,kind,policy);
    compare(after,before,'Legacy Worker packets: '+kind+'/'+policy);
    transportCases.push({kind,policy,exactPacketsEqual:true,packets:after.length,sha256:sha(JSON.stringify(after))});
  }
  return{schemaVersion:1,scope:'playground-scsp-optional-dsp-default-audio-parity',baseCommit:SCSP_DSP_PARITY_BASE_COMMIT,
    deviceOpened:false,reference:'Exact pre-feature ScspSynth/Worklet sources reconstructed without Git; unchanged real SCSP WASM',
    tracePolicy:'Compare every effective register value after each write, retaining duplicates and PCM-upload order. New masked dry writes preserve the previous default-zero effect-return bits.',
    statePolicy:'Normalize independent bank IDs and omitted dspSend to zero; no DSP configuration is requested.',
    sources,binary:record(wasmBinary),predecessors:Object.fromEntries(Object.entries(predecessors).map(([name,pin])=>[name,{...pin,...receipt.sources[name].before}])),cases,transportCases};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);assert(args.length===0||args.length===1&&args[0]==='--check','Usage: node scripts/record_playground_scsp_dsp_default_parity.mjs [--check]');
  const report=await measureScspDspDefaultParity(),text=JSON.stringify(report,null,2)+'\n';
  if(args[0]==='--check')assert.equal(await readFile(path(SCSP_DSP_PARITY_REPORT),'utf8'),text,'SCSP default parity evidence changed');
  else await writeFile(path(SCSP_DSP_PARITY_REPORT),text);
  console.log(`SCSP default audio parity: ${report.cases.length} cases PASS; no device opened.`);
}
