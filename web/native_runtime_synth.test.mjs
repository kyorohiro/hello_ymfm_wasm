import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as immediate} from 'node:timers/promises';
import {SnesSynth} from './snessynth.js';
import {Ps1Synth,createPs1InitSample} from './ps1synth.js';
import {borrowNativeApi, createNativePrimaryClient} from './playground_native_primary.js';

// Browser audio helpers capture fetch when imported. Route that captured
// function into each deterministic device harness without fetching file: URLs.
const browserFetch=globalThis.fetch;
let fetchAsset;
globalThis.fetch=(...args)=>fetchAsset?fetchAsset(...args):browserFetch(...args);
const {NativeRuntimeSynth}=await import('./native_runtime_synth.js');
globalThis.fetch=browserFetch;

const deferred = () => { let resolve; return {promise:new Promise(done => { resolve = done; }), resolve:() => resolve()}; };
async function until(predicate) {
  for (let iteration = 0; iteration < 200; iteration++) { if (predicate()) return; await immediate(); }
  assert.fail('Async initialization boundary not reached');
}

/** Real client MessageChannels, with deterministic device/module boundaries. */
function harness(t, chip, {stage = '', target = chip === 'x68000' ? 'okim6258' : chip, stereoEnabled = true,ym2413=false,opllOptions,ayOptions,oplOptions,clock,type,flags} = {}) {
  const previous = globalThis.AudioWorkletNode;
  const previousFetchAsset=fetchAsset;
  const gate = deferred(), nodes = [], fetches = [], moduleLoads = [], ports = new Set();
  let reached = false, contextCloses = 0;
  const graphNode = () => ({connections:[], connect(node) { this.connections.push(node); }, disconnect() { this.connections.length = 0; }});
  const context = {state:'running', currentTime:0, sampleRate:48000,destination:graphNode(),
    async resume() { this.state = 'running'; }, async suspend() { this.state = 'suspended'; }, async close() { contextCloses++; this.state = 'closed'; },
    createGain:() => ({...graphNode(), gain:{value:1, cancelScheduledValues(){}, setValueAtTime(value){this.value=value;}, linearRampToValueAtTime(value){this.value=value;}}}),
    createChannelSplitter:graphNode, createChannelMerger:graphNode,
    audioWorklet:{addModule:async url => { moduleLoads.push(String(url)); if (stage === 'module' && (String(url).includes(target)||['ym3526','ym3812','y8950','ymf262'].includes(target)&&String(url).includes('playground_opl_worklet'))) { reached = true; await gate.promise; } }},
  };
  const fetchBytes = async url => {
    fetches.push(String(url));
    if (stage === 'fetch' && String(url).includes(target === 'snes' ? 'spc' : target)) { reached = true; await gate.promise; }
    return {ok:true, arrayBuffer:async () => new ArrayBuffer(1)};
  };
  fetchAsset=fetchBytes;
  globalThis.AudioWorkletNode = class {
    constructor(audioContext, name, options) {
      this.context = audioContext; this.name = name; this.options = options; this.messages = []; this.connections = [];
      this.loadedMemory = null;
      this.validation = name.includes('snes') ? new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},dispose(){}}}) : null;
      if(name.includes('ps1')){this.validation=new Ps1Synth({core:{reset(){},loadRam(){},write(){},read(){return 0;},readRam(){return new Uint8Array(524288);},renderInto(){},dispose(){}}});const{adpcm,...metadata}=createPs1InitSample(),sample=this.validation.loadADPCM(adpcm,metadata);for(let ch=0;ch<24;ch++)this.validation.setPreset(ch,{sample});}
      this.port = {closed:false, close:() => { this.port.closed = true; this.remote?.close(); }, postMessage:data => {
        this.messages.push(data);
        if (data.port) {
          this.remote = data.port; ports.add(data.port);
          data.port.onmessage = event => this.receive(event.data, data.port); data.port.start();
        }
      }};
      nodes.push(this);
      if (stage === 'ready' && (name.includes(target)||options.processorOptions.chip===target)) { reached = true; gate.promise.then(() => this.ready()); }
      else queueMicrotask(() => this.ready());
    }
    ready() { this.port.onmessage?.({data:{ready:true,sampleRate:48000,internalSampleRate:44100,voices:[{index:0,name:'INIT SINE'}],selectedVoice:0,...(this.name.includes('ps1')?{state:this.validation.getState()}:{})}}); }
    receive(data, port) {
      this.messages.push(data);
      if (data.method === 'dispose') { port.close(); return; }
      let value = true;
      if(this.name.includes('dx7')&&['getState','stopVoices'].includes(data.method))value=synth.dx7._getState();
      if (this.validation && typeof this.validation[data.method] === 'function') value = this.validation[data.method](...(data.args ?? []));
      else if(this.validation&&data.method==='stopVoices')this.validation.allNotesOff();
      if (data.method === 'loadMemory') this.loadedMemory = data.args[0].slice();
      if (data.id !== undefined) port.postMessage({id:data.id,value});
    }
    connect(node) { this.connections.push(node); }
    disconnect() { this.connections.length = 0; }
  };
  const synth = new NativeRuntimeSynth({chip, audioContext:context, fetch:fetchBytes, extraOki:{fetch:fetchBytes}, stereoEnabled,ym2413,opllOptions,ayOptions,oplOptions,clock,type,flags});
  t.after(async () => {
    gate.resolve(); await synth.close(); for (const port of ports) port.close(); globalThis.AudioWorkletNode = previous;fetchAsset=previousFetchAsset;
  });
  return {synth, context, nodes, fetches, moduleLoads, gate, reached:() => reached, contextCloses:() => contextCloses};
}

for (const chip of ['nes','snes','ps1','huc6280','wonderswan','x68000','segapsg','dx7','ym3526','ym3812','y8950','ymf262','ym2413','ay8910']) test(`${chip} primary is lazy, starts once, routes only native devices, and restarts`, async t => {
  const device = harness(t, chip); const {synth,nodes} = device;
  assert.equal(nodes.length, 0); assert.equal(device.fetches.length, 0); assert.equal(device.moduleLoads.length, 0);
  assert.equal(synth.fm, null); assert.equal(synth.psg, null); assert.equal(synth.isReady(), false);
  await Promise.all([synth.start(),synth.start()]);
  assert.equal(synth.isReady(), true); assert.equal(nodes.length, chip === 'x68000' ? 2 : 1);
  assert.deepEqual(synth.capabilities, {chip,fmChannels:0,psg:chip === 'segapsg',dac:false,recorder:false});
  assert.equal(typeof synth.sample.load, 'function'); assert.equal(typeof synth.stream.load, 'function');
  assert(nodes.every(node => node.connections.length === 1), 'each device connects once through mixer, with no direct duplicate output');
  const names = chip === 'x68000' ? ['ym2151','okim6258'] : [chip];
  assert.deepEqual(synth.primaryEndpoints.map(endpoint => endpoint.name), names);
  assert.deepEqual(synth.mixer.list().filter(row => row.connected).map(row => row.id), names);
  if (chip === 'nes') { assert(synth.nes.fdsEnabled); assert.equal(nodes[0].options.processorOptions.fds,true); }
  if (chip === 'huc6280') assert.equal(synth.pce._getState().initialized, true);
  if (chip === 'x68000') {
    assert.equal(synth.opm.clock, 4000000); assert.equal(synth.adpcm.clock, 8000000);
    assert.notEqual(synth.primaryEndpoints[0].node, synth.primaryEndpoints[1].node);
    assert.notEqual(synth.primaryEndpoints[0].port, synth.primaryEndpoints[1].port);
  }
  const apis = synth.primaryApis; await synth.start(); assert.equal(synth.primaryApis, apis);
  await synth.close(); assert.equal(synth.state,'closed'); assert.equal(device.contextCloses(), 0, 'caller owns supplied context');
  assert(nodes.every(node => node.port.closed && node.connections.length === 0)); assert.equal(synth.primaryEndpoints.length,0);
  assert.deepEqual(synth.primaryApis, {});
  await synth.start(); assert.equal(synth.isReady(),true); assert.equal(nodes.length, chip === 'x68000' ? 4 : 2);
});

test('native Stop preserves SNES BRR allocation, sample assignment and per-voice parameters', async t => {
  const {synth,nodes} = harness(t, 'snes'); await synth.start();
  const bytes = new Uint8Array([0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf]);
  const sample = await synth.snes.loadBRR(bytes, {baseFrequencyHz:2000,loopStartSamples:0});
  synth.snes.setPreset(0, {sample,volumeLeft:70,volumeRight:50}); synth.snes.noteOn(0,'C4');
  const before = synth.snes._getState(); await synth.stopAllNative();
  assert.deepEqual(synth.snes._getState(), before);
  await until(() => nodes[0].messages.some(data => data.method === 'stopVoices'));
  assert(nodes[0].messages.some(data=>data.method==='stopVoices'&&data.id!==undefined),'Stop completes after its Worklet acknowledgement');
  assert.equal(nodes[0].validation.getState().samples.length,1);
  synth.snes.noteOn(0,'E4'); assert.equal(synth.snes._getState().samples[0].id,sample.id);
});

test('native Stop retains X68000 OPM patch and OKIM6258 sample metadata, and borrows hide disposal', async t => {
  const {synth,nodes} = harness(t, 'x68000'); await synth.start();
  synth.opm.setAlgo(0,7); synth.opm.setOperator(0,3,{mul:1,tl:30,ar:31,rr:0});
  await synth.adpcm.loadMemory(Uint8Array.of(0x10,0x32,0x54,0x76)); synth.adpcm.play({repeat:true});
  const patch = synth.opm._getState().registers.slice(0x20), sample = synth.adpcm._getState();
  synth.stopAllNative(); assert.deepEqual(synth.opm._getState().registers.slice(0x20),patch); assert.deepEqual(synth.adpcm._getState(),sample);
  await until(() => nodes[1].messages.some(data => data.method === 'stopVoices'));
  assert.deepEqual(nodes[1].loadedMemory,Uint8Array.of(0x10,0x32,0x54,0x76));
  const borrowed = borrowNativeApi(synth.adpcm,'okim6258');
  assert.equal(borrowed.dispose,undefined); assert.equal(borrowed.transport,undefined); assert.equal(borrowed._getState,undefined); assert.equal(borrowed.id,'okim6258');
  borrowed.play(); await until(() => nodes[1].messages.filter(data => data.method === 'play').length >= 2);
});

test('PCE state handoff preserves initialized waveform, volume and clock without replaying writes', async t => {
  const {synth} = harness(t, 'huc6280'); await synth.start();
  const wave = Array.from({length:32},(_,index) => index); synth.pce.setWaveform(3,wave); synth.pce.setVolume(3,19);
  await synth.pce.setClock(4000000); synth.pce.noteOn(3,'A4');
  const state = synth.pce._getState(), channel = new MessageChannel(); let writes = 0;
  channel.port1.onmessage = () => writes++; channel.port1.start();
  const worker = createNativePrimaryClient('huc6280',channel.port2,{clock:state.clock,state});
  t.after(() => { worker.dispose(); channel.port1.close(); });
  await immediate(); assert.equal(writes,0); assert.deepEqual(worker._getState(),state);
  synth.stopAllNative(); assert.deepEqual(synth.pce._getState().waveforms[3],wave); assert.equal(synth.pce.clock,4000000);
  assert.equal(synth.pce._getState().registers[3][4],19);
});

test('WonderSwan Worker handoff and Stop retain wave RAM, clock and special modes without replaying writes',async t=>{
  const {synth,nodes}=harness(t,'wonderswan');await synth.start();
  assert.equal(synth.ws._getState().initialized,true);assert.equal(synth.ws,synth.primaryApis.ws);
  const wave=Array.from({length:32},(_,index)=>(index*3)&15);
  synth.ws.writeRegister(0x8f,8);synth.ws.setWaveform(2,wave);synth.ws.setVolume(2,11,7);
  synth.ws.setSweep({enabled:true,step:-3,time:12});synth.ws.setNoise({enabled:true,type:6});
  synth.ws.setVoiceMode(true);synth.ws.writeVoice(140);await synth.ws.setClock(4000000);
  synth.ws.noteOn(2,'A4');synth.ws.keyOn(1);synth.ws.noteOn(3,'C4');
  const before=synth.ws._getState(),channel=new MessageChannel(),messages=[];
  channel.port1.onmessage=({data})=>messages.push(data);channel.port1.start();
  const worker=createNativePrimaryClient('wonderswan',channel.port2,{clock:before.clock,state:before});
  t.after(()=>{worker.dispose();channel.port1.close();});
  await immediate();assert.deepEqual(messages,[],'adopting authored state must not reset or replay registers or RAM');
  assert.deepEqual(worker._getState(),before);assert.equal(worker.clock,4000000);
  const borrowed=borrowNativeApi(worker,'wonderswan');
  for(const name of ['dispose','transport','_getState','_adoptState','_stopVoices'])assert.equal(borrowed[name],undefined);
  await synth.stopAllNative();
  assert(nodes[0].messages.some(message=>message.method==='stopVoices'&&message.id!==undefined),'Stop awaits the device acknowledgement');
  const stopped=synth.ws._getState(),expected=structuredClone(before);expected.registers[16]&=0xf0;
  assert.deepEqual(stopped,expected,'Stop releases gates while retaining wave bank, all wave RAM, stereo levels, sweep/noise/PCM modes and pitch');
  assert.equal(synth.ws,synth.primaryApis.ws);assert.equal(synth.ws.clock,4000000);
  worker.noteOn(0,'E4');await until(()=>messages.length>0);assert(!messages.some(message=>message.method==='reset'));
});

test('NES Worker handoff adopts FDS and pulse configuration without resetting the primary chip', async t => {
  const {synth} = harness(t,'nes'); await synth.start();
  synth.nes.pulse.setVoice(1,{duty:.25,volume:6});
  synth.nes.fds.setWave(Array.from({length:64},(_,index) => index));
  synth.nes.fds.setVolume(19); await synth.nes.setClock(1800000);
  const state = synth.nes._getState(), channel = new MessageChannel(), messages = [];
  channel.port1.onmessage = ({data}) => messages.push(data); channel.port1.start();
  const worker = createNativePrimaryClient('nes',channel.port2,{clock:synth.nes.clock,fdsEnabled:true,state});
  t.after(() => {worker.dispose();channel.port1.close();});
  await immediate(); assert.equal(messages.length,0,'constructing Worker authoring state must not write reset/defaults');
  assert.deepEqual(worker._getState(),state); assert.equal(worker.fdsEnabled,true);
  worker.fds.noteOn('C4'); await until(() => messages.length > 0);
  assert(!messages.some(data => data.method === 'reset'));
});

for (const chip of ['nes','snes','ps1','huc6280','wonderswan','x68000','segapsg','dx7','ym3526','ym3812','y8950','ymf262','ym2413','ay8910']) test(`${chip} close during ${chip === 'x68000' ? 'second device' : 'device'} initialization aborts and permits restart`, async t => {
  const {synth,nodes,gate,reached} = harness(t,chip,{stage:'ready'});
  const canceled = assert.rejects(synth.start(),{name:'AbortError'});
  await until(reached); if (chip === 'x68000') assert.equal(synth.primaryEndpoints.length,1,'OPM ready before second device');
  await synth.close(); await canceled; gate.resolve(); await immediate();
  assert.equal(synth.state,'closed'); assert.equal(synth.primaryEndpoints.length,0); assert.deepEqual(synth.primaryApis,{});
  assert(nodes.every(node => node.port.closed && node.connections.length === 0));
  await synth.start(); assert(synth.isReady()); assert.equal(nodes.length,chip === 'x68000' ? 4 : 2);
});

test('DX7 Worker handoff adopts bank metadata without replaying edits and Stop keeps the primary',async t=>{
  const {synth,nodes}=harness(t,'dx7');await synth.start();
  const state={sampleRate:48000,internalSampleRate:44100,voices:[{index:0,name:'FIRST'},{index:1,name:'SECOND'}],selectedVoice:1,stateRevision:0};
  synth.dx7._adoptState(state);
  const channel=new MessageChannel(),messages=[];channel.port1.onmessage=({data})=>messages.push(data);channel.port1.start();
  const worker=createNativePrimaryClient('dx7',channel.port2,{state,sampleRate:48000});
  t.after(()=>{worker.dispose();channel.port1.close();});
  await immediate();assert.deepEqual(messages,[]);assert.deepEqual(worker._getState(),state);
  const api=borrowNativeApi(worker,'dx7');assert.equal(api.dispose,undefined);assert.equal(api._stopVoices,undefined);
  synth.stopAllNative();await until(()=>nodes[0].messages.some(data=>data.method==='stopVoices'));
  assert.deepEqual(synth.dx7._getState(),state);assert.equal(synth.dx7,synth.primaryApis.dx7);
  worker.noteOn(64);await until(()=>messages.length>0);assert.equal(messages.at(-1).method,'noteOn');
});

for(const stage of ['fetch','module'])test(`DX7 close cancels pending ${stage} loading and permits restart`,async t=>{
  const {synth,nodes,gate,reached}=harness(t,'dx7',{stage});
  const canceled=assert.rejects(synth.start(),{name:'AbortError'});await until(reached);
  await synth.close();await canceled;assert.equal(nodes.length,0);gate.resolve();
  await synth.start();assert.equal(nodes.length,1);assert(synth.isReady());
});

test('DX7 fatal primary failure releases its mixer route, loses readiness and can restart',async t=>{
  const {synth,nodes}=harness(t,'dx7');await synth.start();const old=synth.dx7;
  nodes[0].onprocessorerror();assert.equal(synth.state,'error');assert.equal(synth.isReady(),false);
  assert.equal(synth.dx7,null);assert.equal(synth.primaryEndpoints.length,0);
  assert(synth.mixer.list().every(row=>!row.connected));assert.throws(()=>old.noteOn(60),/disposed/);
  await synth.start();assert(synth.isReady());assert.equal(nodes.length,2);
});

test('DX7 creates its own supported-rate context while leaving supplied contexts untouched',async t=>{
  const {context}=harness(t,'dx7'),previous=globalThis.AudioContext,constructorOptions=[];
  globalThis.AudioContext=class {constructor(options){constructorOptions.push(options);return context;}};
  const synth=new NativeRuntimeSynth({chip:'dx7',fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)})});
  t.after(async()=>{await synth.close();globalThis.AudioContext=previous;});
  await synth.start();assert.deepEqual(constructorOptions,[{sampleRate:44100}]);
  assert.equal(synth.ownsAudioContext,true);
  await synth.close();assert.equal(context.state,'closed');
});

for (const stage of ['module','fetch']) test(`PCE close cancels pending ${stage} loading without allocating a node`, async t => {
  const {synth,nodes,gate,reached} = harness(t,'huc6280',{stage});
  const canceled = assert.rejects(synth.start(),{name:'AbortError'}); await until(reached);
  await synth.close(); await canceled; assert.equal(nodes.length,0);
  gate.resolve(); await synth.start(); assert.equal(nodes.length,1); assert(synth.isReady());
});

for (const stereoEnabled of [true,false]) test(`PSG primary configures ${stereoEnabled ? 'Game Gear stereo' : 'Master System mono'}, Stop and Worker handoff preserve authoring state`, async t => {
  const {synth,nodes} = harness(t,'segapsg',{stereoEnabled}); await synth.start();
  assert.equal(synth.psg, synth.primaryApis.psg); assert.equal(synth.psg.clock,3579545);
  assert.equal(nodes[0].options.processorOptions.stereoEnabled,stereoEnabled);
  assert.equal(typeof synth.psg.setStereo,stereoEnabled ? 'function' : 'undefined');
  synth.psg.tone(0,{note:'C4',attenuation:7}); synth.psg.noise({attenuation:9});
  if (stereoEnabled) synth.psg.setStereo(0xa5);
  const before = synth.psg._getState();
  const channel = new MessageChannel(), messages = [];
  channel.port1.onmessage = ({data}) => messages.push(data); channel.port1.start();
  const worker = createNativePrimaryClient('segapsg',channel.port2,{clock:synth.psg.clock,stereoEnabled,state:before});
  t.after(() => {worker.dispose();channel.port1.close();});
  await immediate(); assert.equal(messages.length,0,'state adoption must not reset/replay audio'); assert.deepEqual(worker._getState(),before);
  await synth.stopAllNative();
  await until(() => nodes[0].messages.some(data=>data.method==='stopVoices'));
  assert(nodes[0].messages.some(data=>data.method==='stopVoices'&&data.id!==undefined),'Stop completes after its Worklet acknowledgement');
  assert.deepEqual(synth.psg._getState().attenuations,before.attenuations); assert.equal(synth.psg._getState().stereo,before.stereo);
  const borrowed = borrowNativeApi(worker,'segapsg');
  for (const name of ['dispose','transport','_getState','_adoptState']) assert.equal(borrowed[name],undefined);
  const count = messages.length; worker._adoptState(synth.psg._getState()); await immediate(); assert.equal(messages.length,count);
  worker.keyOn(0); await until(() => messages.length > count); assert.equal(messages.at(-1).args[0],0x97);
});

test('native Stop awaits every DX7/SNES/PSG acknowledgement before completing',async()=>{
  const synth=new NativeRuntimeSynth({chip:'dx7'}),gates=Array.from({length:3},deferred),calls=[];
  synth.primaryApis=Object.fromEntries(['dx7','snes','psg'].map((name,index)=>[name,{_stopVoices(){calls.push(name);return gates[index].promise;}}]));
  let completed=false;const stopping=synth.stopAllNative().then(()=>completed=true);
  assert.deepEqual(calls,['snes','psg','dx7']);
  gates[0].resolve();gates[1].resolve();await immediate();assert.equal(completed,false);
  gates[2].resolve();await stopping;assert.equal(completed,true);
});

for (const stage of ['module','fetch']) test(`PSG close cancels pending ${stage} loading without allocating a node`, async t => {
  const {synth,nodes,gate,reached} = harness(t,'segapsg',{stage});
  const canceled = assert.rejects(synth.start(),{name:'AbortError'}); await until(reached);
  await synth.close(); await canceled; assert.equal(nodes.length,0);
  gate.resolve(); await synth.start(); assert.equal(nodes.length,1); assert(synth.isReady());
});

for(const chip of ['ym3526','ym3812','y8950','ymf262'])for(const stage of ['fetch','module'])test(`${chip} close cancels pending ${stage} and restarts without leaking a node`,async t=>{
  const {synth,nodes,gate,reached}=harness(t,chip,{stage});
  const canceled=assert.rejects(synth.start(),{name:'AbortError'});await until(reached);await synth.close();await canceled;assert.equal(nodes.length,0);gate.resolve();
  await synth.start();assert.equal(nodes.length,1);assert(synth.isReady());
});
test('OPL fatal primary failure releases resources and permits restart',async t=>{
  const {synth,nodes}=harness(t,'ym3812');await synth.start();const previous=synth.opl;nodes[0].onprocessorerror();
  assert.equal(synth.state,'error');assert.equal(synth.opl,null);assert.equal(synth.isReady(),false);assert(synth.mixer.list().every(row=>!row.connected));assert.throws(()=>previous.noteOn(0,69),/disposed/i);
  await synth.start();assert(synth.isReady());assert.equal(nodes.length,2);
});

test('WonderSwan fatal primary failure releases its route and old client, then permits restart',async t=>{
  const {synth,nodes}=harness(t,'wonderswan');await synth.start();const previous=synth.ws;
  previous.noteOn(0,'A4');nodes[0].onprocessorerror();
  assert.equal(synth.state,'error');assert.equal(synth.isReady(),false);assert.equal(synth.ws,null);
  assert.equal(synth.primaryEndpoints.length,0);assert.deepEqual(synth.primaryApis,{});
  assert(synth.mixer.list().every(row=>!row.connected));assert(nodes[0].port.closed);assert.equal(nodes[0].connections.length,0);
  assert.throws(()=>previous.noteOn(0,'A4'),/disposed/i);
  await synth.start();assert(synth.isReady());assert.equal(nodes.length,2);assert.notEqual(synth.ws,previous);
  assert.equal(synth.ws._getState().initialized,true);assert.deepEqual(synth.primaryEndpoints.map(endpoint=>endpoint.name),['wonderswan']);
});

test('Master System explicitly adds one borrowed OPLL endpoint beside its mono Sega PSG and retains both after Stop',async t=>{
  const {synth,nodes,fetches,moduleLoads}=harness(t,'segapsg',{stereoEnabled:false,ym2413:true,opllOptions:{wasmUrl:'https://assets.test/ym2413_wasm.wasm',workletUrl:'https://assets.test/playground_ym2413_worklet.js'}});
  assert.equal(nodes.length,0);await synth.start();assert.equal(nodes.length,2);assert.equal(synth.psg,synth.primaryApis.psg);assert.equal(synth.opll,synth.primaryApis.opll);assert.equal(synth.opll.clock,3579545);
  assert.deepEqual(synth.primaryEndpoints.map(endpoint=>[endpoint.name,endpoint.globalName]),[['segapsg','psg'],['ym2413','opll']]);assert.deepEqual(synth.mixer.list().filter(row=>row.connected).map(row=>row.id),['segapsg','ym2413']);
  assert(fetches.includes('https://assets.test/ym2413_wasm.wasm'));assert(moduleLoads.includes('https://assets.test/playground_ym2413_worklet.js'));
  synth.psg.tone(0,{note:'A4',attenuation:7});synth.opll.setVoice(0,{instrument:4,attenuation:3,sustain:true});synth.opll.noteOn(0,69);const patch=synth.opll._getState().registers.slice(0,8);await synth.stopAllNative();
  for(const node of nodes)assert(node.messages.some(message=>message.method==='stopVoices'));assert.deepEqual(synth.opll._getState().registers.slice(0,8),patch);assert.equal(synth.opll._getState().registers[0x30],0x43);assert.equal(synth.psg._getState().attenuations[0],7);
  await synth.close();assert(nodes.every(node=>node.port.closed&&node.connections.length===0));await synth.start();assert.equal(nodes.length,4);
});
for(const stage of ['fetch','module','ready'])test(`Master System close during the OPLL ${stage} load releases the already-connected PSG and can restart`,async t=>{
  const {synth,nodes,gate,reached}=harness(t,'segapsg',{stereoEnabled:false,ym2413:true,target:'ym2413',stage});const canceled=assert.rejects(synth.start(),{name:'AbortError'});await until(reached);assert.equal(synth.primaryEndpoints.length,1);await synth.close();await canceled;gate.resolve();assert(nodes.every(node=>node.port.closed&&node.connections.length===0));await synth.start();assert(synth.psg&&synth.opll);
});
test('YM2413 expansion options are explicit, while a default Game Gear still opens only its PSG',async t=>{
  assert.throws(()=>new NativeRuntimeSynth({chip:'segapsg',ym2413:'yes'}),/boolean/);assert.throws(()=>new NativeRuntimeSynth({chip:'nes',ym2413:true}),/Sega PSG/);
  const {synth,nodes,fetches}=harness(t,'segapsg',{stereoEnabled:true});await synth.start();assert.equal(nodes.length,1);assert.equal(synth.opll,null);assert(!fetches.some(url=>url.includes('ym2413')));
});

test('MSX Audio lazily starts three separate native primaries on one context and Stop preserves shared controls',async t=>{
  const custom=Object.fromEntries(['ay','opll','opl'].map((key,index)=>[`${key}Options`,{wasmUrl:`https://assets.test/${key}.wasm`,workletUrl:`https://assets.test/${key}.js`}]));
  const {synth,nodes,fetches,moduleLoads,context}=harness(t,'msx-audio',custom);assert.equal(nodes.length,0);assert.deepEqual(fetches,[]);assert.deepEqual(moduleLoads,[]);await Promise.all([synth.start(),synth.start()]);
  assert.equal(nodes.length,3);assert(nodes.every(node=>node.context===context));assert.deepEqual(synth.primaryEndpoints.map(endpoint=>[endpoint.name,endpoint.globalName,endpoint.clock]),[['ay8910','ay',1789773],['ym2413','opll',3579545],['y8950','opl',3579545]]);
  assert.deepEqual(synth.mixer.list().filter(row=>row.connected).map(row=>row.id),['ay8910','ym2413','y8950']);for(const key of ['ay','opll','opl']){assert.equal(synth[key],synth.primaryApis[key]);assert(fetches.includes(`https://assets.test/${key}.wasm`));assert(moduleLoads.includes(`https://assets.test/${key}.js`));}
  synth.ay.setVoice(2,{tone:true,noise:true,volume:6,envelope:true,note:'A4'});synth.ay.setNoisePeriod(21);synth.ay.setEnvelope({period:2222,shape:10});synth.opll.setVoice(8,{instrument:5,attenuation:4});synth.opl.setOperator(8,1,{tl:14});
  const before=synth.ay._getState();await synth.stopAllNative();assert(nodes.every(node=>node.messages.some(message=>message.method==='stopVoices')));assert.deepEqual(synth.ay._getState().registers.slice(0,8),before.registers.slice(0,8));assert.deepEqual(synth.ay._getState().levels,before.levels);assert(synth.ay._getState().registers.slice(8,11).every(value=>value===0));assert.equal(synth.opll._getState().registers[0x38],0x54);assert.equal(synth.opl.getRegisterSnapshot()[0x55]&63,14);
  await synth.close();assert(nodes.every(node=>node.port.closed&&!node.connections.length));await synth.start();assert.equal(nodes.length,6);
});
for(const target of ['ay8910','ym2413','y8950'])for(const stage of ['fetch','module','ready'])test(`MSX Audio close during ${target} ${stage} cancels all initialized endpoints and restarts`,async t=>{
  const {synth,nodes,gate,reached}=harness(t,'msx-audio',{target,stage});const canceled=assert.rejects(synth.start(),{name:'AbortError'});await until(reached);assert.equal(synth.primaryEndpoints.length,['ay8910','ym2413','y8950'].indexOf(target));await synth.close();await canceled;gate.resolve();assert(nodes.every(node=>node.port.closed&&!node.connections.length));assert.deepEqual(synth.primaryApis,{});await synth.start();assert(synth.ay&&synth.opll&&synth.opl);assert.equal(synth.primaryEndpoints.length,3);
});
test('MSX Audio fatal device failure releases every primary and permits a complete restart',async t=>{
  const {synth,nodes}=harness(t,'msx-audio');await synth.start();const ay=synth.ay;nodes[2].onprocessorerror();assert.equal(synth.state,'error');assert.equal(synth.ay,null);assert.equal(synth.opll,null);assert.equal(synth.opl,null);assert(synth.mixer.list().every(row=>!row.connected));assert.throws(()=>ay.keyOn(0),/disposed/i);await synth.start();assert.equal(nodes.length,6);assert(synth.isReady());
});

test('MSX starts only AY and OPLL, without loading or routing an MSX Audio Y8950',async t=>{
  const {synth,nodes,fetches,moduleLoads}=harness(t,'msx',{oplOptions:{wasmUrl:'https://unused.test/y8950.wasm',workletUrl:'https://unused.test/opl.js'}});assert.equal(nodes.length,0);await Promise.all([synth.start(),synth.start()]);
  assert.equal(nodes.length,2);assert.deepEqual(synth.primaryEndpoints.map(endpoint=>[endpoint.name,endpoint.globalName]),[['ay8910','ay'],['ym2413','opll']]);assert.deepEqual(synth.mixer.list().filter(row=>row.connected).map(row=>row.id),['ay8910','ym2413']);assert.equal(synth.opl,null);assert.equal(synth.primaryApis.opl,undefined);assert(!fetches.some(url=>url.includes('y8950')));assert(!moduleLoads.some(url=>url.includes('opl.js')||url.includes('playground_opl_worklet')));
  synth.ay.setVolume(2,7,true);synth.ay.setEnvelope({period:1234,shape:10});synth.opll.setInstrument(8,4,3);await synth.stopAllNative();assert.equal(synth.ay._getState().levels[2],23);assert.equal(synth.opll.getRegisterSnapshot()[0x38],0x43);assert(nodes.every(node=>node.messages.some(message=>message.method==='stopVoices')));await synth.close();await synth.start();assert.equal(nodes.length,4);assert.equal(synth.primaryEndpoints.length,2);
});

test('Atari ST primary forwards a fixed YM2149 profile at 2 MHz, and Worker handoff preserves pitch and Stop',async t=>{
  const profile={clock:2000000,type:0x10,flags:1};
  const {synth,nodes}=harness(t,'ay8910',profile);await synth.start();
  assert.equal(nodes.length,1);assert.deepEqual(synth.primaryEndpoints.map(endpoint=>endpoint.name),['ay8910']);
  assert.deepEqual(Object.fromEntries(['clock','type','flags'].map(key=>[key,nodes[0].options.processorOptions[key]])),profile);
  assert.equal(synth.primaryEndpoints[0].type,0x10);assert.equal(synth.primaryEndpoints[0].flags,1);
  assert.equal(synth.ay.clock,2000000);synth.ay.setVoice(2,{tone:true,noise:false,volume:11});synth.ay.noteOn(2,'A4');
  const before=synth.ay._getState();assert.equal(before.registers[4]|before.registers[5]<<8,284,'A4 uses the Atari ST clock');
  const channel=new MessageChannel(),messages=[];channel.port1.onmessage=({data})=>messages.push(data);channel.port1.start();
  const worker=createNativePrimaryClient('ay8910',channel.port2,{clock:synth.ay.clock,state:before});
  t.after(()=>{worker.dispose();channel.port1.close();});
  await immediate();assert.deepEqual(messages,[]);assert.deepEqual(worker._getState(),before);
  worker.noteOn(0,'A4');await until(()=>messages.length>0);assert.equal(worker.clock,2000000);
  await synth.stopAllNative();assert(nodes[0].messages.some(message=>message.method==='stopVoices'&&message.id!==undefined));
  assert.deepEqual(synth.ay._getState().levels,before.levels);assert(synth.ay._getState().registers.slice(8,11).every(value=>value===0));
  await synth.close();await synth.start();assert.equal(nodes.length,2);
  assert.deepEqual(Object.fromEntries(['clock','type','flags'].map(key=>[key,nodes[1].options.processorOptions[key]])),profile);
});
for(const stage of ['fetch','module','ready'])test(`YM2149 close during ${stage} cancels initialization and preserves its profile on restart`,async t=>{
  const {synth,nodes,gate,reached}=harness(t,'ay8910',{clock:2000000,type:0x10,flags:1,stage});
  const canceled=assert.rejects(synth.start(),{name:'AbortError'});await until(reached);await synth.close();await canceled;gate.resolve();
  assert(nodes.every(node=>node.port.closed&&!node.connections.length));await synth.start();assert(synth.isReady());
  assert.equal(nodes.at(-1).options.processorOptions.type,0x10);assert.equal(synth.ay.clock,2000000);
});
for(const profile of [{type:17,flags:1},{type:16,flags:2},{type:0,flags:17}])test(`unsupported AY profile ${JSON.stringify(profile)} fails before assets or nodes load`,async t=>{
  const {synth,nodes,fetches,moduleLoads}=harness(t,'ay8910',{clock:2000000,...profile});
  await assert.rejects(synth.start(),/Support coming soon/);assert.deepEqual(nodes,[]);assert.deepEqual(fetches,[]);assert.deepEqual(moduleLoads,[]);
});
for(const mode of ['msx','msx-audio'])test(`${mode} keeps the original AY-3-8910 profile`,async t=>{
  const {synth,nodes}=harness(t,mode);await synth.start();
  assert.equal(nodes[0].options.processorOptions.clock,1789773);assert.equal(nodes[0].options.processorOptions.type,0);assert.equal(nodes[0].options.processorOptions.flags,1);
});
for(const target of ['ay8910','ym2413'])for(const stage of ['fetch','module','ready'])test(`MSX close during ${target} ${stage} releases its two-device setup and restarts without Y8950`,async t=>{
  const {synth,nodes,gate,reached}=harness(t,'msx',{target,stage});const canceled=assert.rejects(synth.start(),{name:'AbortError'});await until(reached);assert.equal(synth.primaryEndpoints.length,['ay8910','ym2413'].indexOf(target));await synth.close();await canceled;gate.resolve();assert(nodes.every(node=>node.port.closed&&!node.connections.length));await synth.start();assert.equal(synth.primaryEndpoints.length,2);assert(synth.ay&&synth.opll);assert.equal(synth.opl,null);
});

test('PS1 primary handoff retains authored24voice bank and Stop awaits the remote silence fence',async t=>{
 const {synth,nodes}=harness(t,'ps1');await synth.start();assert.equal(synth.primaryApis.spu,synth.spu);assert.equal(synth.spu._getState().samples.length,1);assert.equal(synth.spu._getState().channels.length,24);synth.spu.noteOn(23,60);const state=await synth.spu.getState(),channel=new MessageChannel(),posts=[];channel.port1.onmessage=({data})=>posts.push(data);channel.port1.start();const worker=createNativePrimaryClient('ps1',channel.port2,{sampleRate:48000,state});t.after(()=>{worker.dispose();channel.port1.close();});await immediate();assert.equal(posts.length,0,'statehandoffcannotresetorreplayRAM');assert.equal(worker._getState().channels[23].sample,0);await synth.stopAllNative();assert.equal(nodes[0].validation.gates[23],false);assert(nodes[0].messages.some(m=>m.method==='stopVoices'&&m.id!==undefined));assert.equal((await synth.spu.getState()).channels[23].pitch,state.channels[23].pitch);worker.noteOn(23,67);await immediate();assert.equal(posts.at(-1).method,'noteOn');
});

test('PS1 fatal processor failure releases its route/client and permits restart with a fresh bank',async t=>{
 const{nodes,synth}=harness(t,'ps1');await synth.start();const old=synth.spu,pending=old.snapshot();nodes[0].onprocessorerror();await pending.catch(()=>{});assert.equal(synth.isReady(),false);assert.equal(synth.state,'error');assert.equal(synth.primaryEndpoints.length,0);assert.throws(()=>old.keyOff(0),/disposed/);assert.equal(synth.mixer.list().filter(row=>row.connected).length,0);await synth.start();assert.equal(synth.isReady(),true);assert.notEqual(synth.spu,old);assert.equal(synth.spu._getState().samples.length,1);
});
