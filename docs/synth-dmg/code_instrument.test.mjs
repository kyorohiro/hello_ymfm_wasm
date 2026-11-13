import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyInstrument} from './instrument.js';
import {waveShape} from './preset.js';
import {createGameboyCodeClient} from './code_endpoint.js';

const wasmBinary = await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
async function fixture(t, source = 'wave') {
  const core = await GameboyApu.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000});
  const writes = [], original = core.writeRegister.bind(core);
  core.writeRegister = (...args) => {writes.push(args);return original(...args);};
  const instrument = new GameboyInstrument(core);
  const preset = instrument.read().preset;
  preset.name = 'Original editable Wave'; preset.source = source;
  preset.wave.samples = waveShape('square'); preset.wave.level = .25;
  preset.pulse.duty = .125; preset.pulse.volume = 7;
  preset.noise = {volume:6,envelope:{direction:'up',period:2},divisor:5,shift:3,width:7};
  preset.pan = {left:false,right:true};
  instrument.loadPreset(preset);
  t.after(() => instrument.dispose());
  return {core,instrument,writes,preset};
}
function audible(pcm) {
  for (const side of [pcm.left,pcm.right]) {assert(side.every(Number.isFinite));assert(side.some(value => Math.abs(value) > .0001));}
}
function createClient(instrument, metadata) {
  return createGameboyCodeClient({metadata,
    isCurrent:() => instrument.codeActive && instrument.codeEpoch === metadata.session,
    invoke:(method,args) => instrument.code(metadata.session,method,args),
    dispose:() => instrument.code(metadata.session,'dispose'),
  });
}

test('one actual APU serves all four Code channels and restores the exact stopped author checkpoint, including Wave RAM', async t => {
  const {core,instrument,writes,preset} = await fixture(t);
  instrument.noteOn('keyboard',60); instrument.generateStereo(2345);
  const handle = core.handle, metadata = instrument.beginCode();
  assert.equal(metadata.editorSource,'wave'); assert.equal(metadata.channels,4);
  assert.deepEqual(instrument.read().voices,[]);
  assert.equal(instrument.noteOff('keyboard'),false);
  const authored = instrument.read(), nativeReference = core.saveState();
  const expected = core.generateStereo(2048); core.loadState(nativeReference);
  const client = createClient(instrument,metadata);
  await client.pulse.setVoice(0,{duty:.25,volume:8,envelope:{direction:'down',period:0}});
  await client.pulse.setVoice(1,{duty:.75,volume:6,envelope:{direction:'up',period:0}});
  await client.pulse.noteOn(0,'C4'); await client.pulse.noteOn(1,'E4');
  await client.wave.stopAndSetWaveform(waveShape('saw')); await client.wave.setLevel(1); await client.wave.noteOn('G3');
  await client.noise.setVoice({volume:7,envelope:{direction:'down',period:0},divisor:2,shift:3,width:15}); await client.noise.keyOn();
  for (let ch = 0; ch < 4; ch++) await client.setPan(ch,true,true);
  audible(instrument.generateStereo(4096));
  const live = instrument.observeCode();
  assert.equal(live.positionFrames,4096); assert.equal(live.registers.length,48); assert.equal(live.voice.length,48);
  assert.equal(live.registers[2] >> 4,8); assert.equal(live.registers[7] >> 4,6);
  assert.equal(live.registers[10] & 128,128); assert.equal(live.registers[17] >> 4,7);
  assert.equal(live.activeMask,null); assert.equal(live.observation.hardwareEnvelope,false); assert.equal(live.observation.hardwareSweep,false);
  assert.notDeepEqual(live.registers.slice(32),authored.registers.slice(32));
  assert.deepEqual(instrument.read(),authored,'Code changes must never replace the editable preset or its author readback');
  const count = writes.length; instrument.observeCode();
  assert.equal(writes.length,count,'read-only Live never clocks or writes the APU');
  live.registers[32] = 123; live.voice[32] = 123;
  assert.notEqual(instrument.observeCode().registers[32],123);
  assert.deepEqual(await client.getState(),{...instrument.synth._getState(),editorSource:'wave',positionFrames:4096});
  instrument.stop();
  assert.equal(core.handle,handle); assert.equal(instrument.observeCode(),null);
  assert.deepEqual(instrument.read(),authored);
  assert.deepEqual(instrument.read().preset,preset);
  assert.deepEqual(instrument.generateStereo(2048),expected,'opaque native checkpoint restores oscillator/envelope/PCM history, not merely visible registers');
  assert.throws(() => client.wave.keyOn(),{name:'AbortError'});
  instrument.noteOn('new-keyboard',64);
  const next = instrument.generateStereo(2048); assert(next.right.some(value => Math.abs(value) > .0001));
  assert(next.left.every(value => Math.abs(value) < .0001),'original right-only pan is restored');
});

test('Code initialize/reset retain the public hardware semantics, while Stop alone restores the saved instrument', async t => {
  const {instrument,preset} = await fixture(t);
  const metadata = instrument.beginCode(), client = createClient(instrument,metadata);
  await client.initialize();
  let state = await client.getState();
  assert.equal(state.initialized,true); assert.equal(state.registers[22] & 128,128);
  assert.notDeepEqual(state.registers.slice(32),instrument.read().registers.slice(32),'initialize selects the library default waveform, not the edited bank');
  await client.reset(); state = await client.getState();
  assert.equal(state.initialized,false); assert(state.registers.every(value => value === 0));
  await assert.rejects(client.pulse.noteOn(0,'C4'),/initialize/);
  await client.initialize(); await client.pulse.noteOn(0,'E4'); audible(instrument.generateStereo(1024));
  assert.equal(await client.setClock(4194304),4194304);
  assert.throws(() => client.setClock(2000000),/fixed/);
  instrument.stop(); assert.deepEqual(instrument.read().preset,preset);
  assert.deepEqual(instrument.synth._getState().registers.slice(32),instrument.read().registers.slice(32));
});

test('invalid calls, preset validation failure and stale keyboard releases cannot mutate the active Code owner', async t => {
  const {core,instrument,writes} = await fixture(t,'pulse');
  const metadata = instrument.beginCode(), client = createClient(instrument,metadata);
  await client.pulse.noteOn(0,'C4'); instrument.generateStereo(2048);
  const state = await client.getState(), beforeWrites = writes.length;
  for (const callback of [() => client.pulse.noteOn(2,'C4'),() => client.noteOn(3,'C4'),
    () => client.pulse.noteOn(0,'C0'),() => client.setFrequency(0,NaN),() => client.wave.setNote('C0')]) assert.throws(callback);
  for (const [method,args] of [['pulse.setVoice',[0,{duty:.3,volume:15}]],['wave.stopAndSetWaveform',[Array(32).fill(16)]],
    ['noise.setVoice',[{volume:9,width:8}]],['constructor',[]]]) assert.throws(() => instrument.code(metadata.session,method,args));
  const invalid = structuredClone(instrument.read().preset); invalid.wave.samples[3] = 16;
  assert.throws(() => instrument.setPreset(invalid)); assert.throws(() => instrument.loadPreset(invalid));
  assert.throws(() => instrument.noteOn('invalid-key',128),{name:'RangeError'});
  assert.throws(() => instrument.setPitch(25),{name:'RangeError'});
  assert.equal(instrument.noteOff('old-key'),false);
  assert.equal(writes.length,beforeWrites); assert.deepEqual(await client.getState(),state); assert(client.isCurrent());
  const native = core.saveState(), expected = core.generateStereo(1024); core.loadState(native);
  assert.throws(() => instrument.code(metadata.session,'wave.stopAndSetWaveform',[Array(31).fill(0)]));
  assert.deepEqual(instrument.generateStereo(1024),expected,'validation does not advance or rewrite native PCM state');
});

test('disposing the borrowed client restores the author, rejects old calls and permits a new lease without a new APU', async t => {
  const {core,instrument,preset} = await fixture(t,'noise');
  const metadata = instrument.beginCode(), client = createClient(instrument,metadata), handle = core.handle;
  await client.noise.setVoice({volume:15,divisor:0,shift:0,width:15}); await client.noise.keyOn(); instrument.generateStereo(2000);
  const disposed = client.dispose(); assert.equal(client.dispose(),disposed); await disposed;
  assert(!client.isCurrent()); assert.throws(() => client.keyOn(0),{name:'AbortError'});
  assert.equal(core.handle,handle); assert.deepEqual(instrument.read().preset,preset); assert.equal(instrument.observeCode(),null);
  const nextMetadata = instrument.beginCode(); assert(nextMetadata.session > metadata.session);
  const next = createClient(instrument,nextMetadata);
  await next.noise.keyOn();
  assert.throws(() => instrument.code(metadata.session,'reset'),{name:'AbortError'});
  assert.equal(instrument.observeCode().registers[17] >> 4,preset.noise.volume);
  const pcm = instrument.generateStereo(2000); assert(pcm.right.some(value => Math.abs(value) > .0001));
  assert.equal(core.handle,handle);
});

test('a live Code preset preserves the client/session, physical pitches and elapsed frames, then Stop keeps the newest editor sound',async t=>{
  const {core,instrument,preset}=await fixture(t,'pulse'),metadata=instrument.beginCode(),client=createClient(instrument,metadata),handle=core.handle;
  await client.pulse.noteOn(0,'C4');await client.pulse.noteOn(1,'E4');await client.wave.noteOn('G3');await client.noise.keyOn();instrument.generateStereo(3000);
  const before=await client.getState(),next=structuredClone(preset);next.name='Live selected Wave';next.source='wave';next.pulse.duty=.75;next.pulse.volume=11;next.noise.width=15;next.pan={left:true,right:true};
  const epoch=instrument.codeEpoch,frames=instrument.codeFrames;instrument.applyCodePreset(metadata.session,next);
  assert.equal(core.handle,handle);assert.equal(instrument.codeEpoch,epoch);assert.equal(instrument.codeFrames,frames);assert(client.isCurrent());
  const live=await client.getState();assert.equal(live.editorSource,'wave');for(const index of [3,4,8,9,13,14])assert.equal(live.registers[index],before.registers[index],'preserve programmed frequency/trigger register '+index);
  assert.equal(live.registers[10]&128,128,'unchanged Wave RAM keeps its live DAC gate');assert.equal(live.voice[1]>>6,3);assert.equal(live.voice[2]>>4,11);
  assert.deepEqual(instrument.read().preset,next);audible(instrument.generateStereo(2048));
  await client.pulse.noteOn(0,'D4');assert(client.isCurrent());instrument.stop();assert.deepEqual(instrument.read().preset,next);assert.equal(instrument.read().pitch,0);
  assert.deepEqual(instrument.synth._getState().registers.slice(32,48),Array.from({length:16},(_,i)=>(next.wave.samples[i*2]<<4)|next.wave.samples[i*2+1]));
  instrument.noteOn('after-stop',60);audible(instrument.generateStereo(2048));
});

test('live Wave replacement may release Wave without retiring Code; failure restores exact native PCM, shadow and old Stop checkpoint',async t=>{
  const {core,instrument,preset,writes}=await fixture(t),metadata=instrument.beginCode(),client=createClient(instrument,metadata);
  await client.wave.noteOn('C4');await client.pulse.noteOn(0,'E4');instrument.generateStereo(1000);
  const next=structuredClone(preset);next.name='New Wave';next.wave.samples=waveShape('saw');next.pan={left:true,right:true};
  instrument.applyCodePreset(metadata.session,next);assert(client.isCurrent());assert.equal((await client.getState()).registers[10]&128,0);
  await client.wave.keyOn();audible(instrument.generateStereo(1000));
  const before=await client.getState(),beforePreset=instrument.read().preset,checkpoint=instrument.codeCheckpoint,frames=instrument.codeFrames;
  const native=core.saveState(),expected=core.generateStereo(2048);core.loadState(native);
  const originalWrite=core.writeRegister,originalLoad=core.loadState;let loads=0,liveWrites=0;
  core.loadState=function(...args){loads++;return originalLoad.apply(this,args);};
  core.writeRegister=function(...args){if(loads===2&&++liveWrites===2)throw Error('Injected live patch failure');return originalWrite.apply(this,args);};
  const failing=structuredClone(next);failing.pulse.duty=.25;
  try{assert.throws(()=>instrument.applyCodePreset(metadata.session,failing),/Injected live patch failure/);}finally{core.writeRegister=originalWrite;core.loadState=originalLoad;}
  assert.deepEqual(await client.getState(),before);assert.deepEqual(instrument.read().preset,beforePreset);assert.equal(instrument.codeCheckpoint,checkpoint);assert.equal(instrument.codeFrames,frames);assert.deepEqual(instrument.generateStereo(2048),expected);
  const invalid=structuredClone(next);invalid.wave.samples[0]=16;const count=writes.length;assert.throws(()=>instrument.applyCodePreset(metadata.session,invalid));assert.equal(writes.length,count);
  instrument.stop();assert.deepEqual(instrument.read().preset,next);assert.throws(()=>instrument.applyCodePreset(metadata.session,preset),{name:'AbortError'});
});

test('reselecting identical Code voice settings preserves native envelope/oscillator history sample-exactly',async t=>{
  const {core,instrument,preset}=await fixture(t,'pulse'),metadata=instrument.beginCode(),client=createClient(instrument,metadata);
  await client.pulse.noteOn(0,'C4');await client.noise.keyOn();instrument.generateStereo(4567);
  const native=core.saveState(),expected=core.generateStereo(4096);core.loadState(native);
  const selected=structuredClone(preset);selected.name='Only the editor name changes';
  instrument.applyCodePreset(metadata.session,selected);
  assert.deepEqual(instrument.generateStereo(4096),expected,'checkpoint preparation must not advance or retrigger the running APU');
  assert(client.isCurrent());assert.equal((await client.getState()).positionFrames,8663);instrument.stop();assert.equal(instrument.read().preset.name,selected.name);
});
