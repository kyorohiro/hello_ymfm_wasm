import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({model='6581'}={}) {
  let Constructor, resolveEdit;
  const messages = [], options = [], requests=[];
  const create=(model,value)=>{
    const core={model,disposed:0,dispose(){this.disposed++;}},request={model,core,settled:false};options.push(value);requests.push(request);
    return new Promise((resolve,reject)=>{request.resolve=()=>{request.settled=true;resolve(core);};request.reject=error=>{request.settled=true;reject(error);};});
  };
  const validate=value=>{
    if(!value||!Number.isInteger(value.value)||value.model!==undefined&&!['6581','8580'].includes(value.model))throw new RangeError('Invalid preset');
    return {...value,model:value.model??'6581'};
  };
  const validateChannels=value=>{
    if(!value||!['round-robin',0,1,2].includes(value.target)||!Array.isArray(value.channels)||value.channels.length!==3)throw new RangeError('Invalid channel setup');
    return {...value,channels:value.channels.map(validate)};
  };
  class Instrument {
    constructor(chip) { this.core = chip; this.calls = []; this.preset = {value: 0,model:chip.model};this.voices=[]; }
    read() { return {preset: {...this.preset}, voices: [...this.voices],...(this.channelSettings?{channelSettings:this.channelSettings}:{})}; }
    noteOn(...args) { this.calls.push(['noteOn', ...args]);this.voices.push(args[0]); return {channel: 0, stolenId: null}; }
    setPreset(value) {
      if (!value || !Number.isInteger(value.value)) throw new RangeError('Invalid preset');
      this.calls.push(['setPreset', value.value]);
      if (value.value === 8) return new Promise(resolve => { resolveEdit = () => { this.preset = value; resolve(this.read()); }; });
      this.preset = value; return this.read();
    }
    loadPreset(value) { this.calls.push(['loadPreset', value.value]); return this.setPreset(value); }
    setChannelSettings(value) { this.calls.push(['setChannelSettings',value.target]);this.channelSettings=value;this.preset=value.channels[value.target==='round-robin'?0:value.target];return this.read(); }
    loadChannelSettings(value) { this.calls.push(['loadChannelSettings',value.target]);return this.setChannelSettings(value); }
    stop() { this.calls.push(['stop']);this.voices=[];return this.read(); }
    beginCode(){this.stop();return {session:1,clock:985248,model:this.core.model,channels:3};}
    code(session,method,args){this.calls.push(['code',session,method,...args]);return 'code-result';}
    renderInto(output) { output.fill(.125); }
    dispose() { this.core.dispose(); }
  }
  vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
    SidCore: {create: value =>create('6581',value)}, Sid8580Core:{create:value=>create('8580',value)},
    SidInstrument: Instrument,readPreset:validate,readChannelSettings:validateChannels,
    applyChannelPreset:(settings,preset)=>({...settings,channels:settings.channels.map((old,index)=>settings.target==='round-robin'||index===settings.target?preset:{...old,model:preset.model})}),
    editChannelPreset:(settings,preset)=>{
      const previous=settings.channels[settings.target==='round-robin'?0:settings.target];
      return {...settings,channels:settings.channels.map((old,index)=>settings.target==='round-robin'
        ?{...old,model:preset.model,...(preset.value!==previous.value?{value:preset.value}:{})}:index===settings.target?preset:{...old,model:preset.model})};
    },sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: value => messages.push(value)}; } },
    registerProcessor(name, value) { assert.equal(name, 'tetorica-sid-synth'); Constructor = value; },
  });
  const binary = new Uint8Array([1, 2]),binary8580=new Uint8Array([3,4]),processor = new Constructor({processorOptions: {model,wasmBinary: binary,wasm8580Binary:binary8580}});
  return {processor,get core(){return requests[0].core;},options,messages,binary,binary8580,requests,
    resolve:()=>requests[0].resolve(),reject:error=>requests[0].reject(error),
    resolveNext:()=>requests.find(r=>!r.settled).resolve(),rejectNext:error=>requests.find(r=>!r.settled).reject(error),releaseEdit:()=>resolveEdit()};
}
const outputs = () => [[new Float32Array(128).fill(9), new Float32Array(128).fill(9)]];

test('SID processor starts silent, fixes PAL/6581 and preserves commands received during WASM loading', async () => {
  const f = fixture(), before = outputs(); assert.equal(f.processor.process([], before), true); assert(before[0].every(channel => channel.every(value => value === 0)));
  f.processor.receive({id: 1, method: 'noteOn', args: ['first', 60]}); f.processor.receive({id: 2, method: 'noteOn', args: ['second', 64]});
  f.resolve(); await f.processor.ready; await f.processor.commands;
  assert.equal(f.options[0].sampleRate, 48000); assert.equal(f.options[0].clockHz, 985248); assert.equal(f.options[0].wasmBinary, f.binary);
  assert.equal(f.messages[0].ready, true); assert.deepEqual(f.processor.instrument.calls, [['noteOn', 'first', 60], ['noteOn', 'second', 64]]);
  assert.deepEqual(f.messages.filter(message => message.id).map(message => message.id), [1, 2]);
  const pcm = outputs(); assert.equal(f.processor.process([], pcm), true); assert(pcm[0][0].every(value => value === .125)); assert.deepEqual(pcm[0][0], pcm[0][1]);
  f.processor.dispose(); assert.equal(f.core.disposed, 1); const silent = outputs(); assert.equal(f.processor.process([], silent), false); assert(silent[0].every(channel => channel.every(value => value === 0)));
});

test('SID preset changes and their ACKs stay FIFO even if a mutation becomes asynchronous; invalid edits preserve state', async () => {
  const f = fixture(); f.resolve(); await f.processor.ready;
  f.processor.receive({id: 1, method: 'setPreset', args: [{value: 8}]});
  f.processor.receive({id: 2, method: 'loadPreset', args: [{value: 9}]});
  f.processor.receive({id: 3, method: 'read'}); await flush();
  assert.equal(f.messages.filter(message => message.id).length, 0); assert.equal(f.processor.instrument.preset.value, 0);
  f.releaseEdit(); await f.processor.commands;
  assert.deepEqual(f.messages.filter(message => message.id).map(message => [message.id, message.value.preset.value]), [[1, 8], [2, 9], [3, 9]]);
  f.processor.receive({id: 4, method: 'setPreset', args: [{}]}); f.processor.receive({id: 5, method: 'read'});
  f.processor.receive({id: 6, method: 'constructor'}); f.processor.receive({id: 7, method: 'noteOn', args: {bad: true}}); await f.processor.commands;
  assert.equal(f.messages.find(message => message.id === 4).name, 'RangeError'); assert.equal(f.messages.find(message => message.id === 5).value.preset.value, 9);
  assert.match(f.messages.find(message => message.id === 6).error, /Unknown/); assert.match(f.messages.find(message => message.id === 7).error, /arguments must be an array/);
  assert.equal(f.processor.dead, false); f.processor.dispose();
});

test('SID disposal during startup destroys the eventual core without publishing readiness or playing queued notes', async () => {
  const f = fixture(); f.processor.receive({id: 1, method: 'noteOn', args: ['stale', 60]}); f.processor.receive({method: 'dispose'});
  f.resolve(); await f.processor.ready; await f.processor.commands;
  assert.equal(f.core.disposed, 1); assert.equal(f.messages.length, 0); assert.equal(f.processor.instrument, null);
});

test('SID startup/render failures produce one fatal reply and clear both output channels', async () => {
  const failed = fixture(); failed.reject(new Error('Bad WASM')); await failed.processor.ready;
  assert.equal(failed.messages.length, 1); assert.equal(failed.messages[0].fatal, true);
  const f = fixture(); f.resolve(); await f.processor.ready; f.processor.instrument.renderInto = () => { throw new Error('Broken render'); };
  const pcm = outputs(); assert.equal(f.processor.process([], pcm), false); assert(pcm[0].every(channel => channel.every(value => value === 0)));
  f.processor.fail(new Error('Second error')); assert.equal(f.messages.filter(message => message.fatal).length, 1); assert.equal(f.core.disposed, 1);
});

test('model replacement commits a prepared instrument and failure preserves the stopped old patch',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;const original=f.processor.instrument;
  f.processor.receive({id:1,method:'noteOn',args:['old',60]});await f.processor.commands;
  f.processor.receive({id:2,method:'loadPreset',args:[{value:2,model:'8580'}]});await flush();
  assert.equal(f.requests[1].model,'8580');assert.equal(f.options[1].wasmBinary,f.binary8580);
  assert.equal(original.voices.length,0,'a requested model change immediately clears the old Gate');
  assert.equal(f.processor.instrument,original);assert.equal(f.core.disposed,0);
  f.rejectNext(new Error('Model allocation failed'));await f.processor.commands;
  assert.equal(f.messages.find(m=>m.id===2).error,'Model allocation failed');assert.equal(f.processor.instrument,original);
  assert.deepEqual(original.preset,{value:0,model:'6581'});assert.equal(f.processor.dead,false);assert.equal(f.core.disposed,0);
  f.processor.receive({id:3,method:'setPreset',args:[{value:3,model:'8580'}]});await flush();f.resolveNext();await f.processor.commands;
  assert.equal(f.processor.instrument.preset.model,'8580');assert.equal(f.messages.find(m=>m.id===3).value.preset.value,3);
  assert.equal(f.core.disposed,1);const chip8580=f.requests[2].core;assert.equal(chip8580.disposed,0);
  f.processor.receive({id:4,method:'loadPreset',args:[{value:4,model:'6581'}]});await flush();f.resolveNext();await f.processor.commands;
  assert.equal(f.processor.instrument.preset.model,'6581');assert.equal(chip8580.disposed,1);
  f.processor.dispose();assert.equal(f.requests[3].core.disposed,1);
});

test('Stop preempts a pending model change, disposes its stale candidate and accepts a fresh note',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;const original=f.processor.instrument;
  f.processor.receive({id:1,method:'setPreset',args:[{value:1,model:'8580'}]});await flush();
  f.processor.receive({id:2,method:'stop'});f.resolveNext();await f.processor.commands;
  assert.equal(f.messages.find(m=>m.id===1).name,'AbortError');assert.equal(f.messages.find(m=>m.id===2).value.preset.model,'6581');
  assert.equal(f.processor.instrument,original);assert.equal(f.requests[1].core.disposed,1);assert.equal(f.core.disposed,0);
  f.processor.receive({id:3,method:'noteOn',args:['fresh',64]});await f.processor.commands;
  assert(original.voices.includes('fresh'));assert.equal(f.messages.find(m=>m.id===3).error,undefined);
  f.processor.dispose();assert.equal(f.core.disposed,1);
});

test('channel setup commands validate before mutation and atomically preserve the selected bank through model replacement',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;
  const bank=(model,target=2)=>({target,channels:[0,1,2].map(value=>({value,model}))});
  f.processor.receive({id:1,method:'setChannelSettings',args:[bank('6581')]});await f.processor.commands;
  assert.equal(f.messages.find(m=>m.id===1).value.preset.value,2);assert.equal(f.processor.instrument.channelSettings.target,2);
  f.processor.receive({id:2,method:'noteOn',args:['held',60]});await f.processor.commands;
  const original=f.processor.instrument;
  f.processor.receive({id:3,method:'loadChannelSettings',args:[bank('6581',3)]});await f.processor.commands;
  assert.equal(f.messages.find(m=>m.id===3).name,'RangeError');assert.deepEqual(original.voices,['held']);assert.equal(f.requests.length,1);
  f.processor.receive({id:4,method:'loadChannelSettings',args:[bank('8580',1)]});await flush();
  assert.equal(original.voices.length,0);assert.equal(f.processor.instrument,original);
  f.resolveNext();await f.processor.commands;
  assert.equal(f.messages.find(m=>m.id===4).value.preset.model,'8580');assert.equal(f.processor.instrument.channelSettings.target,1);
  assert.deepEqual(f.processor.instrument.channelSettings.channels.map(p=>p.value),[0,1,2]);assert.equal(f.core.disposed,1);
  f.processor.receive({id:5,method:'setPreset',args:[{value:9,model:'6581'}]});await flush();f.resolveNext();await f.processor.commands;
  assert.equal(f.processor.instrument.channelSettings.target,1);assert.deepEqual(f.processor.instrument.channelSettings.channels.map(p=>p.value),[0,9,2]);
  assert(f.processor.instrument.channelSettings.channels.every(p=>p.model==='6581'));f.processor.dispose();
});

test('Stop fences a channel-bank model candidate without adopting its later mode or patches',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;
  const current={target:1,channels:[0,1,2].map(value=>({value,model:'6581'}))};
  f.processor.receive({id:1,method:'setChannelSettings',args:[current]});await f.processor.commands;const original=f.processor.instrument;
  const next={target:2,channels:[3,4,5].map(value=>({value,model:'8580'}))};
  f.processor.receive({id:2,method:'loadChannelSettings',args:[next]});await flush();
  f.processor.receive({id:3,method:'stop'});f.resolveNext();await f.processor.commands;
  assert.equal(f.messages.find(m=>m.id===2).name,'AbortError');assert.equal(f.processor.instrument,original);
  assert.equal(original.channelSettings.target,1);assert.deepEqual(original.channelSettings.channels.map(p=>p.value),[0,1,2]);
  assert.equal(f.requests[1].core.disposed,1);assert.equal(f.core.disposed,0);f.processor.dispose();
});

test('a legacy Round robin model edit preserves mixed sounds while an explicit preset load replaces them',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;
  const bank={target:'round-robin',channels:[0,1,2].map(value=>({value,model:'6581'}))};
  f.processor.receive({id:1,method:'setChannelSettings',args:[bank]});await f.processor.commands;
  f.processor.receive({id:2,method:'setPreset',args:[{value:0,model:'8580'}]});await flush();f.resolveNext();await f.processor.commands;
  assert.equal(f.messages.find(m=>m.id===2).error,undefined);
  assert.deepEqual(f.processor.instrument.channelSettings.channels.map(value=>value.value),[0,1,2]);
  assert(f.processor.instrument.channelSettings.channels.every(value=>value.model==='8580'));
  f.processor.receive({id:3,method:'loadPreset',args:[{value:9,model:'6581'}]});await flush();f.resolveNext();await f.processor.commands;
  assert.deepEqual(f.processor.instrument.channelSettings.channels.map(value=>value.value),[9,9,9]);
  assert.equal(f.processor.instrument.channelSettings.target,'round-robin');f.processor.dispose();
});

test('invalid model/Stop edits do not stop held notes and disposal fences a late prepared model',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;
  f.processor.receive({id:1,method:'noteOn',args:['held',60]});await f.processor.commands;const original=f.processor.instrument;
  f.processor.receive({id:2,method:'setPreset',args:[{value:1,model:'8581'}]});
  f.processor.receive({id:3,method:'stop',args:[true]});await f.processor.commands;
  assert(original.voices.includes('held'));assert.equal(f.processor.modelEpoch,0);assert.equal(f.requests.length,1);
  assert.equal(f.messages.find(m=>m.id===2).name,'RangeError');assert.match(f.messages.find(m=>m.id===3).error,/no arguments/);
  f.processor.receive({id:4,method:'loadPreset',args:[{value:5,model:'8580'}]});await flush();f.processor.dispose();f.resolveNext();await f.processor.commands;
  assert.equal(f.core.disposed,1);assert.equal(f.requests[1].core.disposed,1);assert.equal(f.processor.instrument,null);
  assert.equal(f.messages.some(m=>m.id===4||m.fatal),false);
});

test('initial8580 and Stop during startup select the right binary without replaying stale notes',async()=>{
  const f=fixture({model:'8580'});assert.equal(f.requests[0].model,'8580');assert.equal(f.options[0].wasmBinary,f.binary8580);
  f.processor.receive({id:1,method:'noteOn',args:['stale',60]});f.processor.receive({id:2,method:'stop'});
  f.resolve();await f.processor.ready;await f.processor.commands;
  assert.equal(f.messages.find(m=>m.id===1).name,'AbortError');assert.equal(f.processor.instrument.voices.length,0);
  assert.equal(f.processor.instrument.preset.model,'8580');f.processor.dispose();
});

test('queued Code begin and physical writes cannot overtake Stop during startup',async()=>{
  const f=fixture();
  f.processor.receive({id:1,method:'beginCode'});f.processor.receive({id:2,method:'stop'});
  f.resolve();await f.processor.ready;await f.processor.commands;
  assert.equal(f.messages.find(message=>message.id===1).name,'AbortError');assert.equal(f.processor.codeOwner,null);
  f.processor.receive({id:3,method:'beginCode'});await f.processor.commands;
  const session=f.messages.find(message=>message.id===3).value.session;
  f.processor.receive({id:4,method:'code',args:[session,'noteOn',[2,'C4']]});
  f.processor.receive({id:5,method:'stop'});await f.processor.commands;
  assert.equal(f.messages.find(message=>message.id===4).name,'AbortError');
  assert(!f.processor.instrument.calls.some(call=>call[0]==='code'),'no physical gate is replayed after Stop');
  f.processor.receive({id:6,method:'beginCode'});await f.processor.commands;
  const fresh=f.messages.find(message=>message.id===6).value.session;assert.notEqual(fresh,session);
  f.processor.receive({id:7,method:'code',args:[session,'noteOn',[0,60]]});
  f.processor.receive({id:8,method:'code',args:[fresh,'noteOn',[1,64]]});await f.processor.commands;
  assert.equal(f.messages.find(message=>message.id===7).name,'AbortError');assert.equal(f.messages.find(message=>message.id===8).value,'code-result');
  f.processor.dispose();
});

test('real Code RPC shares physical SID voices, preserves authoring edits and rejects sessions across both model swaps',()=>{
  const script=`
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    const wasmBinary=await readFile(new URL(${JSON.stringify(new URL('../generated/sid/sid.wasm',import.meta.url).href)}));
    const wasm8580Binary=await readFile(new URL(${JSON.stringify(new URL('../generated/sid8580-machine/sid8580-endpoint.wasm',import.meta.url).href)}));
    let Constructor;globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={postMessage:value=>this.messages.push(value)};}};
    globalThis.registerProcessor=(_name,value)=>{Constructor=value;};globalThis.sampleRate=48000;
    await import(${JSON.stringify(new URL('./processor.js',import.meta.url).href)});
    for(const model of ['6581','8580']){
      const processor=new Constructor({processorOptions:{model,wasmBinary,wasm8580Binary}});await processor.ready;
      let serial=0;const command=async(method,args=[])=>{const id=++serial;processor.receive({id,method,args});await processor.commands;return processor.messages.find(message=>message.id===id);};
      assert.equal((await command('observeCode')).value,null,'a private observation must not begin Code');
      const session=(await command('beginCode')).value.session;
      assert.equal((await command('code',[session,'noteOn',[2,'C4']])).error,undefined);
      const state=(await command('code',[session,'getState',[]])).value;
      assert.equal(state.channels[0].gate,false);assert.equal(state.channels[1].gate,false);assert.equal(state.channels[2].gate,true);
      assert(Math.abs(state.channels[2].frequency-261.625565)<.1);
      const left=new Float32Array(8192),right=new Float32Array(8192);processor.process([],[[left,right]]);
      assert(left.some(value=>Math.abs(value)>.005));assert.deepEqual(left,right);
      const hardware=processor.instrument.core.getState(),observed=(await command('observeCode')).value;
      assert.equal(observed.positionFrames,8192);assert.equal(observed.sampleRate,48000);assert.equal(observed.model,model);
      assert.deepEqual(observed.registers,hardware.registers);assert.deepEqual(processor.instrument.core.getState(),hardware);
      const invalid=await command('code',[session,'noteOn',[3,'C4']]);assert.equal(invalid.name,'RangeError');
      assert.equal((await command('code',[session,'constructor',[]])).error,'Unknown SID Code method');
      const authored=(await command('read')).value.channelSettings;
      for(const preset of authored.channels){preset.filter.enabled=true;preset.filter.mode='notch';preset.filter.cutoff=1234;}
      await command('setChannelSettings',[authored]);
      const live=(await command('code',[session,'getState',[]])).value;assert.equal(live.filter.cutoff,1234);assert.equal(live.channels[2].gate,true);
      await command('stop');assert.equal((await command('observeCode')).value,null);assert.equal((await command('code',[session,'keyOn',[0]])).name,'AbortError');
      const fresh=(await command('beginCode')).value.session;assert.notEqual(fresh,session);
      assert.equal((await command('code',[fresh,'noteOn',[0,69]])).error,undefined);
      const next=(await command('read')).value.channelSettings;
      for(const preset of next.channels)preset.model=model==='6581'?'8580':'6581';
      await command('loadChannelSettings',[next]);
      assert.equal((await command('code',[fresh,'keyOn',[1]])).name,'AbortError');
      const replacement=(await command('beginCode')).value;assert.notEqual(replacement.session,fresh);assert.notEqual(replacement.model,model);
      assert.equal((await command('code',[replacement.session,'noteOn',[1,'E4']])).error,undefined);
      assert.equal((await command('code',[fresh,'noteOff',[1]])).name,'AbortError','old model handles cannot cut off a new model voice');
      processor.dispose();
    }
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test('real dual-model SID Synth processor renders and replaces models without Node, URL or base64 globals', () => {
  const script = `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    const wasmBinary=await readFile(new URL(${JSON.stringify(new URL('../generated/sid/sid.wasm', import.meta.url).href)}));
    const wasm8580Binary=await readFile(new URL(${JSON.stringify(new URL('../generated/sid8580-machine/sid8580-endpoint.wasm', import.meta.url).href)}));
    let Constructor;
    globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:value=>{this.last=value;}};}};
    globalThis.registerProcessor=(name,value)=>{assert.equal(name,'tetorica-sid-synth');Constructor=value;};
    globalThis.sampleRate=48000;globalThis.URL=undefined;globalThis.process=undefined;globalThis.atob=undefined;globalThis.btoa=undefined;globalThis.DOMException=undefined;
    await import(${JSON.stringify(new URL('./processor.js', import.meta.url).href)});
    for(const model of ['6581','8580']){
    const processor=new Constructor({processorOptions:{model,wasmBinary,wasm8580Binary}});await processor.ready;assert.equal(processor.last.ready,true);
    processor.receive({id:1,method:'noteOn',args:['real',60]});await processor.commands;assert.equal(processor.last.error,undefined);
    const left=new Float32Array(4096),right=new Float32Array(4096);assert.equal(processor.process([],[[left,right]]),true);
    assert(left.every(Number.isFinite));assert(left.some(value=>Math.abs(value)>.001));assert.deepEqual(left,right);
    processor.receive({id:2,method:'read'});await processor.commands;assert.equal(processor.last.value.voices.length,1);
    const before=processor.last.value.preset;assert.equal(before.model,model);assert.equal(before.version,2);
    const {selectChannelTarget,applyChannelPreset}=await import(${JSON.stringify(new URL('./channel_settings.js', import.meta.url).href)});
    let bank=selectChannelTarget(processor.last.value.channelSettings,2),third={...before,name:'Third channel',voice:{...before.voice,pulseWidth:911,waveform:'pulse'}};
    bank=applyChannelPreset(bank,third);
    processor.receive({id:20,method:'loadChannelSettings',args:[bank]});await processor.commands;assert.equal(processor.last.error,undefined);
    processor.receive({id:21,method:'noteOn',args:['fixed',67]});await processor.commands;assert.equal(processor.last.value.channel,2);
    processor.receive({id:22,method:'read'});await processor.commands;
    assert.equal(processor.last.value.channelSettings.target,2);assert.equal(processor.last.value.voices[0].channel,2);
    assert.equal(processor.last.value.registers[18]&1,1);assert.equal(processor.last.value.registers[4]&1,0);
    assert.equal(processor.last.value.preset.voice.pulseWidth,911);
    processor.receive({id:3,method:'setPreset',args:[{waveform:'invalid'}]});await processor.commands;assert(processor.last.error);
    processor.receive({id:4,method:'read'});await processor.commands;assert.deepEqual(processor.last.value.preset,third);
    const other=model==='6581'?'8580':'6581';
    processor.receive({id:5,method:'loadPreset',args:[{...before,model:other}]});await processor.commands;
    assert.equal(processor.last.error,undefined);assert.equal(processor.last.value.preset.model,other);assert.equal(processor.last.value.voices.length,0);
    assert.equal(processor.last.value.channelSettings.target,2);assert.equal(processor.last.value.channelSettings.channels[0].voice.waveform,'saw');
    processor.receive({id:6,method:'noteOn',args:['other',64]});await processor.commands;
    processor.process([],[[left,right]]);assert(left.every(Number.isFinite));assert(left.some(value=>Math.abs(value)>.001));assert.deepEqual(left,right);
    processor.receive({id:7,method:'stop'});await processor.commands;left.fill(9);right.fill(9);processor.process([],[[left,right]]);
    assert(left.every(value=>value===0));assert(right.every(value=>value===0));processor.receive({method:'dispose'});
    assert.equal(processor.process([],[[left,right]]),false);
    }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', timeout: 20000});
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
