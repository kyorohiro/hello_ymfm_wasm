import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {SynthInstrument} from './instrument.js';
import {operatorSlot} from './routing.js';
let module;
async function create(t){module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});const i=new SynthInstrument(await Scsp.create({moduleFactory:()=>module}));t.after(()=>i.dispose());return i;}
const peak=a=>Math.max(...a.map(Math.abs));

test('Code attacks use the identical authored 2/4/6-op patch on the shared SCSP',async t=>{
  for(const mode of ['pcm','fm2','fm4','fm6'])for(const algorithm of ['chain','pairs','branch']){
    const a=await create(t),b=await create(t);
    for(const i of [a,b]){i.setConfig({mode,fm:{algorithm,ratios:[1,1.5,2,2.5,3,4]}});i.invoke('setMix',[0,{totalLevel:28}]);i.invoke('setLfo',[1,{frequencyCode:20,pitchDepth:3}]);}
    const session=a.beginCode().session;a.code(session,'noteOn',[0,'A4']);b.noteOn('manual',69);
    assert.deepEqual(a.synth.generateStereo(8192),b.synth.generateStereo(8192),`${mode} / ${algorithm}`);
    assert.equal(a.read().voiceGroups[0].owner.kind,'code');
  }
});

test('Code Stop and stale sessions preserve manual replacements, DSP and active PCM ownership',async t=>{
  const i=await create(t);i.setConfig({mode:'fm6'});i.setEffect({enabled:true,timeMs:20});i.invoke('setEnvelope',[0,{releaseRate:0}]);
  const session=i.beginCode().session;i.code(session,'noteOn',[0,69]);const initial=i.read(),oldSample=initial.playingSampleIds[11];
  i.code(session,'applyPCM',[0,new Int16Array(64).fill(1200),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  assert.equal(i.read().playingSampleIds[11],oldSample);assert(i.read().samples.some(s=>s.id===oldSample));
  i.noteOn('key1',60);i.noteOn('key2',64);i.noteOn('key3',67);assert.equal(i.noteOn('replacement',72).stolenId,initial.voiceGroups[0].id);
  assert.equal(i.code(session,'noteOff',[0]),false);i.endCode(session);
  assert.equal(i.read().voiceGroups.length,4);assert(i.read().voiceGroups.every(g=>g.held));assert(i.synth.generateStereo(4096).left.some(v=>v!==0));
  const newer=i.beginCode().session;i.code(newer,'noteOn',[1,76]);const before=i.read();
  assert.equal(i.endCode(session),false);assert.throws(()=>i.code(session,'allNotesOff'),{name:'AbortError'});assert.deepEqual(i.read(),before);
  assert.equal(i.endCode(newer),true);assert.equal(i.read().voiceGroups.length,3);assert(i.read().config.effect.enabled);
});

test('preset replacement during Code stages protected samples and keeps session and held groups',async t=>{
  const i=await create(t),author=await create(t);i.setConfig({mode:'fm2'});const session=i.beginCode().session;i.code(session,'noteOn',[0,69]);i.noteOn('held-key',60);
  const before=i.read(),playing=[...before.playingSampleIds];author.setConfig({mode:'fm6',fm:{algorithm:'pairs'}});const patch=author.exportPatch();
  i.loadPatch(patch);let state=i.read();assert.equal(state.codeSession,session);assert(state.codeActive);assert.equal(state.voiceGroups.length,2);assert.deepEqual(state.playingSampleIds,playing);
  for(const id of playing.filter(x=>x!==null))assert(state.samples.some(sample=>sample.id===id));
  i.code(session,'noteOn',[1,72]);state=i.read();assert.equal(state.codeLanes[1].slots.length,6);assert.equal(state.voiceGroups.find(g=>g.id==='held-key').slots.length,2);
  const saved=i.read(),bad=structuredClone(patch);bad.operators.carrier.pcm[0]=1e8;assert.throws(()=>i.loadPatch(bad));assert.deepEqual(i.read(),saved);
  i.endCode(session);assert.equal(i.read().voiceGroups.length,1);assert(i.read().voiceGroups[0].held);
});

test('shared author edits and logical pitch updates sound live without stale ownership',async t=>{
  const i=await create(t);i.setConfig({mode:'fm4'});const session=i.beginCode().session;i.code(session,'noteOn',[31,69]);i.noteOn('key',60);
  const group=i.read().voiceGroups[0],carrier=operatorSlot(group,0);i.code(session,'setFrequency',[31,330]);assert.equal(i.read().slots[carrier].frequencyHz,330);
  i.invoke('setMix',[0,{totalLevel:58}]);i.code(session,'setLfo',[0,{pitchDepth:3}]);
  assert.equal(i.read().slots[carrier].totalLevel,58);assert.equal(i.read().slots[carrier].lfo.pitchDepth,3);
  i.code(session,'setConfig',[{fm:{depth:4}}]);assert.equal(i.read().slots[carrier].modulation.depth,4);
  i.code(session,'allNotesOff');assert(!i.read().slots[carrier].gate);assert(i.read().voiceGroups.find(g=>g.id==='key').held);
  i.code(session,'keyOn',[31]);assert(Math.abs(i.read().slots[carrier].frequencyHz-330)<1e-10);i.endCode(session);
  assert(i.read().voiceGroups.find(g=>g.id==='key').held);assert(peak(i.synth.generateStereo(128).left)>0);
});

test('Code rejects foreign samples and malformed calls without mutating the shared instrument',async t=>{
  const i=await create(t),other=await create(t),session=i.beginCode().session;i.code(session,'noteOn',[0,69]);const saved=i.read();
  for(const call of [()=>i.code(session,'setPreset',[0,{sample:other.read().slots[0].sample}]),()=>i.code(session,'noteOn',[32,69]),()=>i.code(session,'noteOn',[0,'A99']),()=>i.code(session,'setFrequency',[0,-3]),()=>i.code(session,'setLfo',[6,{pitchDepth:3}]),()=>i.code(session,'reset',[])]){assert.throws(call);assert.deepEqual(i.read(),saved);}
});

test('authoring snapshots send PCM only for changed handles with matching parameter state',async t=>{
  const i=await create(t),first=i.readAuthoring();assert.equal(first.operators.length,6);assert(first.operators.every(Boolean));
  const keys=first.state.slots.slice(0,6).map(voice=>`${voice.sample.bankId}:${voice.sample.id}`);
  i.invoke('setMix',[0,{totalLevel:37}]);let next=i.readAuthoring(keys);assert(next.operators.every(value=>value===null));assert.equal(next.state.slots[0].totalLevel,37);
  const session=i.beginCode().session;i.code(session,'applyPCM',[2,new Int8Array([50,-50]),{rootNote:69,loopStartSamples:0}]);
  next=i.readAuthoring(keys);assert.equal(next.operators.filter(Boolean).length,1);assert.deepEqual(next.operators[2].sample,next.state.slots[2].sample);assert.deepEqual(next.operators[2].voice,next.state.slots[2]);assert.deepEqual(next.operators[2].pcm,new Int8Array([50,-50]));
});

test('a running preset replacement validates its PCM against the new preset LFO and pitch',async t=>{
  const i=await create(t),author=await create(t);i.invoke('setLfo',[0,{pitchDepth:7}]);const session=i.beginCode().session;i.code(session,'noteOn',[0,69]);const old=i.read().playingSampleIds[6];
  author.invoke('applyPCM',[0,new Int8Array([50,-50]),{rootNote:60,loopStartSamples:0}]);i.loadPatch(author.exportPatch());
  assert.equal(i.read().slots[0].lfo.pitchDepth,0);assert.equal(i.read().playingSampleIds[6],old);i.code(session,'noteOn',[1,69]);assert(i.synth.generateStereo(128).left.some(v=>v!==0));
});

test('continuous bend follows keyboard and Code pitch while portable transpose stays integer',async t=>{
  const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} ~= ${expected}`);
  for(const mode of ['pcm','fm2','fm4','fm6']){
    const i=await create(t);i.setConfig({mode,transpose:3});i.noteOn('keyboard',69);
    const session=i.beginCode().session;i.code(session,'noteOn',[0,72]);
    assert.equal(i.setPitchBend(.5),.5);
    let state=i.read();assert.equal(state.pitchBend,.5);assert.equal(state.config.transpose,3);
    const check=(group,frequency)=>group.slots.forEach((_slot,index)=>near(i.read().slots[operatorSlot(group,index)].frequencyHz,frequency*(mode==='pcm'?1:i.config.fm.ratios[index])));
    for(const group of state.voiceGroups)check(group,440*2**((group.midi-69+3.5)/12));
    i.noteOn('new-keyboard',67);i.code(session,'noteOn',[1,76]);
    for(const group of i.read().voiceGroups)check(group,440*2**((group.midi-69+3.5)/12));
    const code=i.read().voiceGroups.find(group=>group.owner.kind==='code'&&group.owner.channel===0);
    i.code(session,'setNote',[0,'D4']);check(code,440*2**((62-69+3.5)/12));
    i.code(session,'setFrequency',[0,330]);check(code,330*2**(3.5/12));
    i.setConfig({transpose:-2,fm:{ratio:1.5}});check(code,330*2**(-1.5/12));
    i.code(session,'noteOff',[0]);i.setPitchBend(0);check(code,330*2**(-2/12));
    assert(code.slots.every(slot=>!i.read().slots[slot].gate));
    i.setPitchBend(-.75);i.code(session,'keyOn',[0]);check(code,330*2**(-2.75/12));
    const patch=i.exportPatch();assert.equal(patch.transpose,-2);assert(Number.isInteger(patch.transpose));assert(!Object.hasOwn(patch,'pitchBend'));
    assert.equal(patch.operators.carrier.voice.frequencyHz,440);
    i.setPitchBend(0);assert.equal(i.readAuthoring().state.pitchBend,0);assert(peak(i.synth.generateStereo(128).left)>0);
  }
});

test('bend changes native audio and invalid or unsafe bend leaves every voice intact',async t=>{
  const bent=await create(t),plain=await create(t);
  bent.setPitchBend(.5);for(const i of [bent,plain])i.noteOn('held',69);
  assert.notDeepEqual(bent.synth.generateStereo(4096),plain.synth.generateStereo(4096));
  const before=bent.read();for(const value of [NaN,Infinity,-2.01,2.01,'0.5']){assert.throws(()=>bent.setPitchBend(value));assert.deepEqual(bent.read(),before);}
  const limited=await create(t);limited.invoke('applyPCM',[0,new Int8Array([50,-50]),{baseFrequencyHz:440/1.99,loopStartSamples:0}]);limited.noteOn('short-loop',69);
  const safe=limited.read();assert.throws(()=>limited.setPitchBend(.5),/pitch step exceeds/);assert.deepEqual(limited.read(),safe);
});

test('invalid presets preserve bend and valid direct or Code loads reset it during commit',async t=>{
  for(const codeActive of [false,true]){
    const i=await create(t),author=await create(t);i.setConfig({mode:'fm2',transpose:2});i.noteOn('keyboard',69);
    const session=codeActive?i.beginCode().session:null;if(codeActive)i.code(session,'noteOn',[0,69]);
    i.setPitchBend(.5);author.setConfig({mode:'fm4',transpose:-3});const patch=author.exportPatch();
    const load=value=>codeActive?i.code(session,'loadPatch',[value]):i.loadPatch(value);
    const before=i.read(),invalid=structuredClone(patch);invalid.fm.depth=13;assert.throws(()=>load(invalid));assert.deepEqual(i.read(),before);
    load(patch);const state=i.read();assert.equal(state.pitchBend,0);assert.equal(state.config.transpose,-3);
    if(codeActive){
      assert.equal(state.voiceGroups.length,2);for(const group of state.voiceGroups)assert(Math.abs(state.slots[operatorSlot(group,0)].frequencyHz-440*2**(2/12))<1e-8);
      i.code(session,'noteOn',[1,69]);const group=i.read().voiceGroups.find(group=>group.owner.channel===1);assert(Math.abs(i.read().slots[operatorSlot(group,0)].frequencyHz-440*2**(-3/12))<1e-8);
    }else assert.equal(state.voiceGroups.length,0);
  }
});

test('incoming presets are validated at neutral bend before a running replacement commits',async t=>{
  const i=await create(t),author=await create(t),session=i.beginCode().session;i.code(session,'noteOn',[0,69]);i.setPitchBend(.5);
  author.invoke('applyPCM',[0,new Int8Array([50,-50]),{baseFrequencyHz:440/1.99,loopStartSamples:0}]);
  i.loadPatch(author.exportPatch());assert.equal(i.read().pitchBend,0);i.code(session,'noteOn',[1,69]);
  assert.equal(i.read().codeLanes[1].slots.length,1);assert.equal(i.read().slots[i.read().codeLanes[1].slots[0]].frequencyHz,440);
});
