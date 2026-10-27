import test from 'node:test';
import assert from 'node:assert/strict';
import {createPokeyFixture,peak} from '../test/helpers/pokey_worklet_fixture.mjs';

test('POKEY inspector exposes four real applied voices without reading or advancing the sound core',async()=>{
  const p=await createPokeyFixture();
  try{
    p.client.setVolume(2,11);p.client.setDistortion(2,6);p.client.setNote(2,'E3');p.client.keyOn(2);p.client.keyOff(2);const state=p.read();
    assert.equal(state.kind,'pokey');assert.equal(state.channels.length,4);assert.equal(state.keyboardChannels.length,4);assert.equal(state.channels[2].configuredVolume,11);assert.equal(state.channels[2].volume,0);assert.equal(state.channels[2].distortion,6);assert(Math.abs(state.channels[2].frequency-164.81)<1);
    let writes=0,reads=0,renders=0;const chip=p.processor.chip,write=chip.writeRegister.bind(chip),read=chip.readRegister.bind(chip),render=chip.generateStereoView.bind(chip);
    chip.writeRegister=(...args)=>{writes++;return write(...args);};chip.readRegister=(...args)=>{reads++;return read(...args);};chip.generateStereoView=(...args)=>{renders++;return render(...args);};
    assert.deepEqual(p.read(),state);for(const args of [[0,0],[4,440],[0,NaN]])assert.throws(()=>p.invoke('setFrequency',args));assert.throws(()=>p.invoke('setVolume',[0,16]));assert.throws(()=>p.invoke('setHighClock',[1,true]));assert.deepEqual(p.read(),state);assert.equal(writes,0);assert.equal(reads,0);assert.equal(renders,0);
  }finally{p.close();}
});

for(const rate of [44100,48000])test(`POKEY dedicated ${rate}Hz renders centered A4 at unity and releases to exact zero`,async()=>{
  const p=await createPokeyFixture({rate});
  try{
    p.invoke('auditionOn',[0,69,'a4']);p.render(rate/4);const [left,right]=p.render(rate);assert.deepEqual(left,right);assert(peak(left)>.08);assert(left.some(value=>value<0)&&left.some(value=>value>0));
    const mean=left.reduce((sum,value)=>sum+value,0)/left.length;assert(Math.abs(mean)<.001);let rises=0;for(let i=1;i<left.length;i++)if(left[i-1]<0&&left[i]>=0)rises++;assert(Math.abs(rises-p.read().channels[0].frequency)<2);
    p.invoke('auditionOff',[0,'a4']);assert.equal(peak(p.render(128)[0]),0);assert.equal(p.read().channels[0].configuredVolume,8);assert.equal(p.invoke('auditionOff',[0,'a4']),false);
  }finally{p.close();}
});

test('POKEY dual dedicated processors own independent state, filters, resets and lifetimes',async()=>{
  const a=await createPokeyFixture({clock:1789773}),b=await createPokeyFixture({clock:1789773});
  try{
    a.client.noteOn(0,'C4');b.client.noteOn(3,'A4');assert(peak(a.render(1024)[0])>.01);assert(peak(b.render(1024)[0])>.01);
    await a.client.setChannelMuted(0,true);assert.equal(peak(a.render(128)[0]),0);assert(peak(b.render(128)[0])>.01);a.client.reset();assert(b.read().channels[3].active);a.close();assert(peak(b.render(128)[0])>.01);assert.equal(b.read().clock,1789773);
  }finally{a.close();b.close();}
});

for(const route of ['Main','Worker'])test(`POKEY ${route} manual lease protects selected voice while sibling script playback continues`,async()=>{
  const p=await createPokeyFixture();
  try{
    p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[0,69,'manual']);const held=p.read().channels[0];
    const commands=[{method:'writeRegister',args:[0,0]},{method:'writeRegister',args:[1,0]},{method:'writeRegister',args:[2,48]},{method:'writeRegister',args:[3,0xa6]},{method:'writeRegister',args:[8,0x50]}];
    if(route==='Main')commands.forEach(command=>p.receive(command));else p.receive({performance:{session:1,owner:'script',time:.001},commands});p.render(1024);
    const state=p.read();assert.equal(state.channels[0].period,held.period);assert.equal(state.channels[0].volume,held.volume);assert.equal(state.registers[8],0);assert(state.channels[1].active);
    p.invoke('setVolume',[0,10]);assert.equal(p.read().channels[0].volume,10);p.invoke('auditionOff',[0,'manual']);assert(!p.read().channels[0].active);assert(p.read().channels[1].active);
  }finally{p.close();}
});

test('POKEY joined high-clock audition protects its helper while the other pair plays',async()=>{
  const p=await createPokeyFixture();
  try{
    p.invoke('setJoined',[0,true]);p.invoke('setHighClock',[0,true]);p.invoke('auditionOn',[1,69,'joined']);const before=p.read();assert(before.channels[0].helper);assert(before.channels[1].joined);assert(before.channels[1].highClock);
    for(const command of [{method:'writeRegister',args:[0,0]},{method:'writeRegister',args:[2,0]},{method:'writeRegister',args:[8,0]}])p.receive(command);
    assert.deepEqual(p.read().registers,before.registers);p.client.noteOn(2,'E3');assert(p.read().channels[2].active);assert(peak(p.render(4096)[0])>.01);p.invoke('setFrequency',[1,523.25]);assert(Math.abs(p.read().channels[1].frequency-523.25)<.2);p.invoke('auditionOff',[1,'joined']);assert(p.read().channels[2].active);
  }finally{p.close();}
});

test('POKEY Stop cancels future reservations and manual auditions while preserving the instrument',async()=>{
  const p=await createPokeyFixture();
  try{
    p.client.setDistortion(2,6);p.client.setVolume(2,11);p.client.noteOn(2,'E3');p.invoke('auditionOn',[0,69,'manual']);p.render(1024);const before=p.read();
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:4},commands:[{method:'writeRegister',args:[1,0xaf]}]});assert.equal(p.processor.performance.getStats().queuedCommands,1);
    await p.client._stopVoices();assert.equal(p.processor.performance.getStats().queuedCommands,0);assert(p.read().channels.every(channel=>!channel.active));assert.equal(p.invoke('auditionOff',[0,'manual']),false);assert.equal(peak(p.render(128)[0]),0);
    assert.equal(p.read().channels[2].distortion,before.channels[2].distortion);assert.equal(p.read().channels[2].configuredVolume,before.channels[2].configuredVolume);p.client.keyOn(2);assert(peak(p.render(4096)[0])>.01);
  }finally{p.close();}
});

test('POKEY inspector parameter edits preserve the script note owner and invalid auditions preserve held keys',async()=>{
  const p=await createPokeyFixture();
  try{
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'lead',time:0},commands:[{method:'writeRegister',args:[5,0xa8]}]});p.render();assert(p.read().channels[2].active);
    p.invoke('setVolume',[2,11]);p.invoke('setDistortion',[2,6]);p.receive({type:'performance-cancel-owner',session:1,owner:'lead'});assert.equal(p.read().channels[2].volume,0,'UI parameter edit does not become a replacement note owner');
    p.invoke('auditionOn',[0,69,'held']);const before=p.read();for(const args of [[0,-1,'bad'],[0,0,'out-of-range'],[0,69,''],[4,69,'bad']])assert.throws(()=>p.invoke('auditionOn',args));assert.deepEqual(p.read(),before);p.invoke('auditionOff',[0,'held']);
  }finally{p.close();}
});

test('POKEY stale performance Stop cannot silence a newer manual key; current Stop clears reservations',async()=>{
  const p=await createPokeyFixture();
  try{
    p.receive({type:'performance-start',session:2});p.invoke('auditionOn',[1,69,'manual']);p.receive({type:'performance-stop',session:1});assert(p.read().channels[1].active);p.receive({performance:{session:2,owner:'future',time:1},commands:[{method:'writeRegister',args:[1,0xaf]}]});assert.equal(p.processor.performance.getStats().queuedCommands,1);p.receive({type:'performance-stop',session:2});assert(p.read().channels.every(channel=>!channel.active));assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(peak(p.render(128)[0]),0);
  }finally{p.close();}
});

test('POKEY rendering partitions preserve PCM and warmed Worklet uses borrowed buffers without new views',async()=>{
  const a=await createPokeyFixture(),b=await createPokeyFixture();
  try{
    for(const p of [a,b]){p.client.noteOn(0,'C4');p.client.noteOn(2,'E3');}
    const expected=a.render(4096),actual=[new Float32Array(4096),new Float32Array(4096)];let offset=0;for(const count of [1,3,17,127,512,1024,2412]){const part=b.render(count);actual[0].set(part[0],offset);actual[1].set(part[1],offset);offset+=count;}assert.deepEqual(actual,expected);
    a.render();const chip=a.processor.chip,generate=chip.generateStereoView.bind(chip),view=generate(128),output=[new Float32Array(128),new Float32Array(128)],subarray=Float32Array.prototype.subarray;let calls=0;
    chip.generateStereo=()=>{throw new Error('Worklet must not allocate owned PCM');};chip.generateStereoView=count=>{calls++;const pcm=generate(count);assert.equal(pcm,view);return pcm;};
    try{Float32Array.prototype.subarray=()=>{throw new Error('Warmed render must reuse cached prefix views');};for(let i=0;i<64;i++)a.processor.process([],[output]);}finally{Float32Array.prototype.subarray=subarray;chip.generateStereoView=generate;}assert.equal(calls,64);
    a.receive({method:'reset'});assert.equal(peak(a.render(128)[0]),0);assert(a.read().channels.every(channel=>!channel.active));a.client.initialize();a.client.noteOn(0,'A4');assert(peak(a.render(1024)[0])>.01);
  }finally{a.close();b.close();}
});

test('POKEY future clock requests reject before acceptance and never mutate the fixed author clock',async()=>{
  const p=await createPokeyFixture();
  try{
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'clock',time:2},commands:[{method:'clock',args:[2000000],id:'clock'}]});
    const reply=p.messages.find(message=>message.id==='clock');assert.match(reply.error,/new POKEY|clock/);assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.read().clock,1789790);
  }finally{p.close();}
});

test('POKEY detached or replaced ports cannot restart stopped voices after handoff',async()=>{
  const p=await createPokeyFixture();
  try{
    const remote=()=>({closed:false,started:false,start(){this.started=true;},close(){this.closed=true;},postMessage(){}}),a=remote(),b=remote(),wa=remote(),wb=remote();
    p.processor.port.onmessage({data:{port:a}});assert(a.started);a.onmessage({data:{method:'writeRegister',args:[1,0xa8]}});assert(p.read().channels[0].active);
    p.processor.port.onmessage({data:{port:b}});assert(a.closed);a.onmessage({data:{method:'writeRegister',args:[1,0xaf]}});assert.notEqual(p.read().channels[0].volume,15);
    p.processor.port.onmessage({data:{primaryWorker:true,port:wa}});p.processor.port.onmessage({data:{primaryWorker:true,port:wb}});assert(wa.closed);wa.onmessage({data:{method:'writeRegister',args:[1,0xaf]}});assert.notEqual(p.read().channels[0].volume,15);
    b.onmessage({data:{method:'writeRegister',args:[1,0xa8]}});assert(peak(p.render(1024)[0])>.01);p.processor.port.onmessage({data:{type:'detach-chip-port'}});assert(b.closed);assert.equal(peak(p.render(128)[0]),0);p.close();assert(wb.closed);assert.equal(p.processor.process([],[[new Float32Array(128),new Float32Array(128)]]),false);
  }finally{p.close();}
});
