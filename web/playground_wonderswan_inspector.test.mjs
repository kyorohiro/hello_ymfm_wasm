import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {WonderSwan,WONDERSWAN_CLOCK} from './wonderswan.js';
import factory from '../docs/generated/wonderswan_wasm.js';
import {WonderSwanVoiceInspector} from './playground_wonderswan_inspector.js';
import {ChipClockResampler,validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {createWonderSwanClient} from './playground_wonderswan.js';

const peak=values=>values.reduce((a,v)=>Math.max(a,Math.abs(v)),0),mean=values=>values.reduce((a,v)=>a+v,0)/values.length;
const triangle=Array.from({length:32},(_,i)=>i<16?i:31-i);
async function setup({rate=48000,clock=WONDERSWAN_CLOCK}={}){
  let Processor,frame=0,resolveReady;const messages=[],ready=new Promise(resolve=>resolveReady=resolve),port={postMessage:data=>{messages.push(data);if(data.ready||data.error)resolveReady(data);}};
  const source=(await readFile(new URL('./playground_wonderswan_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{WonderSwan,WONDERSWAN_CLOCK,factory,WonderSwanVoiceInspector,ChipClockResampler,validateChipClock,receiveChipInspector,sampleRate:rate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Processor=Value});
  const processor=new Processor({processorOptions:{clock,wasmBinary:await readFile(new URL('../docs/generated/wonderswan_wasm.wasm',import.meta.url))}});assert.equal((await ready).ready,true,JSON.stringify(messages));
  const clientPort={start(){},close(){},postMessage:data=>processor.receive(data,{postMessage:reply=>clientPort.onmessage?.({data:reply})})},client=createWonderSwanClient(clientPort,{clock});client.initialize();
  return {processor,client,clientPort,messages,port,rate,receive(data){processor.receive(data,port);},
    read(){processor.receive({type:'chip-inspector',id:'read',action:'read'},port);const reply=messages.at(-1);if(reply.error)throw new Error(reply.error);return reply.value;},
    invoke(method,args=[]){processor.receive({type:'chip-inspector',id:'invoke',action:'invoke',method,args},port);const reply=[...messages].reverse().find(message=>message.type==='chip-inspector-result'&&message.id==='invoke');if(reply.error)throw new Error(reply.error);return reply.value;},
    render(frames=128){const output=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[output]);frame+=frames;return output;},dispose(){processor.dispose();}};
}

test('WonderSwan inspector exposes four applied waveforms and edits validate atomically without core reads/rendering',async()=>{
  const p=await setup();try{
    assert.equal(p.read().kind,'wonderswan');assert.equal(p.read().outputEnabled,true);assert(p.read().channels.every(ch=>!ch.active));
    for(let ch=0;ch<4;ch++){
      p.invoke('setVoice',[ch,{pan:{left:13,right:ch},frequency:440,waveform:triangle}]);let state=p.read().channels[ch];assert.deepEqual(state.pan,{left:13,right:ch});assert(Math.abs(state.frequency-440)<1);assert.deepEqual(state.waveform,triangle);assert.equal(state.waveformKnown,true);
      p.invoke('setVoice',[ch,{frequencyRegister:1537}]);state=p.read().channels[ch];assert.equal(state.frequencyRegister,1537);assert.equal(state.period,511);
      let writes=0,reads=0,renders=0;const chip=p.processor.chip,write=chip.writeRegister.bind(chip),read=chip.readRegister.bind(chip),render=chip.generateStereoView.bind(chip);chip.writeRegister=(...args)=>{writes++;return write(...args);};chip.readRegister=(...args)=>{reads++;return read(...args);};chip.generateStereoView=(...args)=>{renders++;return render(...args);};
      const before=p.read();assert.throws(()=>p.invoke('setVoice',[ch,{pan:{left:7},waveform:Array(32).fill(16)}]),/sample/);assert.deepEqual(p.read(),before);assert.equal(writes,0);assert.equal(reads,0);assert.equal(renders,0);chip.writeRegister=write;chip.readRegister=read;chip.generateStereoView=render;
    }
    p.invoke('setSweep',[{step:-7,time:11,enabled:true}]);p.invoke('setSweep',[{time:8}]);assert.deepEqual(p.read().sweep,{step:-7,time:8,enabled:true});
    p.invoke('setNoise',[{type:5,enabled:true,reset:true}]);p.invoke('setNoise',[{type:2}]);assert.deepEqual(p.read().noise,{type:2,enabled:true});assert.equal(p.read().registers[14]&8,0,'noise reset is a strobe');
  }finally{p.dispose();}
});

for(const rate of [44100,48000])test(`WonderSwan ${rate}Hz speaker centers DAC without changing gain, stereo or A4 pitch`,async()=>{
  const p=await setup({rate});try{
    p.invoke('setVoice',[0,{frequency:440,pan:{left:12,right:6},waveform:triangle}]);p.invoke('auditionOn',[0,69,'a4']);p.render(2048);const [left,right]=p.render(rate),hz=p.read().channels[0].frequency;
    assert(peak(left)>.08&&peak(left)<.09);assert(peak(right)>.04&&peak(right)<.045);for(let i=0;i<left.length;i++)assert.equal(left[i],right[i]*2);
    assert(Math.abs(mean(left))<.0005);let rises=0;for(let i=1;i<left.length;i++)if(left[i-1]<0&&left[i]>=0)rises++;assert(Math.abs(rises-hz)<2);
    p.invoke('auditionOff',[0,'a4']);assert.equal(peak(p.render(rate)[0]),0);
    const raw=await WonderSwan.create({moduleFactory:factory,moduleOptions:{wasmBinary:await readFile(new URL('../docs/generated/wonderswan_wasm.wasm',import.meta.url))},sampleRate:rate});try{for(let i=0;i<16;i++)raw.writeMemory(i,triangle[i*2]|triangle[i*2+1]<<4);const value=2048-Math.round(WONDERSWAN_CLOCK/(32*440));raw.writeRegister(0x80,value&255);raw.writeRegister(0x81,value>>8);raw.writeRegister(0x88,0xc6);raw.writeRegister(0x91,8);raw.writeRegister(0x90,1);const pcm=raw.generateStereo(rate);assert(pcm.left.every(v=>v>=0));assert(mean(pcm.left)>.08,'low-level PCM remains unipolar');}finally{raw.dispose();}
  }finally{p.dispose();}
});

test('WonderSwan low-clock Stop clears held samples immediately and preserves RAM, voices and modes',async()=>{
  const p=await setup();try{
    p.invoke('setNoise',[{type:3,enabled:true}]);p.invoke('setSweep',[{enabled:true,step:2,time:5}]);await p.client.setClock(100000);p.invoke('auditionOn',[0,69,'held']);p.render();const before=p.read();assert(peak(p.render()[0])>0);
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:4},commands:[{method:'writeRegister',args:[0x90,15]}]});
    await p.client._stopVoices();const after=p.read();assert(after.channels.every(ch=>!ch.active));assert.deepEqual(after.channels.map(ch=>({...ch,active:false,enabled:false})),before.channels.map(ch=>({...ch,active:false,enabled:false})));assert.deepEqual(after.noise,before.noise);assert.deepEqual(after.sweep,before.sweep);assert.equal(after.clock,100000);assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[0,'held']),false);
    for(let i=0;i<256;i++)assert.equal(peak(p.render(1)[0]),0);
    p.invoke('auditionOn',[0,69,'next']);assert(peak(p.render(4096)[0])>0);p.receive({type:'performance-stop',session:0});assert(p.read().channels[0].active,'stale Stop cannot retire a newer audition');
  }finally{p.dispose();}
});

test('WonderSwan reset and fixed quantum rendering reuse borrowed views and stay partition independent',async()=>{
  const a=await setup(),b=await setup();try{
    for(const p of [a,b]){p.client.noteOn(0,69);p.client.noteOn(2,64);}
    const expected=a.render(4096),left=[],right=[];for(const count of [1,3,17,127,512,1024,2412]){const pcm=b.render(count);left.push(...pcm[0]);right.push(...pcm[1]);}assert.deepEqual(Float32Array.from(left),expected[0]);assert.deepEqual(Float32Array.from(right),expected[1]);
    a.render();const view=a.processor.chip.generateStereoView(128),l=view.left,r=view.right;for(let i=0;i<32;i++){const pcm=a.processor.chip.generateStereoView(128);assert.equal(pcm,view);assert.equal(pcm.left,l);assert.equal(pcm.right,r);}a.receive({method:'reset'});assert.equal(a.read().outputEnabled,false);assert(a.read().channels.every(ch=>!ch.active&&ch.waveform.every(v=>v===0)));assert.equal(peak(a.render()[0]),0);a.client.initialize();a.client.noteOn(0,69);assert(peak(a.render(1024)[0])>0);
  }finally{a.dispose();b.dispose();}
});

test('WonderSwan voice mode is centered unsigned PCM and cannot masquerade as a pitched keyboard voice',async()=>{
  const p=await setup();try{
    p.client.setVoiceMode(true);p.client.writeVoice(128);p.client.keyOn(1);p.render(256);const state=p.read();assert.equal(state.channels[1].type,'pcm');assert.throws(()=>p.invoke('auditionOn',[1,69,'pcm']),/PCM/);assert(peak(p.render()[0])<.001);
    p.client.writeVoice(255);assert(peak(p.render()[0])>.1);p.client.allNotesOff();assert.equal(peak(p.render()[0]),0);
    p.invoke('setVoiceMode',[false]);p.invoke('setVoice',[1,{pan:{left:9,right:0}}]);p.invoke('auditionOn',[1,69,'wave']);const pcm=p.render(4800);assert(peak(pcm[0])>.03);assert.equal(peak(pcm[1]),0);
  }finally{p.dispose();}
});

test('WonderSwan read snapshots do not publish full RAM, while UI edits publish authored gates without temporary auditions',async()=>{
  const p=await setup();try{
    const before=p.messages.filter(m=>m.type==='wonderswan-state').length;p.read();assert.equal(p.messages.filter(m=>m.type==='wonderswan-state').length,before);
    p.client.keyOn(2);p.invoke('auditionOn',[0,69,'manual']);p.client.keyOn(1);assert.equal(p.messages.filter(m=>m.type==='wonderswan-state').length,before);p.invoke('setVoice',[0,{pan:{left:11}}]);let event=p.messages.findLast(m=>m.type==='wonderswan-state');assert.equal(event.state.memory.length,16384);assert.equal(event.state.registers[16]&15,6);assert.equal(p.read().registers[16]&15,7);
    p.receive({method:'writeRegister',args:[0x90,8]});p.invoke('setVoice',[0,{pan:{right:8}}]);event=p.messages.findLast(m=>m.type==='wonderswan-state');assert.equal(event.state.registers[16]&15,8,'raw author mask excludes the protected temporary gate');assert.equal(p.read().registers[16]&15,9);
    p.invoke('auditionOff',[0,'manual']);assert.equal(p.read().registers[16]&15,8);
  }finally{p.dispose();}
});

for(const route of ['Main','Worker'])test(`WonderSwan ${route}: applied gates have per-channel ownership; UI editing and manual leases preserve it`,async()=>{
  const p=await setup();try{
    p.receive({type:'performance-start',session:1});const send=(owner,commands,time=0)=>p.receive({performance:{session:1,owner,time},commands});
    send('code',[{method:'writeRegister',args:[0x90,1],channel:0,controlMask:1}]);p.render();assert(p.read().channels[0].active);p.invoke('setVoice',[0,{pan:{left:10},waveform:triangle}]);
    p.receive({type:'performance-cancel-owner',session:1,owner:'code'});p.render();assert.equal(p.read().channels[0].active,false);
    p.invoke('auditionOn',[0,69,'manual']);const old=p.read().channels[0];const commands=[{method:'writeRegister',args:[0x80,0],channel:0},{method:'writeRegister',args:[0x90,2],controlMask:15},{method:'writeRegister',args:[0x89,0xf3],channel:1}];
    if(route==='Main')commands.forEach(command=>p.receive(command));else send('other',commands,.01);p.render(1024);const state=p.read();assert(state.channels[0].active);assert.equal(state.channels[0].frequencyRegister,old.frequencyRegister);assert(state.channels[1].active);assert.deepEqual(state.channels[1].pan,{left:15,right:3});
    await assert.rejects(p.client.setClock(4000000),/held/);p.invoke('setWaveform',[0,triangle.map(v=>15-v)]);assert(p.read().channels[0].active);p.invoke('auditionOff',[0,'manual']);assert(!p.read().channels[0].active);assert(p.read().channels[1].active);
  }finally{p.dispose();}
});

test('WonderSwan stale control snapshots merge only targeted gate/mode fields',async()=>{
  const p=await setup();try{
    p.receive({method:'writeRegister',args:[0x90,128],channel:3,controlMask:128});p.receive({method:'writeRegister',args:[0x90,1],channel:0,controlMask:1});assert.equal(p.read().registers[16],129);
    p.receive({method:'writeRegister',args:[0x90,64],channel:2,controlMask:64});p.receive({method:'writeRegister',args:[0x90,2],channel:1,controlMask:2});assert.equal(p.read().registers[16],195);
    p.receive({method:'writeRegister',args:[0x90,0],channel:0,controlMask:1});assert.equal(p.read().registers[16],194);
  }finally{p.dispose();}
});

test('WonderSwan warmed render quanta reuse the same WASM PCM views and resampler storage',async()=>{
  const p=await setup();try{
    p.client.noteOn(0,69);p.render();const chip=p.processor.chip,generate=chip.generateStereoView.bind(chip),first=generate(128),buffer=first.left.buffer,counts=p.processor.resampler.counts;let calls=0;
    chip.generateStereoView=frames=>{calls++;const pcm=generate(frames);assert.equal(frames,128);assert.equal(pcm,first);assert.equal(pcm.left.buffer,buffer);return pcm;};
    for(let i=0;i<128;i++)p.render();assert.equal(calls,128);assert.equal(p.processor.resampler.counts,counts);
  }finally{p.dispose();}
});

test('WonderSwan detached or replaced Main and Worker ports cannot resurrect stopped voices',async()=>{
  const p=await setup();try{
    const remote=()=>({closed:false,started:false,start(){this.started=true;},close(){this.closed=true;},postMessage(){}}),a=remote(),b=remote(),workerA=remote(),workerB=remote();
    p.processor.port.onmessage({data:{port:a}});assert(a.started);a.onmessage({data:{method:'writeRegister',args:[0x90,1],channel:0,controlMask:1}});assert(p.read().channels[0].active);
    p.processor.port.onmessage({data:{port:b}});assert(a.closed);assert.equal(p.read().channels[0].active,false);a.onmessage({data:{method:'writeRegister',args:[0x90,1]}});assert.equal(p.read().channels[0].active,false);
    p.processor.port.onmessage({data:{primaryWorker:true,port:workerA}});p.processor.port.onmessage({data:{primaryWorker:true,port:workerB}});assert(workerA.closed);workerA.onmessage({data:{method:'writeRegister',args:[0x90,1]}});assert.equal(p.read().channels[0].active,false);
    b.onmessage({data:{method:'writeRegister',args:[0x90,1]}});p.render();assert(peak(p.render()[0])>0);p.processor.port.onmessage({data:{type:'detach-chip-port'}});assert(b.closed);assert.equal(peak(p.render()[0]),0);
    p.dispose();assert(workerB.closed);assert.equal(p.processor.process([],[[new Float32Array(128),new Float32Array(128)]]),false);
  }finally{p.dispose();}
});

test('WonderSwan reserved clock RPC rejects a held audition before acknowledging acceptance',async()=>{
  const p=await setup();try{
    p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[0,69,'held']);
    p.receive({performance:{session:1,owner:'code',time:.02},commands:[{method:'clock',args:[4000000],id:'held-clock'}]});
    const reply=p.messages.find(message=>message.id==='held-clock');assert.match(reply.error,/held/);assert.equal(p.read().clock,WONDERSWAN_CLOCK);assert.equal(p.processor.performance.getStats().queuedCommands,0);
    p.invoke('auditionOff',[0,'held']);p.receive({performance:{session:1,owner:'code',time:.02},commands:[{method:'clock',args:[4000000],id:'accepted-clock'}]});assert(p.messages.some(message=>message.id==='accepted-clock'&&!message.error));assert.equal(p.read().clock,WONDERSWAN_CLOCK);p.render(1024);assert.equal(p.read().clock,4000000);
    p.receive({performance:{session:1,owner:'code',time:.04},commands:[{method:'clock',args:[1],id:'invalid-clock'}]});assert.match(p.messages.find(message=>message.id==='invalid-clock').error,/clock/);assert.equal(p.read().clock,4000000);
  }finally{p.dispose();}
});

test('WonderSwan an accepted future clock reservation fences new manual auditions until applied or cancelled',async()=>{
  const p=await setup();try{
    p.client.keyOn(2);p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'clock',time:.02},commands:[{method:'clock',args:[4000000],id:'clock-accepted'}]});assert(p.messages.some(message=>message.id==='clock-accepted'&&!message.error));
    const before=p.read();assert.throws(()=>p.invoke('auditionOn',[0,69,'too-early']),/scheduled/);assert.deepEqual(p.read(),before);assert.equal(p.processor.inspector.auditions.size,0);assert.equal(p.processor.pendingClocks.size,1);
    p.render(1024);assert.equal(p.read().clock,4000000);assert.equal(p.processor.pendingClocks.size,0);p.invoke('auditionOn',[0,69,'after-clock']);assert(p.read().channels[0].active);p.invoke('auditionOff',[0,'after-clock']);
    p.receive({performance:{session:1,owner:'cancel-clock',time:2},commands:[{method:'clock',args:[5000000],id:'clock-cancel'}]});assert.equal(p.processor.pendingClocks.size,1);p.receive({type:'performance-cancel-owner',session:1,owner:'cancel-clock'});assert.equal(p.processor.pendingClocks.size,0);assert.equal(p.read().clock,4000000);p.invoke('auditionOn',[0,69,'after-cancel']);assert(p.read().channels[0].active);p.invoke('auditionOff',[0,'after-cancel']);
    p.receive({performance:{session:1,owner:'stop-clock',time:2},commands:[{method:'clock',args:[6000000]}]});assert.equal(p.processor.pendingClocks.size,1);await p.client._stopVoices();assert.equal(p.processor.pendingClocks.size,0);p.invoke('auditionOn',[0,69,'after-stop']);assert(p.read().channels[0].active);
  }finally{p.dispose();}
});
