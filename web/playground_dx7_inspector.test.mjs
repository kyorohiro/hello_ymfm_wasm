import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createDX7,createInitVoice,createVoiceSysex,createBankSysex,parseSysex} from './msfa_dx7/src/index.js';
import {presetToVoice,voiceToPreset,validatePreset,validateOperator,validateOperators} from './msfa_dx7/src/preset.js';
import {createProcessorPerformance,nativeVoiceChannel} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {createDx7Client} from './playground_dx7.js';

const RATE=48000,peak=values=>values.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
const wasmBytes=await readFile(new URL('./msfa_dx7/wasm/msfa.wasm',import.meta.url));
const source=(await readFile(new URL('./playground_dx7_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const inspectorSource=(await readFile(new URL('./playground_dx7_inspector.js',import.meta.url),'utf8'))
  .replace(/^import .*;$/gm,'').replace('export class Dx7VoiceInspector','class Dx7VoiceInspector')+'\nglobalThis.Dx7VoiceInspector=Dx7VoiceInspector;';
async function setup(){
  let Processor,frame=0,resolveReady;const messages=[],ready=new Promise(resolve=>resolveReady=resolve);
  const port={postMessage(message){messages.push(message);if(message.ready||message.fatal)resolveReady(message);}};
  const scope=vm.createContext({sampleRate:RATE,createDX7,createInitVoice,createVoiceSysex,parseSysex,presetToVoice,voiceToPreset,
    validatePreset,validateOperator,validateOperators,nativeVoiceChannel,receiveChipInspector,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Processor=Value});
  assert.equal(vm.runInContext('typeof structuredClone',scope),'undefined','the real Inspector module must run in the Worklet global, not inherit Node globals');
  vm.runInContext(inspectorSource,scope);vm.runInContext(source,scope);
  const processor=new Processor({processorOptions:{wasmBytes}}),metadata=await ready;assert(metadata.ready,JSON.stringify(metadata));
  const input={start(){},close(){},postMessage:data=>processor.receive(data,replies)},replies={postMessage:data=>queueMicrotask(()=>input.onmessage({data}))};
  const client=createDx7Client(input,metadata);
  return {processor,client,messages,port,
    receive:data=>processor.receive(data,port),
    read(){processor.receive({type:'chip-inspector',action:'read',id:'read'},port);const result=messages.at(-1);assert(!result.error,result.error);return result.value;},
    invoke(method,args=[]){processor.receive({type:'chip-inspector',action:'invoke',method,args,id:'invoke'},port);const result=messages.at(-1);if(result.error)throw new Error(result.error);return result.value;},
    render(frames){const channels=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[channels]);frame+=frames;return channels;},
    close(){client.dispose();processor.dispose();},
  };
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('DX7 operator and batch editing work in an AudioWorklet global without structuredClone',async()=>{
  const p=await setup();try{
    p.invoke('setOperator',[1,{coarse:2,envelope:{rates:[99,87,65,43]},keyboardScaling:{leftDepth:23}}]);
    p.invoke('setOperators',[[[1,{fine:17,envelope:{levels:[99,80,45,0]}}],[6,{mode:'fixed',coarse:3,keyboardScaling:{rightDepth:42}}]]]);
    const preset=p.read().preset;assert.equal(preset.operators[1].coarse,2);assert.equal(preset.operators[1].fine,17);
    assert.deepEqual(plain(preset.operators[1].envelope),{rates:[99,87,65,43],levels:[99,80,45,0]});
    assert.equal(preset.operators[1].keyboardScaling.leftDepth,23);assert.equal(preset.operators[6].keyboardScaling.rightDepth,42);
    assert.equal(preset.operators[6].mode,'fixed');p.invoke('auditionOn',[0,69,'no-window-api']);
    assert(peak(p.render(4096)[0])>.001);assert.equal(p.processor.dead,false);
  }finally{p.close();}
});

test('DX7 read distinguishes applied bank/preset from future metadata without audio or sound writes',async()=>{
  const p=await setup();try{
    await p.client.loadSysex(createBankSysex(Array.from({length:32},(_,i)=>createInitVoice('VOICE '+i))));
    p.receive({type:'performance-start',session:1});
    p.receive({performance:{session:1,owner:'code',time:.01},commands:[{method:'selectVoice',args:[7]},{method:'setOperator',args:[6,{coarse:9}],id:1}]});
    const before=p.processor.performance.getStats();let calls=0;
    for(const method of ['renderInto','setPreset','setOperator','setOperators','setFeedback','selectVoice','noteOn','noteOff','panic']){
      const original=p.processor.synth[method].bind(p.processor.synth);p.processor.synth[method]=(...args)=>{calls++;return original(...args);};
    }
    const state=p.read();assert.equal(state.kind,'dx7');assert.equal(state.polyphony,16);assert.equal(state.selectedVoice,0);
    assert.equal(state.preset.name,'VOICE 0');assert.equal(state.logical.selectedVoice,7);assert.equal(state.logical.preset.operators[6].coarse,9);
    assert.equal(state.logical.pendingCommands,2);assert.equal(calls,0);assert.deepEqual(p.processor.performance.getStats(),before);
    state.preset.operators[1].coarse=31;assert.notEqual(p.read().preset.operators[1].coarse,31);
    p.render(481);assert.equal(p.read().selectedVoice,7);assert.equal(p.read().preset.operators[6].coarse,9);assert.equal(p.read().logical.pendingCommands,0);
  }finally{p.close();}
});

test('DX7 OP1..6 edits match reversed wire blocks and partial global/EG edits preserve every other field',async()=>{
  const p=await setup();try{
    for(let op=1;op<=6;op++){
      p.invoke('setOperator',[op,{coarse:op,fine:op*7,outputLevel:90-op,detune:op,envelope:{rates:[90,80,70,60],levels:[99,80,30,0]},keyboardScaling:{leftDepth:op*5}}]);
      assert.equal(p.processor.appliedVoices[0][(6-op)*21+18],op);
    }
    const before=plain(p.read().preset);
    const result=p.invoke('setPreset',[{name:'EDIT',algorithm:31,lfo:{speed:43},pitchEnvelope:{rates:[10,20,30,40]}}]);
    assert.equal(result.preset.name,'EDIT');assert.equal(result.preset.algorithm,31);assert.equal(result.preset.lfo.speed,43);
    assert.deepEqual(plain(result.preset.operators),before.operators);assert.deepEqual(plain(result.preset.pitchEnvelope.levels),before.pitchEnvelope.levels);
    const stable=plain(p.read());
    for(const [method,args]of [['setOperator',[6,{coarse:3,outputLevel:100}]],['setPreset',[{feedback:6,lfo:{waveform:6}}]],['setOperators',[[[1,{coarse:3}],[7,{fine:1}]]]],['selectVoice',[32]],['auditionOn',[0,128,'bad']]]){
      assert.throws(()=>p.invoke(method,args));assert.deepEqual(plain(p.read()),stable,'validate the complete edit before touching sound or leases');
    }
  }finally{p.close();}
});

for(const path of ['Main','Worker'])test(`DX7 ${path} manual pitches reject competing code and global edits while other notes continue`,async()=>{
  const p=await setup();try{
    p.receive({type:'performance-start',session:1});
    const code=commands=>path==='Main'?commands.forEach(command=>p.receive(command)):p.receive({performance:{session:1,owner:'code',time:0},commands});
    p.invoke('auditionOn',[0,69,'manual-a']);p.invoke('auditionOn',[0,72,'manual-b']);
    code([{method:'noteOff',args:[69]},{method:'noteOn',args:[69,20]},{method:'noteOn',args:[60,80]}]);
    code([{method:'setOperator',args:[1,{coarse:3}],id:22}]);code([{method:'allNotesOff'}]);code([{method:'noteOn',args:[64,90]}]);
    await p.client.getState();p.render(256);
    const read=p.read();assert.equal(read.preset.operators[1].coarse,1);
    assert(read.activeNotes.some(note=>note.midi===69&&note.manual&&note.velocity===100));assert(read.activeNotes.some(note=>note.midi===72&&note.manual));
    assert(read.activeNotes.some(note=>note.midi===64&&!note.manual));assert(!read.activeNotes.some(note=>note.midi===60));
    p.invoke('setOperator',[1,{coarse:2}]);assert.equal(p.read().preset.operators[1].coarse,2);
    assert(peak(p.render(2048)[0])>.001);
    p.invoke('auditionOn',[0,69,'replacement']);assert.equal(p.invoke('auditionOff',[0,'manual-a']),false);
    assert.equal(p.invoke('auditionOff',[0,'replacement']),true);assert(p.read().activeNotes.some(note=>note.midi===72&&note.manual));
    p.invoke('auditionOff',[0,'manual-b']);code([{method:'setOperator',args:[1,{coarse:3}]},{method:'noteOn',args:[69,75]}]);
    await p.client.getState();p.render(1);assert.equal(p.read().preset.operators[1].coarse,3);
    assert(p.read().activeNotes.some(note=>note.midi===69&&!note.manual&&note.velocity===75));
  }finally{p.close();}
});

test('DX7 manual lease wins over a previously queued patch and raw Main commands waiting in the microtask queue',async()=>{
  const p=await setup();try{
    p.receive({type:'performance-start',session:1});
    p.receive({performance:{session:1,owner:'old',time:.01},commands:[{method:'setOperator',args:[1,{coarse:9}],id:4},{method:'noteOff',args:[69]}]});
    p.receive({method:'noteOff',args:[69]});p.receive({method:'setFeedback',args:[7]});
    p.invoke('auditionOn',[0,69,'held']);await p.client.getState();p.render(481);
    const state=p.read();assert.equal(state.preset.operators[1].coarse,1);assert.equal(state.preset.feedback,0);
    assert.equal(state.logical.pendingCommands,0);assert.equal(state.logical.preset.operators[1].coarse,1);
    assert(state.activeNotes.some(note=>note.midi===69&&note.manual));
  }finally{p.close();}
});

for(const method of ['allNotesOff','panic'])test(`DX7 a queued Main ${method} releases earlier code notes when an editor acquires a lease before application`,async()=>{
  const p=await setup();try{
    p.client.noteOn(60,80);await p.client.getState();
    p.receive({method});p.invoke('auditionOn',[0,69,'manual']);await p.client.getState();
    assert.deepEqual(plain(p.read().activeNotes),[{midi:69,velocity:100,manual:true}]);
    assert(peak(p.render(1024)[0])>.001);
  }finally{p.close();}
});

test('DX7 runtime Stop clears all manual IDs/reservations and PCM while retaining applied bank/patch',async()=>{
  const p=await setup();try{
    await p.client.loadSysex(createBankSysex(Array.from({length:32},(_,i)=>createInitVoice('VOICE '+i))));
    p.invoke('selectVoice',[7]);p.invoke('setOperator',[1,{coarse:2}]);p.receive({type:'performance-start',session:3});
    p.invoke('auditionOn',[0,69,'old']);const before=plain(p.read());assert(peak(p.render(256)[0])>.001);
    p.receive({performance:{session:3,owner:'code',time:1},commands:[{method:'noteOn',args:[60,100]}]});
    p.receive({type:'performance-stop',session:3});
    const after=p.read();assert.deepEqual(plain(after.preset),before.preset);assert.deepEqual(plain(after.voices),before.voices);assert.equal(after.selectedVoice,7);
    assert.deepEqual(plain(after.auditions),[]);assert.deepEqual(plain(after.activeNotes),[]);assert.equal(peak(p.render(48001)[0]),0);
    assert.equal(p.invoke('auditionOff',[0,'old']),false);
    p.receive({type:'performance-start',session:4});p.invoke('auditionOn',[0,72,'new']);p.receive({type:'performance-stop',session:3});
    assert(p.read().activeNotes.some(note=>note.midi===72&&note.manual));assert.equal(p.invoke('auditionOff',[0,'old']),false);
    p.receive({method:'stopVoices'});assert.equal(peak(p.render(512)[0]),0);assert.deepEqual(plain(p.read().auditions),[]);
  }finally{p.close();}
});

test('DX7 inspector operator frequency and level edits affect actual held PCM, and all 16 manual pitches retain their own IDs',async()=>{
  const p=await setup();try{
    const frequency=pcm=>{let crossings=0;for(let i=1;i<pcm.length;i++)if(pcm[i-1]<=0&&pcm[i]>0)crossings++;return crossings*RATE/pcm.length;};
    p.invoke('auditionOn',[0,69,'tone']);p.render(1024);const first=p.render(4800)[0];
    assert(Math.abs(frequency(first)-440)<12);p.invoke('setOperator',[1,{coarse:2}]);p.render(1024);
    const doubled=p.render(4800)[0];assert(Math.abs(frequency(doubled)-880)<12);
    p.invoke('setOperator',[1,{outputLevel:0}]);p.render(2048);assert(peak(p.render(4800)[0])<.00001);
    p.invoke('auditionAllOff');p.invoke('setOperator',[1,{outputLevel:99}]);
    for(let midi=48;midi<64;midi++)p.invoke('auditionOn',[0,midi,'key-'+midi]);
    assert.equal(p.read().auditions.length,16);const before=plain(p.read());
    assert.throws(()=>p.invoke('auditionOn',[0,64,'overflow']),/16/);assert.deepEqual(plain(p.read()),before);
    assert.equal(p.invoke('auditionOff',[0,'key-55']),true);assert.equal(p.read().auditions.length,15);
    assert(p.read().auditions.some(note=>note.id==='key-54'));assert(p.read().auditions.some(note=>note.id==='key-56'));
    await assert.rejects(p.client.loadSysex(createVoiceSysex(createInitVoice('BLOCKED'))),/manual audition/);
    assert.notEqual(p.read().preset.name,'BLOCKED');p.invoke('auditionAllOff');assert.deepEqual(plain(p.read().auditions),[]);
    assert.equal(p.invoke('auditionOn',[0,69,'zero',0]),false);p.invoke('auditionOn',[0,69,'zero']);
    assert.equal(p.invoke('auditionOn',[0,69,'zero',0]),true);assert.deepEqual(plain(p.read().auditions),[]);
  }finally{p.close();}
});
