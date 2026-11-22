import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280CodeClient} from './code_endpoint.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';

async function setup(rate=44100){
 let Processor,serial=0,generated=0;
 const messages=[],listeners=new Set(),saved=new Map(['sampleRate','AudioWorkletProcessor','registerProcessor'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const port={postMessage(data){messages.push(data);for(const fn of listeners)fn({data});},addEventListener(_name,fn){listeners.add(fn);},removeEventListener(_name,fn){listeners.delete(fn);},start(){}};
 globalThis.sampleRate=rate;globalThis.AudioWorkletProcessor=class{constructor(){this.port=port;}};globalThis.registerProcessor=(_name,Type)=>Processor=Type;
 await import(`./processor.js?timed-test=${rate}-${Math.random()}`);
 const processor=new Processor({processorOptions:{instanceId:'real-synth-test'}});await processor.ready;
 assert.equal(processor.dead,false,JSON.stringify(messages));
 const call=async(method,args=[])=>{const id=++serial;processor.receive({id,method,args});await processor.commands;const reply=messages.find(row=>row.id===id);assert(reply,`Missing ${method} ACK`);if(reply.error){const error=Error(reply.error);error.name=reply.name;throw error;}return reply.value;};
 const metadata=await call('beginCode');
 const client=createHuc6280CodeClient({metadata,port,isCurrent:()=>processor.codeOwner?.session===metadata.session,
  invoke:(method,args)=>call('code',[metadata.session,method,args]),
  requestControl:payload=>call('timed',[metadata.session,payload]),dispose:()=>call('code',[metadata.session,'dispose',[]])});
 const generate=processor.instrument.generateStereo.bind(processor.instrument);
 processor.instrument.generateStereo=count=>{generated+=count;return generate(count);};
 return {processor,client,call,messages,rate,generated:()=>generated,
  render(count,partition=128){const l=new Float32Array(count),r=new Float32Array(count);for(let offset=0;offset<count;){const n=Math.min(partition,count-offset);assert(processor.process([],[[l.subarray(offset,offset+n),r.subarray(offset,offset+n)]]));offset+=n;}assert(l.every(Number.isFinite));return l;},
  close(){processor.dispose();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}},
 };
}

for(const rate of [44100,48000])test(`actual Synth client/processor schedules register operations at ${rate} Hz`,async()=>{
 const p=await setup(rate);try{
 const writes=[],write=p.processor.instrument.synth.writeRegister.bind(p.processor.instrument.synth);
 p.processor.instrument.synth.writeRegister=(register,value)=>{writes.push({frame:p.generated(),register,value});return write(register,value);};
 const plan=p.client.build(b=>{b.setNote(0,'C4').keyOn(0);b.atSeconds(.005).setVolume(0,12);b.atSample(441).keyOff(0);});
 const before=p.processor.instrument.synth._getState(),snapshot=await p.client.captureState();
 const trace=await p.client.compile(plan),again=await p.client.compile(plan,{initialState:snapshot});assert.deepEqual(trace,again);assert.deepEqual(p.processor.instrument.synth._getState(),before);assert.equal(p.generated(),0);
 const receipt=await p.client.schedule(plan,{name:'phrase'});assert.equal(receipt.startFrame,128);
 const pcm=p.render(1000,37);assert(pcm.some(v=>v!==0));
 assert.deepEqual(writes,trace.map(({offsetSeconds,register,value})=>({frame:128+Math.round(offsetSeconds*rate),register,value})));
 assert.equal((await p.client.getState()).registers[0][4]&128,0);
 }finally{p.close();}
});

test('compile reset and reused snapshots use no RPC; missing client mirror and unsupported Synth operations reject',async()=>{
 const p=await setup();try{
 const plan=p.client.build(b=>b.setVolume(0,7)),snapshot=await p.client.captureState(),n=p.messages.length;
 const a=await p.client.compile(plan,{initialState:'reset'}),b=await p.client.compile(plan,{initialState:snapshot});assert(a.length&&b.length);assert.equal(p.messages.length,n);
 await assert.rejects(p.client.compile(plan,{initialState:'client'}),/Incomplete/);assert.equal(p.messages.length,n);
 const aliases=p.client.build(b=>b.noteOn(0,'C4'));await assert.rejects(p.client.schedule(aliases,{name:'bad'}),/setNote \+ keyOn/);await assert.rejects(p.client.compile(aliases,{initialState:'reset'}),/setNote \+ keyOn/);
 const ram=p.client.build(b=>b.writeRegister(6,12));await assert.rejects(p.client.schedule(ram,{name:'ram'}),/Wave RAM/);
 const dda=p.client.build(b=>b.setDda(0,true).writeDda(0,22));await p.client.schedule(dda,{name:'dac'});p.render(200);assert.equal((await p.client.getState()).registers[0][6],22);
 await p.call('stop');await assert.rejects(p.client.captureState(),{name:'AbortError'});
 }finally{p.close();}
});

test('timed edits coexist with Software Envelope; stale scheduled gates cannot release keyboard or immediate notes',async()=>{
 const p=await setup();try{
 await p.client.noteOn(0,'C4');const voice=p.processor.instrument.slots[0];assert(voice);
 await p.client.schedule(p.client.build(b=>b.setVolume(0,12)),{name:'level'});p.render(200);assert.equal(p.processor.instrument.slots[0],voice);assert.equal(voice.baseVolume,12);
 assert.equal(await p.client.noteOff(0),true);
 await p.client.schedule(p.client.build(b=>{b.keyOn(1);b.atSeconds(.01).keyOff(1);}),{name:'gate'});p.render(200);
 await p.client.noteOn(1,'E4');const immediate=p.processor.instrument.slots[1];p.render(600);assert.equal(p.processor.instrument.slots[1],immediate);assert((await p.client.getState()).registers[1][4]&128);
 await p.client.schedule(p.client.build(b=>{b.keyOn(2);b.atSeconds(.01).keyOff(2);}),{name:'manual'});p.render(200);
 await p.call('noteOn',['manual-key',60,2]);p.render(600);assert.equal(p.processor.instrument.gateOwners[2].owner,'keyboard');assert((await p.client.getState()).registers[2][4]&128);
 }finally{p.close();}
});

test('transactions remain silent until commit; Stop clears queued/staged work and fences stale sessions',async()=>{
 const p=await setup();try{
 const timed=p.client._timedOperations,plan=p.client.build(b=>b.keyOn(0));
 await timed.stage(1,'evaluation','schedule',[plan,{name:'held',repeatSeconds:.02}]);p.render(300);assert.equal((await p.client.getState()).registers[0][4]&128,0);
 await timed.commit(1,'evaluation');p.render(200);assert((await p.client.getState()).registers[0][4]&128);
 await timed.releaseOwner('evaluation');assert.equal((await p.client.getState()).registers[0][4]&128,0);
 await timed.stage(2,'next','schedule',[plan,{name:'pending'}]);
 const old=p.processor.codeOwner.session;await p.call('stop');p.render(1000);assert(p.processor.instrument.synth._getState().registers.slice(0,6).every(r=>!(r[4]&128)));
 await assert.rejects(p.call('timed',[old,{action:'commit',owner:'next',transactionId:2}]),{name:'AbortError'});
 }finally{p.close();}
});

test('real Code runtime commits Run/Apply, aborts a failed Apply, and Stop releases timed owners',async()=>{
 const p=await setup();
 let stopCalls=0;
 const runtime=createPlaygroundCodeRuntime({supportedSoundChips:['huc6280'],ensureReady:async()=>{},
  now:()=>p.processor.renderedFrames/p.rate,useSoundChip:async()=>p.client,
  stopSoundChips:async()=>{if(stopCalls++)await p.call('stop');},guardExecution:false,createTaskChannel:()=>null});
 const script=level=>`const pce=await useSoundChip('huc6280');await pce.schedule(pce.build(b=>b.setVolume(CH1,${level}).keyOn(CH1)),{name:'phrase',repeatSeconds:.02});`;
 try{
 await runtime.run(script(9));p.render(200);assert.equal((await p.client.getState()).registers[0][4],128|9);
 await assert.rejects(runtime.apply(script(21)+`throw Error('abort this Apply');`),/abort this Apply/);
 p.render(1200);assert.equal((await p.client.getState()).registers[0][4],128|9);
 await runtime.apply(script(17));p.render(200);assert.equal((await p.client.getState()).registers[0][4],128|17);
 await runtime.stop();await p.processor.commands;p.render(1500);assert.equal(p.processor.instrument.synth._getState().registers[0][4]&128,0);
 }finally{await runtime.stop();p.close();}
});

test('clearing a held HuC6280 pattern leaves a later keyboard gate on the same chip',async()=>{
 const p=await setup();try{
 const plan=p.client.build(b=>{b.setVolume(0,12).keyOn(0);b.setVolume(1,12).keyOn(1);b.atSeconds(.05).keyOff(0).keyOff(1);});
 await p.client.schedule(plan,{name:'held'});p.render(200);
 assert.equal((await p.client.getState()).registers[0][4]&128,128);
 await p.call('noteOn',['new-keyboard-owner',60,1]);
 assert.equal(await p.client.clearSchedule('held'),true);p.render(3000);
 const {registers}=await p.client.getState();
 assert.equal(registers[0][4]&128,0);
 assert.equal(registers[1][4]&128,128);
 assert.equal(p.processor.instrument.gateOwners[1].owner,'keyboard');
 }finally{p.close();}
});

test('invalid resets/preset loads retain reservations and their Code lease',async()=>{
 const p=await setup();try{
 await p.client.schedule(p.client.build(b=>b.setVolume(0,9).keyOn(0)),{name:'retained',repeatSeconds:.02});
 const session=p.processor.codeOwner.session;
 await assert.rejects(p.call('code',[session,'reset',[1]]));
 await assert.rejects(p.call('loadPreset',[{format:'invalid'}]));
 p.render(200);assert.equal(p.processor.instrument.synth._getState().registers[0][4],128|9);assert.equal(p.processor.codeOwner.session,session);
 }finally{p.close();}
});

test('liveLoop replacement retires its hardware gate without releasing a newer manual owner',async()=>{
 const p=await setup();const runtime=createPlaygroundCodeRuntime({supportedSoundChips:['huc6280'],ensureReady:async()=>{},
  now:()=>p.processor.renderedFrames/p.rate,useSoundChip:async()=>p.client,stopSoundChips:async()=>{},guardExecution:false,createTaskChannel:()=>null});
 const code=`const pce=await useSoundChip('huc6280');liveLoop('pulse',async()=>{await pce.schedule(pce.build(b=>b.keyOn(CH1)),{name:'loop-note',repeatSeconds:.02});await beat(100);});`;
 try{
 await runtime.run(code);
 for(let n=0;n<100&&p.processor.performance.getStats().patternCount===0;n++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(p.processor.performance.getStats().patternCount,1);p.render(200);assert(p.processor.instrument.synth._getState().registers[0][4]&128);
 await p.call('noteOn',['keyboard',60,0]);
 await runtime.apply(`stopLoop('pulse');`);await new Promise(resolve=>setImmediate(resolve));await p.processor.commands;
 assert.equal(p.processor.performance.getStats().patternCount,0);p.render(1200);assert.equal(p.processor.instrument.gateOwners[0]?.owner,'keyboard');assert(p.processor.instrument.synth._getState().registers[0][4]&128);
 }finally{await runtime.stop();p.close();}
});
