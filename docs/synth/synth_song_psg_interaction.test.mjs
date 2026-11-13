import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSynthPsgSongInteraction,patchSynthPsgSongSnapshotEdit} from './synth_song_psg_interaction.js';
import {createPsgSongTimeline} from './synth_song_psg_state.js';
import {SegaPSG} from '../js/segapsg.js';
import psgFactory from '../generated/segapsg_wasm.js';

function fake() {
  const writes=[];let resets=0;
  const engine={writePsg(value){writes.push(value);},processFrames(frames){return frames;},reset(){resets++;}};
  const original={...engine},timeline=createPsgSongTimeline(engine),hand=createSynthPsgSongInteraction(engine);
  return {engine,original,timeline,hand,writes,get resets(){return resets;},dispose(){hand.dispose();timeline.dispose();}};
}
const edit=(host,changes,channel=0)=>host.hand.applyEdit({channel,changes});
const voice=(host,channel=0)=>host.hand.read().channels[channel];
const send=(host,bytes)=>bytes.forEach(value=>host.engine.writePsg(value));
const pitch={block:4,fnum:1100};
const frequency=semitones=>pitch.fnum*7670454*2**(pitch.block-1)/(144*2**20)*2**(semitones/12);
const period=semitones=>Math.max(2,Math.min(1023,Math.round(3579545/(32*frequency(semitones)))));

test('construction, reading and empty edits never reset or initialize the reference chip',()=>{
  const host=fake();try {
    assert.deepEqual(host.writes,[]);assert.equal(host.resets,0);
    assert.equal(host.hand.read().sourceLatch,0);assert.equal(host.hand.releaseKeyboard(),false);
    assert.equal(edit(host,{}),false);assert.equal(host.hand.applyPreset(0,{}),false);
    assert.deepEqual(host.writes,[]);assert.equal(host.hand.describe(0).attenuation,6);
  } finally {host.dispose();}
});

test('an unmodified VGM byte stream remains byte-exact, including all data-byte destinations',()=>{
  const host=fake();try {
    const source=[0x8e,0x2a,0xa3,0x19,0xc5,0x35,0x96,4,0xb3,8,0xdf,12,0xe4,7,0xf6,9];
    send(host,source);assert.deepEqual(host.writes,source);
    assert.deepEqual(host.hand.read().periods,[0x2ae,0x193,0x355]);
    assert.deepEqual(host.hand.read().attenuations,[4,8,12,9]);assert.equal(host.hand.read().noiseMode,7);
    assert.equal(host.hand.read().noiseWriteCount,2);
  } finally {host.dispose();}
});

test('a hand edit cannot retarget the next VGM tone high data byte',()=>{
  const host=fake();try {
    send(host,[0x8e]);edit(host,{noiseRate:'tone3'},3);host.engine.writePsg(0x2a);
    assert.deepEqual(host.writes,[0x8e,0xe3,0x8e,0x2a]);
    assert.equal(voice(host).period,0x2ae);assert.equal(voice(host,3).noiseRate,'tone3');
    assert.equal(host.hand.read().noiseWriteCount,1,'selecting the old latch never resets Noise');
    assert.equal(host.hand.read().sourceLatch,0);
  } finally {host.dispose();}
});

test('a later source high-data write preserves the currently written manual low nibble',()=>{
  const host=fake();try {
    host.engine.writePsg(0x8e);edit(host,{period:0x129});edit(host,{attenuation:4},1);
    host.engine.writePsg(0x2a);
    assert.equal(voice(host).period,0x2a9,'the source updates only high bits, rather than restoring its old low nibble');
    assert.deepEqual(host.writes.slice(-2),[0x89,0x2a]);
  } finally {host.dispose();}
});

test('retargeted volume/noise data use exactly one intended register write and no eager noise restore',()=>{
  const host=fake();try {
    send(host,[0xb5]);edit(host,{period:300});host.engine.writePsg(6);
    assert.deepEqual(host.writes.slice(-1),[0xb6]);assert.equal(voice(host,1).attenuation,6);
    send(host,[0xe4]);const before=host.hand.read().noiseWriteCount;
    edit(host,{attenuation:7});assert.equal(host.hand.read().noiseWriteCount,before);
    host.engine.writePsg(7);assert.equal(host.writes.at(-1),0xe7);
    assert.equal(host.hand.read().noiseWriteCount,before+1,'only the source noise data resets its LFSR');
    assert.equal(voice(host,3).noiseType,'white');assert.equal(voice(host,3).noiseRate,'tone3');
  } finally {host.dispose();}
});

test('a later VGM tone, attenuation or noise-control write defeats stale key-up and pitch cleanup',()=>{
  for(const bytes of [[0x8e],[0x96],[0x96,4]]) {
    const host=fake();try {
      host.hand.noteOn('a',pitch,{channel:0});send(host,bytes);const count=host.writes.length;
      assert.equal(host.hand.noteOff('a'),false);host.hand.setPitch(0);host.hand.releaseKeyboard();
      assert.equal(host.writes.length,count);
    } finally {host.dispose();}
  }
  const host=fake();try {
    host.hand.noteOn('noise',pitch,{channel:3});host.engine.writePsg(0xe5);const count=host.writes.length;
    assert.equal(host.hand.noteOff('noise'),false);host.hand.setPitch(0);assert.equal(host.writes.length,count);
  } finally {host.dispose();}
});

test('Tone3-clock Noise never mutes Tone3 and a source Tone3 pitch does not steal the manual Noise gate',()=>{
  const host=fake();try {
    send(host,[0xd9,0xe7,0xf4]);host.hand.noteOn('noise',pitch,{channel:3});
    assert.equal(voice(host,2).attenuation,9);assert.equal(voice(host,2).period,period(0));
    host.hand.setPitch(2);assert.equal(voice(host,2).period,period(2));
    send(host,[0xc4,26]);const count=host.writes.length;
    host.hand.setPitch(0);assert.equal(host.writes.length,count);assert.equal(voice(host,2).period,420);
    assert.equal(host.hand.noteOff('noise'),true);assert.equal(host.writes.at(-1),0xff);
    assert.equal(voice(host,2).attenuation,9);assert.equal(voice(host,2).period,420);
  } finally {host.dispose();}
});

test('Tone3 and Noise manual keys share one pitch owner but retain independent gates',()=>{
  const host=fake();try {
    send(host,[0xe7,0xd8,0xf4]);host.hand.noteOn('tone',pitch,{channel:2});
    host.hand.noteOn('noise',{...pitch,fnum:900},{channel:3});
    const held=host.hand.read().voices;
    assert.equal(held.find(item=>item.id==='tone').pitchOwned,false);
    assert.equal(held.find(item=>item.id==='noise').pitchOwned,true);
    host.hand.setPitch(2);const count=host.writes.length;
    assert.equal(host.hand.noteOff('tone'),true);assert.equal(host.writes.length,count+1);assert.equal(host.writes.at(-1),0xdf);
    assert.equal(voice(host,3).attenuation,4);assert.equal(host.hand.noteOff('noise'),true);
  } finally {host.dispose();}
});

test('a held Noise clock edit preserves the physical Tone3 period and does not reclaim an old keyboard pitch',()=>{
  const host=fake();try {
    send(host,[0xe4,0xc1,20,0xd9,0xf5]);host.hand.noteOn('noise',pitch,{channel:3});
    const before=host.writes.length;
    edit(host,{noiseRate:'tone3'},3);assert.equal(voice(host,2).period,321);assert.equal(voice(host,2).attenuation,9);
    assert.deepEqual(host.writes.slice(before),[0xe7],'the clock control writes only Noise once');
    host.hand.setPitch(2);assert.equal(voice(host,2).period,321);
    edit(host,{noiseRate:'high'},3);const count=host.writes.length;host.hand.setPitch(2);
    assert.equal(host.writes.length,count);assert.equal(voice(host,3).noiseRate,'high');
    assert.equal(host.hand.noteOff('noise'),true);
  } finally {host.dispose();}
});

test('numeric period editing preserves held gates and defeats an old pitch wheel',()=>{
  const host=fake();try {
    host.hand.noteOn('a',pitch,{channel:0});edit(host,{period:345});const count=host.writes.length;
    host.hand.setPitch(0);assert.equal(host.writes.length,count);assert.equal(voice(host).period,345);
    assert.equal(host.hand.noteOff('a'),true);
    send(host,[0xe7,0xf3]);host.hand.noteOn('noise',pitch,{channel:3});
    const result=edit(host,{period:420},3);assert.deepEqual(result.edits,[{channel:2,changes:{period:420}}]);
    assert.equal(voice(host,2).period,420);assert.equal(voice(host,3).period,420);
  } finally {host.dispose();}
});

test('sparse Noise edits preserve the latest companion instead of a frozen display',()=>{
  const host=fake();try {
    send(host,[0xe0,0xc2,10]);const frozen=host.timeline.read(0);host.engine.processFrames(100);
    host.engine.writePsg(0xe4);edit(host,{noiseRate:'tone3',period:420},3);
    assert.equal(voice(host,3).noiseType,'white');assert.equal(voice(host,3).period,420);
    const shown=host.hand.readSnapshot(frozen,0,{frozen:true});
    assert.equal(shown.channels[3].noiseType,'periodic','untouched type stays frozen');
    assert.equal(shown.channels[3].noiseRate,'tone3');assert.equal(shown.channels[3].period,420);
    assert.equal(shown.channels[2].period,420);assert.equal(shown.channels[3].noiseClockHz,3579545/(32*420));
    assert.equal(shown.channels[3].frequencyHz,3579545/(32*420*16));
    assert.equal(frozen.channels[3].noiseRate,'low','original immutable view stays unchanged');
    host.engine.processFrames(100);const current=host.timeline.read(200);
    assert.equal(host.hand.readSnapshot(current,200),current,'consumed data comes from the real timeline');
  } finally {host.dispose();}
});

test('pending edits stay bounded and Tone3 period changes update its derived Noise view',()=>{
  const host=fake();try {
    send(host,[0xe7]);const frozen=host.timeline.read(0);host.engine.processFrames(100);
    for(let index=0;index<1000;index++)edit(host,{period:2+index%1022},2);
    assert.equal(host.hand.read().pendingDisplayEdits,1);
    const next=host.hand.readSnapshot(frozen,0);assert.equal(next.channels[2].period,1001);assert.equal(next.channels[3].period,1001);
    assert.equal(next.channels[3].frequencyHz,null,'white noise is not assigned a note');
    assert.equal(patchSynthPsgSongSnapshotEdit(next,{channel:3,changes:{noiseRate:'low'}}).channels[3].period,16);
  } finally {host.dispose();}
});

test('preset loading keeps idle channels silent and saves the next keyboard level; VGM volume takes over',()=>{
  const host=fake();try {
    const result=host.hand.applyPreset(0,{settings:{source:'tone',attenuation:2,envelope:{enabled:true}}});
    assert.equal(result.revision,host.hand.read().revision);assert.deepEqual(host.writes,[]);
    assert.equal(voice(host).attenuation,15);assert.equal(voice(host).preset.attenuation,15);assert.equal(voice(host).selectedAttenuation,2);
    host.hand.noteOn('a',pitch,{channel:0});assert.equal(voice(host).attenuation,2);host.hand.noteOff('a');
    host.engine.writePsg(0x95);assert.equal(voice(host).selectedAttenuation,undefined);assert.equal(host.hand.describe(0).attenuation,5);
    host.hand.applyPreset(0,{attenuation:4});assert.equal(voice(host).attenuation,4,'an active source channel follows the loaded patch');
    edit(host,{attenuation:15});host.hand.noteOn('muted',pitch,{channel:0});assert.equal(voice(host).attenuation,15,'explicit manual mute is preserved');
  } finally {host.dispose();}
});

test('invalid compound edits, presets and note inputs fail before any hardware write',()=>{
  const host=fake();try {
    for(const changes of [{attenuation:3,period:1024},{attenuation:4,noiseType:'white'},{attenuation:5,source:'noise'}]) {
      assert.throws(()=>edit(host,changes));assert.deepEqual(host.writes,[]);
    }
    assert.throws(()=>edit(host,{attenuation:4,period:100},3),/Fixed noise/);assert.deepEqual(host.writes,[]);
    assert.throws(()=>host.hand.applyPreset(3,{attenuation:4,noiseRate:'bad'}));assert.deepEqual(host.writes,[]);
    for(const note of [{block:8,fnum:100},{block:4,fnum:0},{block:4,fnum:2048},null])assert.throws(()=>host.hand.noteOn('bad',note,{channel:0}));
    assert.deepEqual(host.writes,[]);
  } finally {host.dispose();}
});

test('checkpoints preserve source and physical latches separately without writes and retire input ownership',()=>{
  const host=fake();try {
    host.engine.writePsg(0x8e);edit(host,{attenuation:3},1);host.engine.processFrames(123);const saved=host.hand.saveState();
    assert.equal(saved.sourceLatch,0);assert.equal(saved.decoder.latched,3);
    host.hand.noteOn('a',pitch,{channel:0});const count=host.writes.length;host.hand.loadState(structuredClone(saved));
    assert.equal(host.writes.length,count);assert.equal(host.hand.generatedFrames,123);assert.equal(host.hand.noteOff('a'),false);
    host.engine.writePsg(0x2a);assert.equal(voice(host).period,0x2ae);
    const before=host.hand.saveState();assert.throws(()=>host.hand.loadState({...saved,sourceLatch:8}));assert.deepEqual(host.hand.saveState(),before);
    assert.throws(()=>host.hand.loadState({...saved,decoder:{}}));assert.deepEqual(host.hand.saveState(),before);
  } finally {host.dispose();}
});

test('reset and disposal unwind wrappers without initializing new voices',()=>{
  const host=fake();host.hand.noteOn('a',pitch,{channel:0});host.engine.reset();
  assert.equal(host.resets,1);assert.equal(host.hand.generatedFrames,0);assert.equal(host.hand.noteOff('a'),false);
  const count=host.writes.length;host.hand.dispose();assert.throws(()=>edit(host,{attenuation:4}),/disposed/);
  host.timeline.dispose();for(const [name,method]of Object.entries(host.original))assert.equal(host.engine[name],method);
  assert.equal(host.writes.length,count);
});

test('actual WASM tone/noise PCM matches an independent explicit-register oracle through hand edits and VGM continuations',async()=>{
  const wasmBinary=await readFile(new URL('../generated/segapsg_wasm.wasm',import.meta.url));
  const create=async()=>{
    const psg=await SegaPSG.create({moduleFactory:psgFactory,moduleOptions:{wasmBinary},sampleRate:44100});
    return {psg,writePsg:value=>psg.write(value),processFrames:frames=>psg.generateStereo(frames),reset:()=>psg.reset(),dispose:()=>psg.dispose()};
  };
  const actual=await create(),oracle=await create(),timeline=createPsgSongTimeline(actual),hand=createSynthPsgSongInteraction(actual);
  const raw=(engine,bytes)=>bytes.forEach(value=>engine.writePsg(value));
  const both=bytes=>{raw(actual,bytes);raw(oracle,bytes);};
  const setOraclePeriod=(ch,p)=>raw(oracle,[0x80|(ch<<5)|(p&15),p>>4]);
  const check=(frames=1024)=>{const a=actual.processFrames(frames),b=oracle.processFrames(frames);assert.deepEqual(a.left,b.left);assert.deepEqual(a.right,b.right);return a;};
  try {
    both([0x9f,0xbf,0xdf,0xff,0x8e,8,0x95,0xab,12,0xb7,0xc6,16,0xd9,0xe4,0xf4]);
    assert(check().left.some(value=>Math.abs(value)>.001));
    both([0x8e]);check(128);hand.applyEdit({channel:3,changes:{noiseType:'periodic'}});raw(oracle,[0xe0]);check();
    actual.writePsg(0x2a);raw(oracle,[0x8e,0x2a]);check();
    both([0xe4]);hand.applyEdit({channel:0,changes:{attenuation:6}});raw(oracle,[0x96]);check();
    actual.writePsg(7);raw(oracle,[0xe7]);check();assert.equal(hand.read().noiseWriteCount,4);
    both([0xb5]);hand.applyEdit({channel:0,changes:{period:300}});setOraclePeriod(0,300);
    actual.writePsg(6);raw(oracle,[0xb6]);check();
    both([0xe7,0xd9,0xf4]);hand.noteOn('noise',pitch,{channel:3});setOraclePeriod(2,period(0));raw(oracle,[0xe7,0xf4]);check();
    hand.setPitch(2);setOraclePeriod(2,period(2));check();both([0xc4,26]);hand.setPitch(0);check();
    hand.noteOff('noise');raw(oracle,[0xff]);check();assert.equal(hand.read().channels[2].attenuation,9);
    for(let ch=0;ch<4;ch++){actual.psg.setChannelMuted(ch,true);oracle.psg.setChannelMuted(ch,true);}
    hand.applyEdit({channel:3,changes:{noiseType:'white',attenuation:3}});raw(oracle,[0xe7,0xf3]);
    const muted=check();assert(muted.left.every(value=>value===0)&&muted.right.every(value=>value===0));
  } finally {hand.dispose();timeline.dispose();actual.dispose();oracle.dispose();}
});
