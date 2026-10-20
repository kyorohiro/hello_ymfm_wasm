import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Ym2151VoiceInspector} from './playground_ym2151_inspector.js';
import {Ym2151} from './ym2151.js';
import factory from '../docs/generated/ym2151_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {createYm2151Client} from './playground_ym2151.js';
import {validateChipClock} from './playground_chip_clock.js';
import {NativeRuntimeSynth} from './native_runtime_synth.js';
import {createNativeWorkerApis} from './playground_native_primary.js';

const RATE=48000,peak=values=>values.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
async function setup(){
  let Processor,frame=0,ready;const messages=[],port={postMessage:value=>{messages.push(value);if(value.ready||value.error)ready(value);}};
  const started=new Promise(resolve=>ready=resolve),source=(await readFile(new URL('./playground_ym2151_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{Ym2151,factory,Ym2151VoiceInspector,receiveChipInspector,validateChipClock,sampleRate:RATE,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Processor=Value});
  const processor=new Processor({processorOptions:{wasmBinary:await readFile(new URL('../docs/generated/ym2151_wasm.wasm',import.meta.url))}});
  assert.equal((await started).ready,true,JSON.stringify(messages));
  const clientPort={start(){},close(){},postMessage:data=>processor.receive(data,{postMessage:reply=>clientPort.onmessage?.({data:reply})})};
  const client=createYm2151Client(clientPort);
  return {processor,client,clientPort,messages,port,
    receive(data){processor.receive(data,port);},
    read(){processor.receive({type:'chip-inspector',action:'read',id:'read'},port);const value=messages.at(-1);assert(!value.error,value.error);return value.value;},
    invoke(method,args=[]){processor.receive({type:'chip-inspector',action:'invoke',method,args,id:'invoke'},port);const value=messages.at(-1);if(value.error)throw new Error(value.error);return value.value;},
    render(frames){const out=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[out]);frame+=frames;return out;},
    dispose(){processor.dispose();},
  };
}
function configure(p,ch=0){
  p.invoke('setVoice',[ch,{algorithm:7,feedback:0,pan:{left:true,right:true},operators:Array.from({length:4},(_,op)=>({mul:1,tl:op===3?32:127,ar:31,d1r:0,d2r:0,rr:0}))}]);
}

test('OPM all eight channels decode logical operators and atomic partial edits preserve adjacent raw fields',async()=>{
  const p=await setup();try{
    for(let ch=0;ch<8;ch++)for(let op=0;op<4;op++){
      const slot=[0,16,8,24][op],raw=[[0x40,0xc5],[0x60,99],[0x80,0xad],[0xa0,0x99],[0xc0,0xcf],[0xe0,0xb4]];
      for(const [base,value]of raw)p.client.writeRegister(base+slot+ch,value);
      const before=p.read().channels[ch].operators[op];assert.deepEqual(before,{dt1:4,mul:5,tl:99,ks:2,ar:13,am:true,d1r:25,dt2:3,d2r:15,d1l:11,rr:4});
      p.invoke('setOperator',[ch,op,{dt1:6,dt2:2,ar:21,tl:25}]);
      const state=p.read(),operator=state.channels[ch].operators[op];assert.deepEqual(operator,{...before,dt1:6,dt2:2,ar:21,tl:25});
      assert.equal(state.registers[0x40+slot+ch],0xe5,'DT1 retains raw bit 7 and multiplier');
      const registers=state.registers;
      assert.throws(()=>p.invoke('setOperator',[ch,op,{mul:3,rr:16}]),/rr/);assert.deepEqual(p.read().registers,registers,'an invalid later field cannot partially change the chip');
    }
    // The existing public low-level client intentionally uses physical register order.
    p.client.setOperator(0,1,{mul:12});assert.equal(p.read().channels[0].operators[2].mul,12);
    const registers=p.read().registers;
    assert.throws(()=>p.invoke('setVoice',[0,{feedback:7,operators:[{tl:3},{ar:32}]}]),/ar/);assert.deepEqual(p.read().registers,registers);
  }finally{p.dispose();}
});

test('OPM Stop RPC waits for applied silence and lease retirement before a new admin audition',async()=>{
  const p=await setup();try{
    configure(p);p.invoke('auditionOn',[0,69,'old']);p.render(2048);const before=p.read().channels[0];
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:5},commands:[{method:'writeRegister',args:[8,0x78]}]});
    let release,done=false;const post=p.clientPort.postMessage;
    p.clientPort.postMessage=data=>{if(data.method==='stopVoices')release=()=>post(data);else post(data);};
    const stopped=p.client._stopVoices().then(()=>done=true);p.client._cancelClockRequests('Run stopped');
    await Promise.resolve();assert.equal(done,false);assert.equal(p.read().channels[0].active,true);
    release();await stopped;const after=p.read().channels[0];
    assert.equal(after.active,false);assert.equal(after.frequency,before.frequency);assert.deepEqual(after.operators,before.operators);
    assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[0,'old']),false);
    p.invoke('auditionOn',[0,72,'new']);assert(peak(p.render(4096)[0])>.01);assert.equal(p.read().channels[0].active,true);
    p.receive({performance:{session:1,owner:'cleanup',time:5},commands:[{method:'stopVoices',id:'stop-ack'}]});
    assert(p.messages.some(reply=>reply.id==='stop-ack'&&!reply.error));assert.equal(p.read().channels[0].active,false);
    assert.equal(p.invoke('auditionOff',[0,'new']),false);assert.equal(p.processor.performance.getStats().queuedCommands,0);
    const pending=p.client._stopVoices();p.client.dispose();await assert.rejects(pending,/disposed/i);
  }finally{p.dispose();}
});

test('OPM channel, pitch, split LFO and noise snapshots follow only applied writes and reads issue zero writes',async()=>{
  const p=await setup();try{
    p.client.writeRegister(0x20,0xdf);p.client.writeRegister(0x38,0x6d);p.client.writeRegister(0x30,3);p.client.writeRegister(0x1b,0xfc);p.client.writeRegister(0x0f,0x65);
    p.invoke('setVoice',[0,{algorithm:2,pan:{left:false},ams:2,pms:4,frequency:440}]);
    const ch=p.read().channels[0];assert.equal(ch.algorithm,2);assert.equal(ch.feedback,3);assert.deepEqual(ch.pan,{left:false,right:true});assert.equal(ch.ams,2);assert.equal(ch.pms,4);assert.equal(ch.keyCode,0x4a);assert.equal(ch.keyFraction,0);assert.equal(ch.frequency,440);assert.equal(ch.midi,69);
    assert.equal(p.read().registers[0x30],3,'pitch writes preserve unused register bits');
    p.invoke('setVoice',[0,{keyFraction:32}]);assert.equal(p.read().channels[0].keyCode,0x4a);assert.equal(p.read().channels[0].keyFraction,32);assert(Math.abs(p.read().channels[0].frequency-440*2**(.5/12))<.001);
    p.invoke('setLFO',[{frequency:139,amDepth:51,pmDepth:73,waveform:2}]);assert.deepEqual(p.read().lfo,{frequency:139,amDepth:51,pmDepth:73,waveform:2});assert.equal(p.read().registers[0x1b],0xfe);
    p.invoke('setLFO',[{amDepth:17}]);assert.equal(p.read().lfo.pmDepth,73,'AMD and PMD share a register but must retain separate values');
    p.invoke('setNoise',[{enabled:true}]);assert.deepEqual(p.read().noise,{enabled:true,frequency:5});assert.equal(p.read().registers[15],0xe5);p.invoke('setNoise',[{frequency:31}]);assert.equal(p.read().noise.enabled,true);
    p.receive({type:'performance-start',session:1});const before=p.read();p.receive({performance:{session:1,owner:'future',time:.01},commands:[{method:'writeRegister',args:[0x20,0xc7]}]});
    let writes=0;const write=p.processor.chip.write.bind(p.processor.chip);p.processor.chip.write=(...args)=>{writes++;return write(...args);};
    assert.deepEqual(p.read(),before);assert.equal(writes,0);assert.equal(p.processor.performance.getStats().queuedCommands,1);
    p.render(481);assert.equal(p.read().channels[0].algorithm,7);assert.equal(writes,2);
    p.receive({method:'clock',args:[4000000],id:1});assert.equal(p.read().clock,4000000);assert(Math.abs(p.read().channels[0].frequency-before.channels[0].frequency*4000000/3579545)<.001);
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`OPM ${path}: a held manual channel rejects competing writes while another channel and its lookahead continue`,async()=>{
  const p=await setup();try{
    configure(p,0);configure(p,1);p.receive({type:'performance-start',session:1});
    p.invoke('auditionOn',[0,69,'held']);const held=p.read().channels[0],lfo=p.read().lfo;
    const competing=[{method:'writeRegister',args:[0x28,0x2a]},{method:'writeRegister',args:[0x78,100]},{method:'writeRegister',args:[8,0]},{method:'writeRegister',args:[0x18,200]},{method:'allNotesOff',args:[]},{method:'writeRegister',args:[0x29,0x3a]},{method:'writeRegister',args:[8,0x79]}];
    if(path==='Main')for(const command of competing)p.receive(command);
    else p.receive({performance:{session:1,owner:'code',time:.01},commands:competing});
    p.render(1024);assert.equal(p.read().channels[0].frequency,held.frequency);assert.equal(p.read().channels[0].operators[3].tl,32);assert.equal(p.read().channels[0].active,true);assert.deepEqual(p.read().lfo,lfo);assert.equal(p.read().channels[1].active,true);assert.notEqual(p.read().channels[1].frequency,held.frequency);
    p.invoke('setOperator',[0,3,{tl:42}]);assert.equal(p.read().channels[0].operators[3].tl,42,'own edits are allowed during the manual lease');
    const output=p.render(4800);assert(output.every(c=>c.every(x=>Number.isFinite(x)&&Math.abs(x)<1)));assert(peak(output[0])>.01);
    p.invoke('auditionOn',[0,72,'replacement']);p.render(2);assert.equal(p.invoke('auditionOff',[0,'held']),false);assert.equal(p.read().channels[0].active,true);
    p.invoke('auditionOff',[0,'replacement']);assert.equal(p.read().channels[0].active,false);assert.equal(p.read().channels[1].active,true,'release touches only the auditioned channel');
    p.client.setNote(0,57);p.client.keyOn(0);assert.equal(p.read().channels[0].active,true);assert.notEqual(p.read().channels[0].frequency,held.frequency,'ordinary code resumes after release');
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`OPM ${path}: runtime Stop retires IDs, cancels future notes and keeps the applied patch/pitch including RR=0`,async()=>{
  const p=await setup();try{
    configure(p);p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[0,69,'stop']);assert(peak(p.render(4096)[0])>.01);
    // Stop must use applied editor registers, not a stale borrowed client's shadow.
    const before=p.read().channels[0],commands=[{method:'writeRegister',args:[0x28,0x2a]},{method:'writeRegister',args:[8,0x78]}];
    p.receive({performance:{session:1,owner:'future',time:5},commands});
    if(path==='Main'){const runtime=new NativeRuntimeSynth({chip:'x68000'});runtime.primaryApis.opm=p.client;runtime.stopAllNative();}
    else {const worker=createNativeWorkerApis([{name:'ym2151',globalName:'opm',port:{start(){},postMessage:data=>p.receive(data)},state:p.client._getState()}],{port:value=>value},()=>{});worker.stop();}
    const after=p.read().channels[0];assert.equal(after.active,false);assert.equal(after.frequency,before.frequency);assert.deepEqual(after.operators,before.operators);assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[0,'stop']),false);
    assert.equal(peak(p.render(4800)[0]),0,'RR=0 cannot leave a sustained release after Stop');
    p.receive({type:'performance-start',session:2});p.invoke('auditionOn',[0,69,'next']);p.receive({type:'performance-stop',session:1});const next=p.render(4096)[0];assert.equal(p.read().channels[0].active,true,'expired session Stop cannot silence a replacement audition');assert(peak(next)>.01,'the held patch can sound again after Stop');
    const registers=p.read().registers;assert.throws(()=>p.invoke('auditionOn',[0,0,'invalid-pitch']),/OPM/);assert.deepEqual(p.read().registers,registers);assert.equal(p.invoke('auditionOff',[0,'next']),true,'failed audition validation must retain the original lease');
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`OPM ${path}: script allNotesOff stops other voices while preserving held manual notes`,async()=>{
  const p=await setup();try{
    configure(p,0);configure(p,1);p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[0,69,'manual']);p.render(2);p.client.noteOn(1,57);
    const command={method:'allNotesOff',args:[]};
    if(path==='Main')p.receive(command);else {p.receive({performance:{session:1,owner:'code',time:.01},commands:[command]});p.render(481);}
    assert.equal(p.read().channels[0].active,true);assert.equal(p.read().channels[1].active,false);
    p.receive({method:'forceKeyOff',args:[0]});assert.equal(p.read().channels[0].active,true,'a script channel release cannot override manual ownership');
    assert(peak(p.render(2400)[0])>.01);p.invoke('auditionOff',[0,'manual']);assert(peak(p.render(2400)[0])<.00001);
  }finally{p.dispose();}
});

test('OPM replacement Main and Worker ports reject callbacks from retired clients',async()=>{
  const p=await setup();try{
    configure(p);p.invoke('auditionOn',[0,69,'live']);p.render(2);
    for(const primaryWorker of [false,true]){
      const old={start(){},close(){}},replacement={start(){},close(){}};
      p.processor.port.onmessage({data:{primaryWorker,port:old}});const stale=old.onmessage;
      p.processor.port.onmessage({data:{primaryWorker,port:replacement}});
      const before=p.read();
      for(const data of [{method:'stopVoices',args:[]},{method:'forceKeyOff',args:[0]},{method:'writeRegister',args:[0x28,0x2a]},{type:'performance-stop',session:9}])stale({data});
      assert.deepEqual(p.read(),before,'late old-port Stop, release and retune must be ignored');
    }
    assert.equal(p.read().channels[0].active,true);
  }finally{p.dispose();}
});

test('OPM taking a manual lease from code or an old held key sends keyOff before keyOn to retrigger envelopes',async()=>{
  const p=await setup();try{
    configure(p);p.receive({type:'performance-start',session:1});
    p.receive({performance:{session:1,owner:'old-code',time:0},commands:[{method:'writeRegister',args:[0x28,0x3a]},{method:'writeRegister',args:[8,0x78]}]});p.render(128);
    assert.equal(p.read().channels[0].active,true);
    const writes=[],write=p.processor.chip.write.bind(p.processor.chip),generate=p.processor.chip.generateStereo.bind(p.processor.chip);let address=0,nativeFrames=0;
    p.processor.chip.write=(offset,value)=>{if(offset===0)address=value;else writes.push([address,value,nativeFrames]);return write(offset,value);};
    p.processor.chip.generateStereo=frames=>{nativeFrames+=frames;return generate(frames);};
    for(const [midi,id]of [[69,'first-manual'],[72,'replacement-manual']]){
      writes.length=0;const framesBefore=nativeFrames;p.invoke('auditionOn',[0,midi,id]);p.read();assert.equal(nativeFrames,framesBefore,'neither commands nor reads generate/discard audio');
      assert.deepEqual(writes.filter(([register])=>register===8).map(([r,v])=>[r,v]),[[8,0]],'keyOn waits for an ordinary rendered native interval');
      p.render(2);const keys=writes.filter(([register])=>register===8);assert.deepEqual(keys.map(([r,v])=>[r,v]),[[8,0],[8,0x78]],'an ownership transfer must release the old physical key before triggering the new envelope');assert(keys[1][2]>keys[0][2],'at least one normally rendered native frame consumes keyOff before keyOn');
    }
    assert.equal(p.invoke('auditionOff',[0,'first-manual']),false);assert.equal(p.read().channels[0].active,true);
  }finally{p.dispose();}
});

test('OPM a decayed held voice attacks again when another audition replaces its lease',async()=>{
  const p=await setup();try{
    configure(p);p.invoke('setOperator',[0,3,{tl:0,ar:31,d1r:31,d1l:15,d2r:0,rr:15}]);
    p.invoke('auditionOn',[0,69,'decaying-a']);const first=p.render(RATE)[0];assert(peak(first.subarray(0,2400))>.01);assert(peak(first.subarray(RATE-2400))<.00001,'the first key has decayed while remaining physically on');
    p.invoke('auditionOn',[0,72,'decaying-b']);const replacement=p.render(4800)[0];assert(peak(replacement)>.01,'replacement must restart the actual envelope, not merely write OFF/ON before one prepare step');
  }finally{p.dispose();}
});

test('OPM queued audition starts wait for a real native interval and cancel safely before it is rendered',async()=>{
  const p=await setup();try{
    configure(p);p.receive({method:'clock',args:[100000],id:'slow-native'});
    p.invoke('auditionOn',[0,24,'slow-a']);assert.equal(p.read().channels[0].active,false,'an armed note is not an applied gate');
    p.render(1);assert.equal(p.read().channels[0].active,false,'one output sample is shorter than one native sample at this clock');
    p.invoke('auditionOn',[0,26,'slow-b']);assert.equal(p.invoke('auditionOff',[0,'slow-a']),false);p.render(128);assert.equal(p.read().channels[0].active,true,'only the current replacement ID may start');
    p.invoke('auditionOff',[0,'slow-b']);
    let session=0;
    for(const action of ['release','stop','session-stop','reset']){
      p.receive({type:'performance-start',session:++session});
      p.invoke('auditionOn',[0,24,action]);
      if(action==='release')p.invoke('auditionOff',[0,action]);
      else if(action==='stop')p.client._stopVoices();
      else if(action==='session-stop')p.receive({type:'performance-stop',session});
      else p.processor.apply({method:'reset',args:[]},p.port);
      p.render(256);assert.equal(p.read().channels[0].active,false,`${action} must discard the pending keyOn`);assert.equal(p.processor.auditionStarts.size,0);
    }
    p.invoke('auditionOn',[0,24,'dispose']);p.dispose();assert.equal(p.processor.auditionStarts.size,0);assert.equal(p.processor.process([],[[new Float32Array(128),new Float32Array(128)]]),false);
  }finally{p.dispose();}
});

test('OPM audition retriggering leaves another channel’s real PCM and queued event timing exactly unchanged',async()=>{
  const actual=await setup(),reference=await setup();try{
    for(const p of [actual,reference]){
      configure(p,0);configure(p,1);p.invoke('setVoice',[0,{pan:{left:true,right:false}}]);p.invoke('setVoice',[1,{pan:{left:false,right:true}}]);p.client.noteOn(1,57);
      p.receive({type:'performance-start',session:1});
      for(const [time,command]of [[63,{method:'writeRegister',args:[0x29,0x3a]}],[191,{method:'writeRegister',args:[0x79,40]}]])p.receive({performance:{session:1,owner:'channel-1',time:time/RATE},commands:[command]});
    }
    actual.invoke('auditionOn',[0,69,'first']);
    for(const count of [1,127,128,53,1024])assert.deepEqual(actual.render(count)[1],reference.render(count)[1],'left-only manual audition must not perturb right-only channel 2, including intraquantum events');
    actual.invoke('auditionOn',[0,72,'replacement']);
    for(const count of [1,127,128,53,1024])assert.deepEqual(actual.render(count)[1],reference.render(count)[1],'replacement must preserve every native frame of the other voice');
  }finally{actual.dispose();reference.dispose();}
});

test('OPM every channel auditions finite real-core PCM with panning and forceOff keeps its voice',async()=>{
  const p=await setup();try{
    for(let ch=0;ch<8;ch++){
      configure(p,ch);p.invoke('setVoice',[ch,{pan:{left:true,right:false}}]);p.invoke('auditionOn',[ch,69,`ch-${ch}`]);
      const before=p.read().channels[ch],output=p.render(4800);assert(peak(output[0])>.01,`channel ${ch}`);assert.equal(peak(output[1]),0);assert(output[0].every(x=>Number.isFinite(x)&&Math.abs(x)<1));
      if(ch===7){p.invoke('setNoise',[{enabled:true,frequency:20}]);assert(peak(p.render(2400)[0])>.01);p.invoke('setNoise',[{enabled:false}]);}
      p.invoke('auditionOff',[ch,`ch-${ch}`]);assert.deepEqual(p.read().channels[ch].operators,before.operators);assert.equal(p.read().channels[ch].keyCode,before.keyCode);assert(peak(p.render(2400)[0])<.00001);
    }
  }finally{p.dispose();}
});
