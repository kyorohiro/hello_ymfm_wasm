import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSynthPcmSongInteraction,patchSynthPcmSongSnapshotEdit} from './synth_song_pcm_interaction.js';
import {createPcmSongTimeline} from './synth_song_pcm_state.js';
import {Rf5c164} from '../js/rf5c164.js';
import pcmFactory from '../generated/rf5c164_wasm.js';

function fake() {
  const writes=[],memory=[];let resets=0;
  const engine={writeRf5c164:(...args)=>writes.push(args),writeRf5c164Memory:(...args)=>memory.push(args),
    loadRf5c164Memory:(data,offset)=>memory.push([data.slice(),offset]),clearRf5c164Memory(){},
    processFrames:frames=>frames,reset(){resets++;}};
  const original={...engine},timeline=createPcmSongTimeline(engine),hand=createSynthPcmSongInteraction(engine);
  return {engine,timeline,hand,writes,memory,original,get resets(){return resets;},dispose(){hand.dispose();timeline.dispose();}};
}
const pitch={block:4,fnum:1100};
const stepFor=(base,note=pitch,bend=0)=>Math.max(1,Math.min(65535,Math.round(base*note.fnum*7670454*2**(note.block-1)/(144*2**20)/261.6255653005986*2**(bend/12))));
const current=(host,channel=0)=>host.hand.read().channels[channel];
const edit=(host,changes,channel=0)=>host.hand.applyEdit({channel,changes});
const writes=(host,values)=>values.forEach(([register,value])=>host.engine.writeRf5c164(register,value));
function sample() {
  const data=new Uint8Array(112).fill(255);
  for(let index=0;index<64;index++)data[index]=index<32?0x90+index:0x30+index;
  return data;
}
function prepare(host,channels=[0]) {
  host.engine.writeRf5c164(7,0x82);host.engine.loadRf5c164Memory(sample(),0);
  for(const channel of channels)writes(host,[[7,0xc0|channel],[0,96],[1,0x8f],[2,0],[3,8],[4,0],[5,0x20],[6,0x20]]);
  writes(host,[[8,0xfe],[7,0xc5],[7,0x82]]);
}

test('construction, reading and empty edits neither reset nor initialize the reference PCM',()=>{
  const host=fake();try {
    assert.equal(host.resets,0);assert.deepEqual(host.writes,[]);
    assert.equal(host.hand.applyEdit({channel:0,changes:{}}),false);assert.equal(host.hand.applySettings(0,{}),false);
    assert.equal(host.hand.releaseKeyboard(),false);assert.equal(host.hand.read().ram,undefined,'revision reads stay small');
    assert.equal(host.hand.describe(0).playable,false);assert.deepEqual(host.writes,[]);
  } finally {host.dispose();}
});

test('sparse Pan and 16-bit Step edits preserve the latest channel fields and physical selectors',()=>{
  const host=fake();try {
    prepare(host);const frozen=host.timeline.read(0);host.engine.processFrames(100);
    writes(host,[[7,0xc0],[1,0xa9],[2,0x37],[3,0x21],[7,0xc5],[7,0x82]]);
    const from=host.writes.length;edit(host,{panLeft:3,step:0x129a});
    assert.deepEqual(host.writes.slice(from),[[7,0xc0],[1,0xa3],[2,0x9a],[3,0x12],[7,0xc5],[7,0x82]]);
    assert.equal(current(host).panRight,10);assert.equal(current(host).step,0x129a);
    const state=host.hand.read();assert.equal(state.selectedChannel,5);assert.equal(state.bank,0x2000);assert.equal(state.enabled,true);
    const shown=host.hand.readSnapshot(frozen,0,{frozen:true});
    assert.equal(shown.channels[0].panLeft,3);assert.equal(shown.channels[0].panRight,8,'untouched field stays frozen');
    assert.equal(shown.channels[0].step,0x129a);assert.equal(shown.ram,frozen.ram);assert.equal(shown.known,frozen.known);
    writes(host,[[7,0xc0],[3,0x34]]);assert.equal(current(host).step,0x349a,'source high byte preserves the current manual low byte');
    assert.equal(current(host).referenceStep,0x349a);
  } finally {host.dispose();}
});

test('manual selection restores both channel and bank before the following source register and RAM writes',()=>{
  const host=fake();try {
    prepare(host);edit(host,{volume:71},2);
    host.engine.writeRf5c164(0,83);host.engine.writeRf5c164Memory(0x23,0xab);
    host.engine.loadRf5c164Memory(Uint8Array.of(0xb1,0xb2),0x100);
    const state=host.hand.read({includeRam:true});
    assert.equal(state.channels[2].volume,71);assert.equal(state.channels[5].volume,83);
    assert.equal(state.ram[0x2023],0xab);assert.equal(state.ram[0x2100],0xb1);assert.equal(state.ram[0x2101],0xb2);
    assert.equal(state.known[0x23],0);assert.equal(state.selectedChannel,5);assert.equal(state.bank,0x2000);
    writes(host,[[7,0x84],[7,0xc6]]);const from=host.writes.length;edit(host,{panRight:7},1);
    assert.deepEqual(host.writes.slice(from),[[7,0xc1],[1,0x70],[7,0xc6]],'channel-mode restore does not disturb the bank');
    assert.equal(host.hand.read().bank,0x4000);
  } finally {host.dispose();}
});

test('invalid compound controls and notes fail atomically without selecting a channel',()=>{
  const host=fake();try {
    for(const changes of [{volume:80,panRight:16},{panLeft:3,step:65536},{volume:2,start:0}])assert.throws(()=>edit(host,changes));
    assert.throws(()=>host.hand.applySettings(1,{volume:1,step:-1}));
    assert.throws(()=>host.hand.noteOn('a',pitch,{channel:8}));assert.throws(()=>host.hand.noteOn('a',{block:4,fnum:0},{channel:0}));
    assert.throws(()=>host.hand.noteOn('a',pitch,{channel:0}),/disabled/);assert.deepEqual(host.writes,[]);
  } finally {host.dispose();}
});

test('manual gate masks preserve every other channel and old key-up cannot release a replacement',()=>{
  const host=fake();try {
    prepare(host,[0,3]);const from=host.writes.length;
    host.hand.noteOn('old',pitch,{channel:3});
    assert.equal(host.hand.read().channelMask,0xf6);assert.equal(current(host,0).keyOn,true);
    assert.deepEqual(host.writes.slice(from).filter(([reg])=>reg===8),[[8,0xfe],[8,0xf6]]);
    const value=host.hand.noteOn('new',{...pitch,fnum:900},{channel:3});assert.equal(value.stolenId,'old');
    const before=host.writes.length;assert.equal(host.hand.noteOff('old'),false);assert.equal(host.writes.length,before);
    assert.equal(host.hand.noteOff('new'),true);assert.equal(host.hand.read().channelMask,0xfe);assert.equal(current(host,0).keyOn,true);
  } finally {host.dispose();}
});

test('source full gate masks, sample addresses and global disable retire stale hand gate owners',()=>{
  for(const source of [[[8,0xfe]],[[7,0xc0],[6,0x20]],[[7,0xc0],[4,0]],[[7,0xc0],[5,0x20]],[[7,0x02]]]) {
    const host=fake();try {
      prepare(host);host.hand.noteOn('a',pitch,{channel:0});writes(host,source);const before=host.writes.length;
      assert.equal(host.hand.noteOff('a'),false);host.hand.setPitch(0);host.hand.releaseKeyboard();assert.equal(host.writes.length,before);
    } finally {host.dispose();}
  }
});

test('source Step takes pitch only, while source volume, Pan and sample RAM keep the hand key-up usable',()=>{
  const host=fake();try {
    prepare(host);host.hand.noteOn('a',pitch,{channel:0});host.hand.setPitch(2);
    writes(host,[[7,0xc0],[2,0x23],[3,9],[0,88],[1,0x95],[7,0x82]]);
    host.engine.writeRf5c164Memory(0x20,0x91);const before=host.writes.length;
    host.hand.setPitch(0);assert.equal(host.writes.length,before);assert.equal(current(host).step,0x923);
    assert.equal(host.hand.noteOff('a'),true);assert.equal(host.writes.at(-1)[0],8);assert.equal(host.hand.read().channelMask,255);
    assert.equal(current(host).volume,88);assert.equal(current(host).panLeft,5);assert.equal(current(host).panRight,9);
  } finally {host.dispose();}
});

test('keyboard uses a stable recorded C4 Step across retriggers and includes the current Pitch exactly once',()=>{
  const host=fake();try {
    prepare(host);host.hand.setPitch(2);const first=host.hand.noteOn('a',pitch,{channel:0});
    assert.equal(first.step,stepFor(2048,pitch,2));assert.equal(first.baseStep,2048);
    host.hand.noteOff('a');const secondPitch={block:5,fnum:900},second=host.hand.noteOn('b',secondPitch,{channel:0});
    assert.equal(second.step,stepFor(2048,secondPitch,2));assert.equal(second.baseStep,2048);
    const frozen=host.timeline.read(0),shown=host.hand.readSnapshot(frozen,0,{frozen:true});
    assert.equal(shown.channels[0].referenceStep,2048);assert.equal(shown.ram,frozen.ram);assert.equal(shown.known,frozen.known);
    edit(host,{step:3000});const before=host.writes.length;host.hand.setPitch(0);
    assert.equal(host.writes.length,before,'raw Step edit defeats a stale Pitch cleanup');host.hand.noteOff('b');
    const third=host.hand.noteOn('c',pitch,{channel:0});assert.equal(third.step,stepFor(3000));assert.equal(third.baseStep,3000);
  } finally {host.dispose();}
});

test('playability explains global, level, Pan, Step and unknown sample RAM without enabling or unmuting anything',()=>{
  const host=fake();try {
    prepare(host);assert(host.hand.describe(0).playable);
    edit(host,{volume:0});assert.match(host.hand.describe(0).reason,/volume/);
    edit(host,{volume:96,panLeft:0,panRight:0});assert.match(host.hand.describe(0).reason,/pan/);
    edit(host,{panLeft:15,step:0});assert.match(host.hand.describe(0).reason,/step/);
    edit(host,{step:2048});writes(host,[[7,0xc0],[6,0x60]]);assert.match(host.hand.describe(0).reason,/not prepared/);
    host.engine.writeRf5c164(7,0x02);assert.match(host.hand.describe(0).reason,/disabled/);
  } finally {host.dispose();}
});

test('a frozen nonzero raw Step cannot hide a new zero C4 reference or enable the keyboard',()=>{
  const host=fake();try {
    prepare(host);const frozen=host.timeline.read(0);host.engine.processFrames(100);
    writes(host,[[7,0xc0],[2,0],[3,0]]);
    const shown=host.hand.readSnapshot(frozen,100,{frozen:true});
    assert.equal(shown.channels[0].step,2048,'the observed hardware field stays frozen');
    assert.equal(shown.channels[0].referenceStep,0,'the keyboard reference is the new unavailable source speed');
    assert.equal(shown.ram,frozen.ram);assert.equal(shown.known,frozen.known);
    assert.equal(host.hand.read().channels[0].referenceStep,0);assert.equal(host.hand.describe(0).playable,false);
  } finally {host.dispose();}
});

test('native-direct sample checks support known disjoint loops and known address wrapping',()=>{
  const host=fake();try {
    prepare(host);writes(host,[[7,0x84]]);host.engine.loadRf5c164Memory(Uint8Array.of(0x91,0x92,255),0);
    writes(host,[[7,0xc0],[4,0],[5,0x40]]);assert(host.hand.describe(0).playable,'disjoint known loop is native-valid');
    writes(host,[[7,0x8f]]);host.engine.loadRf5c164Memory(new Uint8Array(256).fill(0x91),0xf00);
    writes(host,[[7,0x80]]);host.engine.loadRf5c164Memory(Uint8Array.of(0x92,0x93,255),0);
    writes(host,[[7,0xc0],[6,255],[4,0],[5,0x40]]);assert(host.hand.describe(0).playable,'native addresses may wrap the 64KiB boundary');
    writes(host,[[7,0x84]]);host.engine.loadRf5c164Memory(Uint8Array.of(255),0);
    assert(host.hand.describe(0).playable,'an END loop target is a valid one-shot stop');
  } finally {host.dispose();}
});

test('pending edits are bounded and never copy the large consumed sample views',()=>{
  const host=fake();try {
    prepare(host);const frozen=host.timeline.read(0),ram=frozen.ram,known=frozen.known;host.engine.processFrames(100);
    for(let index=0;index<1000;index++)edit(host,{volume:index%256});
    assert.equal(host.hand.read().pendingDisplayEdits,1);
    const shown=host.hand.readSnapshot(frozen,200,{frozen:true});assert.equal(shown.channels[0].volume,231);
    assert.equal(shown.ram,ram);assert.equal(shown.known,known);
    const patched=patchSynthPcmSongSnapshotEdit(frozen,{channel:7,changes:{step:1234,panRight:12}});
    assert.equal(patched.ram,ram);assert.equal(patched.known,known);assert.equal(patched.channels[7].sampleRateHz,12500000/384*1234/2048);
  } finally {host.dispose();}
});

test('opaque seek metadata restores pending channel/bank routing and native reset preserves tracked RAM',()=>{
  const host=fake();try {
    prepare(host);host.engine.processFrames(400);const saved=host.hand.saveState(),ram=host.hand.read({includeRam:true}).ram;
    edit(host,{step:3000,panRight:0},4);host.hand.noteOn('a',pitch,{channel:0});
    host.hand.loadState(saved);assert.deepEqual(host.hand.read().voices,[]);assert.equal(host.hand.generatedFrames,400);
    assert.equal(host.hand.read().selectedChannel,5);assert.equal(host.hand.read().bank,0x2000);assert.equal(current(host,4).step,0);
    host.engine.reset();const next=host.hand.read({includeRam:true});assert.deepEqual(next.ram,ram);assert.equal(next.enabled,false);assert.equal(next.channelMask,255);
    assert.equal(host.hand.generatedFrames,0);assert.equal(next.selectedChannel,0);assert.equal(next.bank,0);
    assert.throws(()=>host.hand.loadState({...saved,known:new Uint8Array(2)}));assert.equal(host.hand.read().enabled,false);
  } finally {host.dispose();}
});

test('disposal unwraps only this helper without a reset or a late hand release',()=>{
  const host=fake();prepare(host);const originalWrite=host.engine.writeRf5c164;
  host.hand.dispose();assert.notEqual(host.engine.writeRf5c164,originalWrite);assert.equal(host.resets,0);
  assert.throws(()=>host.hand.noteOff('a'),/disposed/);assert.throws(()=>host.hand.applyEdit({channel:0,changes:{volume:1}}),/disposed/);
  host.timeline.dispose();assert.equal(host.engine.writeRf5c164,host.original.writeRf5c164);
});

async function nativeHost() {
  const chip=await Rf5c164.create({moduleFactory:pcmFactory,moduleOptions:{wasmBinary:await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url))},sampleRate:53267});
  const engine={writeRf5c164:(r,v)=>chip.writeRegister(r,v),writeRf5c164Memory:(a,v)=>chip.writeMemory(a,v),
    loadRf5c164Memory:(data,offset)=>chip.loadBankedMemory(data,offset),clearRf5c164Memory:()=>chip.clearMemory(),
    processFrames:frames=>chip.generateStereo(frames),reset:()=>chip.reset()};
  return {chip,engine};
}
function equalPcm(actual,expected) {assert.deepEqual(actual.left,expected.left);assert.deepEqual(actual.right,expected.right);}

test('actual WASM manual Pan/Step and subsequent register/RAM writes equal an independent direct-register oracle',async()=>{
  const a=await nativeHost(),b=await nativeHost(),timeline=createPcmSongTimeline(a.engine),hand=createSynthPcmSongInteraction(a.engine);
  try {
    prepare(a);prepare(b);equalPcm(a.engine.processFrames(257),b.engine.processFrames(257));
    hand.applyEdit({channel:0,changes:{volume:83,panLeft:3,step:3000}});
    writes(b,[[7,0xc0],[0,83],[1,0x83],[2,3000&255],[3,3000>>8],[7,0xc5],[7,0x82]]);
    a.engine.writeRf5c164Memory(0x23,0xd0);b.engine.writeRf5c164Memory(0x23,0xd0);
    a.engine.writeRf5c164(0,17);b.engine.writeRf5c164(0,17);
    equalPcm(a.engine.processFrames(8192),b.engine.processFrames(8192));
    assert.equal(a.chip.readMemory(0x2023),0xd0);assert.equal(b.chip.readMemory(0x2023),0xd0);
    assert.equal(hand.read().channels[5].volume,17);assert.equal(hand.describe(0).playable,true);
  } finally {hand.dispose();timeline.dispose();a.chip.dispose();b.chip.dispose();}
});

test('actual WASM same-engine keyboard retrigger preserves another sounding channel and source takeover',async()=>{
  const a=await nativeHost(),b=await nativeHost(),hand=createSynthPcmSongInteraction(a.engine);
  try {
    prepare(a,[0,3]);prepare(b,[0,3]);equalPcm(a.engine.processFrames(123),b.engine.processFrames(123));
    hand.noteOn('a',pitch,{channel:3});const step=stepFor(2048);
    writes(b,[[8,0xfe],[7,0xc3],[2,step&255],[3,step>>8],[7,0xc5],[7,0x82],[8,0xf6]]);
    equalPcm(a.engine.processFrames(4096),b.engine.processFrames(4096));
    a.engine.writeRf5c164(8,0xfe);b.engine.writeRf5c164(8,0xfe);
    assert.equal(hand.noteOff('a'),false);hand.setPitch(0);
    equalPcm(a.engine.processFrames(4096),b.engine.processFrames(4096));
    assert.equal(hand.read().channels[0].keyOn,true);
  } finally {hand.dispose();a.chip.dispose();b.chip.dispose();}
});
