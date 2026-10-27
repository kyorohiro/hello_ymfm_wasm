import test from 'node:test';
import assert from 'node:assert/strict';
import {createPokeyFixture,peak} from '../test/helpers/pokey_worklet_fixture.mjs';
import {PokeyVoiceInspector} from './playground_pokey_inspector.js';

test('POKEY inspector describes applied timer bytes, both joins and high clocks without treating helpers as pitched voices',()=>{
  const inspector=new PokeyVoiceInspector();
  for(const [register,value]of [[0,0x34],[1,0xa8],[2,0x12],[3,0xa8],[4,0x78],[5,0xa8],[6,0x56],[7,0xa8],[8,0xf9],[15,3]])inspector.observeWrite(register,value);
  const state=inspector.read();assert.equal(state.audctl,0xf9);assert.equal(state.skctl,3);assert.equal(state.baseClock,'15khz');assert.equal(state.baseDivider,114);assert.equal(state.poly9,true);assert.equal(state.running,true);
  for(const [lower,period]of [[0,0x1234],[2,0x5678]]){
    const helper=state.channels[lower],voice=state.channels[lower+1];
    assert.equal(helper.period,helper.audf);assert.equal(helper.type,'Joined timer helper');assert.equal(helper.toneFrequency,null);assert.equal(helper.helper,true);
    assert.equal(voice.period,period);assert.equal(voice.type,'Tone');assert.equal(voice.divisor,1);assert.equal(voice.offset,7);assert.equal(voice.highClock,true);assert.equal(voice.toneFrequency,1789790/(2*(period+7)));assert.equal(voice.timerHz,voice.frequency);
  }
  inspector.observeWrite(8,0x60);const separate=inspector.read();
  for(const ch of [0,2]){assert.equal(separate.channels[ch].highClock,true);assert.equal(separate.channels[ch].divisor,1);assert.equal(separate.channels[ch].offset,4);}
  for(const ch of [1,3]){assert.equal(separate.channels[ch].highClock,false);assert.equal(separate.channels[ch].divisor,28);assert.equal(separate.channels[ch].offset,1);}
  state.registers.fill(255);state.channels[0].audf=255;assert.equal(inspector.read().channels[0].audf,0x34,'view snapshots never become writeback');
});

test('POKEY inspector labels polynomial, DAC, filtered, stopped and SKCTL modes instead of inferring their notes',()=>{
  const inspector=new PokeyVoiceInspector();inspector.observeWrite(15,3);inspector.observeWrite(0,71);
  const modes=['Noise (Poly5 → Poly17)','Poly5-gated tone','Noise (Poly5 → Poly4)','Poly5-gated tone','Noise (Poly17)','Tone','Noise (Poly4)','Tone'];
  for(let distortion=0;distortion<8;distortion++){
    inspector.observeWrite(1,distortion*32+8);const state=inspector.read().channels[0];assert.equal(state.type,modes[distortion]);assert.equal(state.toneFrequency!==null,distortion===5||distortion===7);assert.equal(state.audc,distortion*32+8);assert.equal(state.distortion,distortion);
  }
  inspector.observeWrite(8,128);inspector.observeWrite(1,0x88);assert.equal(inspector.read().channels[0].type,'Noise (Poly9)');
  inspector.observeWrite(1,0xb8);assert.equal(inspector.read().channels[0].type,'Volume-only DAC');assert.equal(inspector.read().channels[0].toneFrequency,null);
  for(let ch=0;ch<4;ch++)inspector.observeWrite(ch*2+1,0xa8);inspector.observeWrite(8,6);const filtered=inspector.read();
  for(const ch of [0,1]){assert.equal(filtered.channels[ch].highPass,true);assert.equal(filtered.channels[ch].type,'High-pass filtered');assert.equal(filtered.channels[ch].toneFrequency,null);}
  assert.equal(filtered.channels[2].filterClockFor,0);assert.equal(filtered.channels[3].filterClockFor,1);assert.equal(filtered.channels[2].highPass,false);
  inspector.observeWrite(8,0);inspector.observeWrite(15,11);const twoTone=inspector.read();assert.equal(twoTone.twoTone,true);assert.equal(twoTone.channels[0].type,'Two-tone');assert.equal(twoTone.channels[1].toneFrequency,null);assert.equal(twoTone.channels[2].type,'Tone');
  inspector.observeWrite(15,0x13);const serial=inspector.read();assert.equal(serial.serialClock,true);assert(serial.channels.every(channel=>channel.type==='Serial clock mode'&&channel.toneFrequency===null));
  inspector.observeWrite(15,0);const stopped=inspector.read();assert.equal(stopped.running,false);assert(stopped.channels.every(channel=>channel.reason==='Timers stopped'&&channel.toneFrequency===null));
  for(const skctl of [1,2,3]){inspector.observeWrite(15,skctl);assert.equal(inspector.read().running,true);assert.equal(inspector.read().channels[0].toneFrequency,inspector.read().channels[0].frequency);}
  inspector.observeWrite(1,0xa0);assert.equal(inspector.read().channels[0].reason,'Volume 0');assert.equal(inspector.read().channels[0].toneFrequency,null);
});

test('POKEY applied Operators snapshots do not consume reservations, change their time or render audio',async()=>{
  const p=await createPokeyFixture();try{
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'later',time:.5},commands:[{method:'writeRegister',args:[1,0xa8]}]});
    const before=p.processor.performance.getStats(),frame=p.processor.timelineState().currentFrame,registers=p.read().registers;
    for(let count=0;count<10;count++)assert.deepEqual(p.read().registers,registers);
    assert.deepEqual(p.processor.performance.getStats(),before);assert.equal(p.processor.timelineState().currentFrame,frame);assert.equal(before.queuedCommands,1);assert.equal(p.read().channels[0].toneFrequency,null);
  }finally{p.close();}
});

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
