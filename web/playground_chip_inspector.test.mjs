import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {PsgInspectorState,RfInspectorState,receiveChipInspector,readPwmInspector} from './playground_chip_inspector_state.js';
import {createChipInspector} from './playground_chip_inspector.js';
import {RF5C164Synth} from './rf5c164synth.js';
import {encodeRf5c164} from './rf5c164_pcm.js';
import {PWM32XPlayback} from './pwm32x_playback.js';

test('shared OPN/PSG admin ports keep their kind and replaced instances receive a fresh connection token',async()=>{
  const first=new MessageChannel(),second=new MessageChannel();let active=first.port2;const kinds=[];
  first.port1.on('message',data=>{kinds.push(data.inspectorKind);first.port1.postMessage({type:'chip-inspector-result',id:data.id,value:data.inspectorKind});});
  const inspector=createChipInspector({endpoints:()=>['ym2612','segapsg'].map(kind=>({id:kind,kind,port:active})),decode:async()=>{}});
  try{
    const token=inspector.getConnectionToken('ym2612');assert.equal(inspector.getConnectionToken('segapsg'),token);
    assert.equal(await inspector.read('ym2612'),'ym2612');assert.equal(await inspector.read('segapsg'),'segapsg');assert.deepEqual(kinds,['ym2612','segapsg']);
    active=second.port2;assert.notEqual(inspector.getConnectionToken('ym2612'),token);
  }finally{inspector.dispose();for(const {port1,port2}of[first,second]){port1.close();port2.close();}}
});

test('PSG snapshots track applied raw latch/data writes and preserve quiet audition levels',()=>{
  const chip={writes:[],write(value){this.writes.push(value);},reset(){}};
  const state=new PsgInspectorState(chip);
  chip.write(0xa3);chip.write(0x12);chip.write(0xb7);chip.write(0xe7);chip.write(0xf4);
  const snapshot=state.read();assert.equal(snapshot.channels[1].period,0x123);assert.equal(snapshot.channels[1].attenuation,7);
  assert.equal(snapshot.noise.type,'white');assert.equal(snapshot.noise.rate,'tone3');assert.equal(snapshot.noise.attenuation,4);
  const count=chip.writes.length;state.read();assert.equal(chip.writes.length,count,'read must not reset the noise register');
  state.invoke('keyOff',[1]);assert.equal(state.read().channels[1].active,false);
  state.invoke('keyOn',[1]);assert.equal(state.read().channels[1].attenuation,7);
  state.invoke('noteOn',[1,'A4']);assert.equal(state.read().channels[1].attenuation,7);
  assert.equal(state.read().channels[0].frequency,null);assert.equal(state.read().channels[0].constantOutput,true);
  chip.reset();assert(state.read().channels.every(ch=>!ch.active));assert.equal(state.read().noise.active,false);
  assert.throws(()=>state.invoke('dispose'),/Unsupported/);
});

test('PSG Keyboard noise retriggers its configured attenuation without changing noise or Tone 3 pitch',()=>{
  const chip={writes:[],write(value){this.writes.push(value);},reset(){}},state=new PsgInspectorState(chip);
  chip.write(0xc3);chip.write(0x12);chip.write(0xe7);chip.write(0xf9);chip.write(0xff);
  const before=state.read();state.invoke('auditionOn',[3,69,'noise-old']);
  assert.equal(state.read().noise.attenuation,9);assert.equal(state.read().noise.active,true);
  assert.equal(state.read().noise.rate,before.noise.rate);assert.equal(state.read().noise.type,before.noise.type);assert.equal(state.read().channels[2].period,before.channels[2].period);
  assert.equal(chip.writes.at(-1),0xf9,'no noise-register write resets the LFSR');
  state.invoke('auditionOn',[3,12,'noise-new']);assert.equal(state.invoke('auditionOff',[3,'noise-old']),false);assert(state.read().noise.active);
  assert.equal(state.invoke('auditionOff',[3,'noise-new']),true);assert.equal(state.read().noise.active,false);
  state.invoke('auditionOn',[3,80,'next']);assert.equal(state.read().noise.attenuation,9);
  assert.throws(()=>state.invoke('auditionOn',[4,69,'bad']),/0..3/);
});

test('RF snapshots follow channel bank selection, channel masks and RAM-preserving reset',()=>{
  const chip={writeRegister(){},loadMemory(){},reset(){}};
  const state=new RfInspectorState(chip);
  const control=new RF5C164Synth({transport:{write:(...args)=>chip.writeRegister(...args),loadMemory:(...args)=>chip.loadMemory(...args),reset:()=>chip.reset()}});
  control.setChannel(7,{start:512,loopStart:702,step:12345,volume:201,pan:{left:3,right:12}});control.keyOn(7);
  const ch=state.read().channels[7];assert.deepEqual(ch,{channel:7,start:512,loopStart:702,step:12345,volume:201,pan:{left:3,right:12},active:true});
  control.writeRegister(8,255);assert.equal(state.read().channels[7].active,false);
  control.writeRegister(7,0x40);assert.equal(state.read().enabled,false);
  const encoded=encodeRf5c164({channels:[Float32Array.from([.2,-.9,.1])],sampleRate:22050});
  chip.loadMemory(encoded.bytes,512);state.addSample(512,encoded.bytes,{...encoded,name:'Bass'});
  chip.reset();assert.equal(state.read().samples[0].name,'Bass');assert.equal(state.read().channels[7].step,0);
});

test('RF allocation rejects overlap and overflow, raw writes invalidate only overlapping metadata',()=>{
  const chip={writeRegister(){},loadMemory(){},reset(){}},state=new RfInspectorState(chip);
  const sample=encodeRf5c164({channels:[new Float32Array(200).fill(-.5)],sampleRate:22050});
  assert.equal(state.allocate(sample.bytes.length),0);chip.loadMemory(sample.bytes,0);state.addSample(0,sample.bytes,{...sample,name:'one'});
  assert.equal(state.allocate(sample.bytes.length),256);chip.loadMemory(sample.bytes,512);state.addSample(512,sample.bytes,{...sample,name:'two'});
  assert.throws(()=>state.allocate(300,0),/overwrite/);assert.throws(()=>state.allocate(65536),/64 KiB/);assert.throws(()=>state.allocate(1,1),/aligned/);
  assert.equal(state.read().samples[0].waveform[0],-63/126);
  chip.loadMemory(new Uint8Array(1),64);assert.deepEqual(state.read().samples.map(sample=>sample.name),['two']);
  assert.deepEqual(state.read().memoryRanges,[{address:0,end:203},{address:512,end:715}]);
  assert.equal(state.read().memoryRevision,3);
});

test('RF Keyboard transposes the existing configured sample step without cumulative pitch or RAM/pan/volume changes',()=>{
  const chip={writeRegister(){},loadMemory(){},reset(){}},state=new RfInspectorState(chip);
  const control=new RF5C164Synth({transport:{write:(...args)=>chip.writeRegister(...args),loadMemory:(...args)=>chip.loadMemory(...args),reset:()=>chip.reset()}});
  assert.throws(()=>state.invoke('auditionOn',[0,60,'empty']),/Load PCM/);assert.equal(state.read().auditions.length,0);
  chip.loadMemory(new Uint8Array(16),0);assert.throws(()=>state.invoke('auditionOn',[0,60,'no-rate']),/playback step/);
  control.setPitch(0,1000);assert.throws(()=>state.invoke('auditionOn',[0,60,'muted']),/volume and pan/);assert.equal(state.read().auditions.length,0);
  chip.loadMemory(new Uint8Array(256),512);control.setChannel(7,{start:512,loopStart:512,step:1200,volume:73,pan:{left:2,right:13}});control.setChannel(1,{start:512,loopStart:512,step:900,volume:83,pan:{left:3,right:12}});control.keyOn(1);
  const material=state.read(),settings=material.channels[7];
  state.invoke('auditionOn',[7,72,'high']);assert.equal(state.read().channels[7].step,2400);assert(state.read().channels[1].active,'selecting another PCM channel must retain the active-low mask');
  state.invoke('auditionOn',[7,60,'base']);assert.equal(state.read().channels[7].step,1200);assert.equal(state.invoke('auditionOff',[7,'high']),false);
  state.invoke('auditionOff',[7,'base']);assert.equal(state.read().channels[7].active,false);assert(state.read().channels[1].active);
  const after=state.read();assert.equal(after.memoryRevision,material.memoryRevision);assert.deepEqual(after.memoryRanges,material.memoryRanges);assert.deepEqual(after.samples,material.samples);assert.deepEqual({...after.channels[7],active:false},{...settings,active:false});
  control.setPitch(7,2000);state.invoke('auditionOn',[7,48,'lower']);assert.equal(state.read().channels[7].step,1000,'an explicit pitch edit establishes the next reference step');
  assert.throws(()=>state.invoke('auditionOn',[7,127,'overflow']),/step range/);assert.equal(state.read().auditions[0].id,'lower');
  state.resetAuditions();assert.equal(state.invoke('auditionOff',[7,'lower']),false);
});

test('PWM snapshots inspect FIFO without consuming it or changing the scheduled timeline',()=>{
  const pwm=new PWM32XPlayback();pwm.write(0,9);pwm.write(1,1000);pwm.write(2,1500);pwm.scheduleWrites([{frame:10,register:3,value:2000}]);
  const before=pwm.chip.saveState(),snapshot=readPwmInspector(pwm);
  assert.deepEqual(snapshot.routing,{left:1,right:2});assert.equal(snapshot.cycle,1000);assert.equal(snapshot.queuedWrites,1);
  assert.deepEqual(snapshot.fifo.left,{empty:false,full:false});assert.deepEqual(snapshot.fifo.right,{empty:true,full:false});
  assert.equal(pwm.chip.leftFifo.length,1);assert.equal(pwm.frame,0);
  const a=pwm.generateStereo(30);pwm.chip.loadState(before);pwm.frame=0;
  // Inspecting is observational: queued writes still apply at the same frame.
  assert(a.left.every(Number.isFinite));pwm.dispose();
});

test('host inspector uses admin port independently of Worker client port and rejects disposed identities',async()=>{
  const {port1,port2}=new MessageChannel();let connected=true;const writes=[];
  const chip={write:value=>writes.push(value),reset(){}},state=new PsgInspectorState(chip);
  port1.on('message',data=>receiveChipInspector(data,port1,(action,method,args)=>action==='read'?state.read():state.invoke(method,args)));
  const inspector=createChipInspector({endpoints:()=>connected?[{id:'segapsg:shared',kind:'segapsg',label:'PSG',port:port2}]:[],decode:async()=>{throw new Error('unused');}});
  let changes=0;const unsubscribe=inspector.subscribe(()=>changes++);
  try {
    assert.equal(inspector.list()[0].id,'segapsg:shared');
    // This models an applied write arriving through a separate direct Worker command port.
    chip.write(0x85);chip.write(0x22);
    assert.equal((await inspector.read('segapsg:shared')).channels[0].period,549);
    await inspector.invoke('segapsg:shared','setAttenuation',[0,8]);
    assert.equal((await inspector.read('segapsg:shared')).channels[0].attenuation,8);
    await assert.rejects(inspector.invoke('segapsg:shared','dispose'),/Unsupported/);
    const count=writes.length;await inspector.read('segapsg:shared');assert.equal(writes.length,count);
    connected=false;inspector.notify();assert.equal(changes,1);assert.deepEqual(inspector.list(),[]);
    await assert.rejects(inspector.read('segapsg:shared'),/not connected/);
  } finally {unsubscribe();inspector.dispose();port1.close();port2.close();}
});

test('RF decoding does not send a sample to a replacement chip with the same stable ID',async()=>{
  const {port1,port2}=new MessageChannel(),replacement=new MessageChannel();let port=port2,finish;
  const inspector=createChipInspector({endpoints:()=>[{id:'rf5c164:shared',kind:'rf5c164',label:'PCM',port}],decode:()=>new Promise(resolve=>finish=resolve)});
  try {
    const pending=inspector.loadSample('rf5c164:shared',new ArrayBuffer(0));
    port=replacement.port2;finish({channels:[new Float32Array(2)],sampleRate:22050});
    await assert.rejects(pending,/changed while decoding/);
  } finally {inspector.dispose();port1.close();port2.close();replacement.port1.close();replacement.port2.close();}
});

test('inspector observers cannot interrupt lifecycle cleanup and all pending reads reject on disconnect',async t=>{
  const {port1,port2}=new MessageChannel();let connected=true;const warnings=[];
  t.mock.method(console,'error',(...args)=>warnings.push(args));
  const inspector=createChipInspector({endpoints:()=>connected?[{id:'psg',kind:'segapsg',port:port2}]:[],decode:async()=>{}});
  let later=0;inspector.subscribe(()=>{throw new Error('broken editor');});inspector.subscribe(()=>later++);
  try{
    assert.throws(()=>inspector.subscribe(null),/listener/);
    const read=inspector.read('psg');
    const rejected=assert.rejects(read,/disconnected/);
    connected=false;assert.doesNotThrow(()=>inspector.notify());await rejected;
    assert.equal(later,1);assert.equal(warnings.length,1);
    assert.equal(port2.listenerCount('message'),0);
  }finally{inspector.dispose();port1.close();port2.close();}
});

test('RF invalid ranges and huge material fail before sending writes, options remain captured during decode',async()=>{
  const {port1,port2}=new MessageChannel();let decoding=0,finish;const requests=[];
  port1.on('message',data=>{requests.push(data);port1.postMessage({type:'chip-inspector-result',id:data.id,value:{address:data.args[2].address,name:data.args[1].name}});});
  const inspector=createChipInspector({endpoints:()=>[{id:'rf',kind:'rf5c164',port:port2}],decode:()=>{decoding++;return new Promise(resolve=>finish=resolve);}});
  try{
    await assert.rejects(inspector.loadSample('rf',new ArrayBuffer(0),{address:1}),/aligned/);
    await assert.rejects(inspector.loadSample('rf',new ArrayBuffer(0),{loopStart:Infinity}),/loop/);
    assert.equal(decoding,0);assert.equal(requests.length,0);
    const giant=inspector.loadSample('rf',new ArrayBuffer(0));finish({channels:[new Float32Array(65534)],sampleRate:44100});
    await assert.rejects(giant,/64 KiB/);assert.equal(requests.length,0);
    const options={name:'original',address:256,loopStart:0};
    const normal=inspector.loadSample('rf',new ArrayBuffer(0),options);options.name='changed';options.address=512;
    finish({channels:[new Float32Array(2)],sampleRate:44100});
    assert.deepEqual(await normal,{address:256,name:'original'});assert.equal(requests.length,1);
  }finally{inspector.dispose();port1.close();port2.close();}
});

test('OKIM6258 file loading encodes at the applied rate after decoding and leaves playback settings alone',async()=>{
  const {port1,port2}=new MessageChannel();let finish,rate=15625;const requests=[];
  port1.on('message',data=>{
    requests.push(data);
    const value=data.action==='read'?{clock:8000000,playbackRate:rate}:data.args[1];
    port1.postMessage({type:'chip-inspector-result',id:data.id,value});
  });
  const inspector=createChipInspector({endpoints:()=>[{id:'oki',kind:'okim6258',port:port2}],decode:()=>new Promise(resolve=>finish=resolve)});
  try{
    const options={name:'voice.wav'},loading=inspector.loadSample('oki',new ArrayBuffer(0),options);
    options.name='changed.wav';rate=7812.5;
    finish({channels:[Float32Array.from({length:15625},(_,i)=>.4*Math.sin(2*Math.PI*440*i/15625))],sampleRate:15625});
    const sample=await loading;
    assert.deepEqual(requests.map(request=>request.action),['read','loadSample'],'loading does not write divider, pan or clock');
    assert.equal(sample.name,'voice.wav');assert.equal(sample.sampleRate,7812.5);
    assert.equal(sample.frames,7814);assert.equal(requests[1].args[0].length,3907);
    assert(sample.waveform.length>0&&sample.waveform.length<=512);
    assert(sample.waveform.every(value=>Number.isFinite(value)&&Math.abs(value)<=1));
  }finally{inspector.dispose();port1.close();port2.close();}
});

test('OKIM6258 invalid, aborted and disconnected file loads send no sample commands',async()=>{
  const {port1,port2}=new MessageChannel(),replacement=new MessageChannel();let port=port2,finish,decodes=0;const requests=[];
  port1.on('message',data=>requests.push(data));
  const inspector=createChipInspector({endpoints:()=>[{id:'oki',kind:'okim6258',port}],decode:()=>{decodes++;return new Promise(resolve=>finish=resolve);}});
  const pcm={channels:[Float32Array.of(0,.2,-.2,0)],sampleRate:15625};
  try{
    for(const options of [{sampleRate:NaN},{name:42},{address:0},{loopStart:0},{signal:{}}])await assert.rejects(inspector.loadSample('oki',pcm,options));
    const preAborted=new AbortController();preAborted.abort();await assert.rejects(inspector.loadSample('oki',pcm,{signal:preAborted.signal}),{name:'AbortError'});
    assert.equal(decodes,0);
    const controller=new AbortController(),cancelled=inspector.loadSample('oki',pcm,{signal:controller.signal});controller.abort();finish(pcm);
    await assert.rejects(cancelled,{name:'AbortError'});
    const retired=inspector.loadSample('oki',pcm);port=replacement.port2;finish(pcm);
    await assert.rejects(retired,/changed while decoding/);assert.deepEqual(requests,[]);
  }finally{inspector.dispose();port1.close();port2.close();replacement.port1.close();replacement.port2.close();}
});

test('OKIM6258 replacement during its rate read cannot receive the old file load',async()=>{
  const {port1,port2}=new MessageChannel(),replacement=new MessageChannel();let port=port2;const requests=[];
  port1.on('message',data=>{
    requests.push(data);port=replacement.port2;
    port1.postMessage({type:'chip-inspector-result',id:data.id,value:{clock:8000000,playbackRate:15625}});
  });
  const inspector=createChipInspector({endpoints:()=>[{id:'oki',kind:'okim6258',port}],decode:async()=>({channels:[Float32Array.of(0,.2,-.2,0)],sampleRate:15625})});
  try{
    await assert.rejects(inspector.loadSample('oki',new ArrayBuffer(0)),/changed while decoding/);
    assert.deepEqual(requests.map(request=>request.action),['read']);
  }finally{inspector.dispose();port1.close();port2.close();replacement.port1.close();replacement.port2.close();}
});
