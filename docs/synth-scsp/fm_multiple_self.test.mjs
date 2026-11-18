// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';
import {SynthInstrument} from './instrument.js';
import {customRouting,resizeCustomRouting,selfFeedbackCount,hasSelfFeedback} from './routing.js';
import {readPatch} from './patch.js';

let module;
async function create(t){
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const owner=new SynthInstrument(await Scsp.create({moduleFactory:()=>module}));if(t)t.after(()=>owner.dispose());return owner;
}
const ratios=[1.25,2.5,.5,1.75,3,.75],graph=(inputs,outputs=[0])=>({inputs,outputs});
const stack=core=>Array.from({length:64},(_,index)=>core.read(0x600+index*2));
const seed=(core,index,value)=>core.write(0x600+index*2,value&65535);
function waves(owner){
  for(let index=0;index<6;index++){
    const pcm=index%2?Int8Array.from({length:64},(_,i)=>Math.round(19*(2*i/64-1))):Int16Array.from({length:64},(_,i)=>Math.round(2400*Math.sin((i+index*3)*Math.PI/32)+500*Math.cos((index+2)*i*Math.PI/32)));
    owner.invoke('applyPCM',[index,pcm,{baseFrequencyHz:44100/64,loopStartSamples:0}]);owner.invoke('setMix',[index,{totalLevel:16+index,directLevel:7,pan:0}]);
  }
}
// Source nodes run in descending ID order. In the connected fixture every
// nonself target depends on the last preceding node, so its physical order is
// predetermined without calling the production DAG/routing/slot helpers.
function fixture(count,mask,connected=false){
  const selves=Array.from({length:count},(_,i)=>count-1-i).filter(i=>mask&(1<<i));
  const rest=Array.from({length:count},(_,i)=>count-1-i).filter(i=>!(mask&(1<<i)));
  const inputs=Array.from({length:count},(_,i)=>mask&(1<<i)?[i]:[]),order=connected?[...selves,...rest]:Array.from({length:count},(_,i)=>count-1-i);
  if(connected){
    let previous=selves.at(-1);
    for(let position=0;position<rest.length;position++){
      const target=rest[position],second=position===0?selves.at(-2):selves[position%selves.length];
      inputs[target]=second===undefined||second===previous?[previous]:[previous,second];previous=target;
    }
  }
  return {count,mask,selves,order,custom:graph(inputs,Array.from({length:count},(_,i)=>i))};
}
const setup=(owner,f,depth=9)=>owner.setConfig({mode:`fm${f.count}`,fm:{algorithm:'custom',custom:f.custom,depth,ratios}});
function render(core,rate,frames=1024){
  const converter=new Pcm44100Resampler(core,rate),left=new Float32Array(frames),right=new Float32Array(frames);
  for(let offset=0;offset<frames;offset+=128)converter.render(left,right,Math.min(128,frames-offset),offset);
  return {left,right,nativeFrames:core.nativeFrames};
}
// Explicit native MDL/X/Y word calculation, including the established adapter
// convention that depth zero writes zero. No authored-graph command helper is
// used by this reference and physical slots are chosen by the fixture above.
function reference(owner,f,depths,midi=67){
  const slots=[],words=[];f.order.forEach((operator,index)=>{slots[operator]=6+index;});const state=owner.synth.getState();
  for(let operator=0;operator<f.count;operator++){
    const voice=state.slots[operator],sources=f.custom.inputs[operator],slot=slots[operator],self=Boolean(f.mask&(1<<operator));
    owner.synth.setPreset(slot,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,directLevel:voice.directLevel,pan:voice.pan,
      frequencyHz:440*2**((midi-69)/12)*ratios[operator],modulation:{depth:0,xOffset:0,yOffset:0,writeInhibit:false}});
    const offsets=sources.map(source=>(slots[source]-slot+64)%64),depth=sources.length?depths[operator]:0;
    const x=self?32:offsets[0]??0,y=self?0:offsets[1]??offsets[0]??0;
    words.push([slot*32+14,depth?(depth<<12)|(x<<6)|y:0]);
  }
  for(const operator of f.selves){seed(owner.core,slots[operator],0);seed(owner.core,slots[operator]+32,0);}
  for(let position=0;position<f.count;position++)owner.synth.keyOn(6+position);
  // keyOn writes the common adapter's shadow word; replace it explicitly
  // before rendering any native frame so the reference tests raw X/Y encoding.
  for(const [address,word]of words)owner.core.write(address,word);return slots;
}

test('all78 nonempty4/6OP Self subsets match independent raw-slot native fixtures with all outputs and fanout/merge at44.1/48kHz',async()=>{
  let subsets=0,comparisons=0,multiple=0;
  for(const count of [4,6])for(let mask=1;mask<(1<<count);mask++){
    subsets++;if((mask&(mask-1))!==0)multiple++;
    for(const connected of mask===(1<<count)-1?[false]:[false,true])for(const depth of [0,1,12])for(const rate of [44100,48000]){
      const f=fixture(count,mask,connected),owner=await create(),manual=await create();
      try{
        for(const value of [owner,manual]){waves(value);for(let cell=0;cell<64;cell++)seed(value.core,cell,1000+cell*23);}
        const depths=Array(6).fill(7);for(const operator of f.selves)depths[operator]=depth;
        setup(owner,f);owner.setConfig({fm:{depths}});owner.noteOn('held',67);const slots=reference(manual,f,depths);
        const state=owner.read();assert.deepEqual(state.voiceGroups[0].operatorSlots,slots);
        for(const operator of f.selves){assert.deepEqual(state.slots[slots[operator]].modulation,{depth,xOffset:32,yOffset:0,writeInhibit:false});assert.equal(owner.core.read(slots[operator]*32+14),depth?(depth<<12)|0x800:0);}
        const actual=render(owner.core,rate),expected=render(manual.core,rate);assert.deepEqual(actual,expected,`${count}/${mask}/${connected}/${depth}/${rate}`);
        assert(actual.left.every(Number.isFinite)&&actual.right.every(Number.isFinite));comparisons++;
      }finally{owner.dispose();manual.dispose();}
    }
  }
  assert.equal(subsets,78);assert.equal(multiple,68);assert.equal(comparisons,924);
});

test('each new multiple-Self group clears exactly its own two cells perSelf, after validation and before any keyOn',async t=>{
  for(const [count,mask]of [[4,15],[6,63],[6,0b101010]]){
    const owner=await create(t),f=fixture(count,mask,true);setup(owner,f);for(let cell=0;cell<64;cell++)seed(owner.core,cell,2000+cell);
    const writes=[],write=owner.core.write.bind(owner.core);owner.core.write=(...args)=>{writes.push(args);return write(...args);};owner.noteOn('held',69);owner.core.write=write;
    const group=owner.read().voiceGroups[0],expected=f.selves.toSorted((a,b)=>a-b).flatMap(operator=>[group.operatorSlots[operator],group.operatorSlots[operator]+32]);
    const clears=writes.filter(([address])=>address>=0x600&&address<0x700);assert.deepEqual(clears,expected.map(cell=>[0x600+cell*2,0]));
    assert(stack(owner.core).every((value,index)=>value===(expected.includes(index)?0:2000+index)));
    const keyOn=writes.findIndex(([address,value])=>address<0x400&&address%32===0&&(value&0x1800)===0x1800);assert(Math.max(...clears.map(call=>writes.indexOf(call)))<keyOn);
  }
});

test('multi-Self live depth Off/On, pitch, source/DSP controls and releasing Code/keyboard owners retain every history',async t=>{
  const owner=await create(t),f=fixture(6,0b101010,true);waves(owner);setup(owner,f);for(let i=0;i<6;i++)owner.invoke('setEnvelope',[i,{releaseRate:2}]);
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.noteOn('keyboard',64);owner.noteOff('keyboard');owner.physicalNoteOn('manual',31,60);
  owner.setEffect({enabled:true});owner.setDspSourceSend(3,{input:1,level:5});owner.setDspReturn(1,{level:5,pan:12});owner.synth.generateStereo(137);
  const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),dsp=owner.readDspSetup(),writes=[],write=owner.core.write.bind(owner.core);owner.core.write=(...args)=>{writes.push(args);return write(...args);};
  owner.setConfig({fm:{depth:0}});for(const group of owner.read().voiceGroups)for(const op of f.selves)assert.equal(owner.core.read(group.operatorSlots[op]*32+14),0);
  const depths=[2,12,4,1,6,8];owner.setConfig({fm:{depths}});owner.setPitchBend(.5);owner.code(session,'setFrequency',[0,330]);owner.core.write=write;
  for(const group of owner.read().voiceGroups)for(const op of f.selves){const slot=group.operatorSlots[op];assert.equal(owner.core.read(slot*32+14),(depths[op]<<12)|0x800);assert.deepEqual(owner.read().slots[slot].modulation,{depth:depths[op],xOffset:32,yOffset:0,writeInhibit:false});}
  assert.deepEqual(stack(owner.core),ring);assert(!writes.some(([address])=>address>=0x600&&address<0x700));assert.deepEqual(owner.core.readRam(),ram);assert.deepEqual(owner.readDspSetup(),dsp);
  const state=owner.read();assert.equal(state.codeSession,session);assert(state.codeActive);assert.deepEqual(state.manualVoices,before.manualVoices);assert.equal(state.voiceGroups.find(group=>group.id==='keyboard').held,false);
  owner.invoke('setMix',[3,{totalLevel:42}]);owner.invoke('setLfo',[3,{frequencyCode:17,pitchDepth:2}]);
  for(const group of owner.read().voiceGroups){const slot=group.operatorSlots[3];assert.equal(owner.read().slots[slot].totalLevel,42);assert.equal(owner.read().slots[slot].lfo.frequencyCode,17);assert.equal(owner.read().dspRouting.slots[slot].level,5);}
});

test('same-lane Code retrigger and steal initialize every newly ownedSelf without clearing other groups/manual/DSP',async t=>{
  const owner=await create(t),f=fixture(6,0b101010,true);setup(owner,f);const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.noteOn('other',64);owner.physicalNoteOn('manual',31,60);owner.setEffect({enabled:true});
  const first=owner.read().voiceGroups[0],other=owner.read().voiceGroups.find(g=>g.id==='other'),manual=owner.read().manualVoices,dsp=owner.readDspSetup();
  for(let cell=0;cell<64;cell++)seed(owner.core,cell,3000+cell);owner.code(session,'noteOn',[0,72]);
  const cleared=f.selves.flatMap(op=>[first.operatorSlots[op],first.operatorSlots[op]+32]);assert(stack(owner.core).every((value,index)=>value===(cleared.includes(index)?0:3000+index)));
  assert.deepEqual(owner.read().voiceGroups.find(g=>g.id==='other'),other);assert.deepEqual(owner.read().manualVoices,manual);assert.deepEqual(owner.readDspSetup(),dsp);
  owner.physicalNoteOff('manual');owner.physicalNoteOn('raw',31,60);assert.equal(stack(owner.core)[31],3031);assert.equal(stack(owner.core)[63],3063);
  owner.stopVoices();for(let i=0;i<4;i++)owner.noteOn('old'+i,60+i);owner.noteOff('old1');const victim=owner.read().voiceGroups.find(g=>g.id==='old1');for(let cell=0;cell<64;cell++)seed(owner.core,cell,4000+cell);
  const result=owner.noteOn('replacement',69);assert.equal(result.stolenId,'old1');const victimCells=f.selves.flatMap(op=>[victim.operatorSlots[op],victim.operatorSlots[op]+32]);assert(stack(owner.core).every((value,index)=>value===(victimCells.includes(index)?0:4000+index)));assert.equal(owner.noteOff('old1'),false);
});

test('malformed/mixedSelf, external cycles, 2OP doubleSelf and PCM failures reject atomically before all writes',async t=>{
  const owner=await create(t);setup(owner,fixture(6,0b101010,true));const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);owner.setEffect({enabled:true});owner.synth.generateStereo(137);
  const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;owner.core.write=(...args)=>{writes++;return write(...args);};const sparse=Array(6);sparse[0]=[0];
  for(const custom of [graph([[0,1],[1],[],[],[],[]]),graph([[0],[1],[],[],[],[5,0]]),graph([[0],[1],[3],[2],[],[]]),graph([[0],[1],[3],[4],[2],[]]),graph([[0],[1],[2,2],[],[],[]]),graph([[0],[1],[],[],[],[6]]),graph(sparse),graph([[0],[1],[],[],[],[]],[6]),{...graph([[0],[1],[],[],[],[]]),extra:true}])assert.throws(()=>owner.setConfig({fm:{custom}}));
  for(const patch of [{mode:'fm2',fm:{custom:graph([[0],[1]])}},{mode:'pcm'},{fm:{depth:13}},{mode:'fm4',fm:{custom:fixture(6,3).custom}}])assert.throws(()=>owner.setConfig(patch));
  for(const op of [1,3,5])assert.throws(()=>owner.invoke('applyPCM',[op,new Int8Array(64),{rootNote:69}]),/full forward loop/);
  assert.equal(writes,0);owner.core.write=write;assert.deepEqual(owner.read(),before);assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
});

test('resize preserves surviving independentSelf edges and rejects ambiguous doubleSelf2OP shrink before mutation',async t=>{
  const owner=await create(t),f=fixture(6,0b100011,true);setup(owner,f);owner.noteOn('held',69);owner.synth.generateStereo(137);
  const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;owner.core.write=(...args)=>{writes++;return write(...args);};
  assert.throws(()=>owner.setConfig({mode:'fm2'}),/2-op/);assert.throws(()=>resizeCustomRouting(f.custom,2),/2-op/);assert.equal(writes,0);owner.core.write=write;assert.deepEqual(owner.read(),before);assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
  owner.setConfig({mode:'fm4'});assert.equal(selfFeedbackCount(owner.read().config.fm.custom),2);assert.equal(owner.exportPatch().version,10);owner.setConfig({mode:'fm6'});assert.deepEqual(owner.read().config.fm.custom.inputs.slice(0,2),[[0],[1]]);assert.deepEqual(owner.read().config.fm.custom.inputs[5],[]);
  owner.setConfig({mode:'fm2',fm:{algorithm:'chain'}});const dormant=owner.read();assert.equal(owner.exportPatch().version,4);assert.throws(()=>owner.setConfig({fm:{algorithm:'custom'}}),/2-op/);assert.deepEqual(owner.read(),dormant);
  const custom=structuredClone(dormant.config.fm.custom);custom.inputs[1]=[0];owner.setConfig({fm:{custom}});owner.setConfig({fm:{algorithm:'custom'}});assert.deepEqual(owner.read().config.fm.custom,graph([[0],[0]],[0,1]));assert.equal(owner.exportPatch().version,8);
  assert.deepEqual(f.custom.inputs[5],[5]);assert.equal(selfFeedbackCount(resizeCustomRouting(fixture(6,0b110000).custom,4)),0);
});

test('v10 scalar/mixed4/6 presets and idle snapshots roundtrip exact audio while oldversions reject multipleSelf',async t=>{
  for(const count of [4,6])for(const depths of [null,[2,4,6,8,10,12]]){
    const owner=await create(t),copy=await create(t),idle=await create(t);waves(owner);setup(owner,fixture(count,(1<<count)-1));if(depths)owner.setConfig({fm:{depths}});
    const patch=JSON.parse(JSON.stringify(owner.exportPatch()));assert.equal(patch.version,10);assert.equal(selfFeedbackCount(readPatch(patch).fm.custom),count);copy.loadPatch(patch);idle.loadIdleState(owner.exportIdleState());
    for(const value of [owner,copy,idle])value.noteOn('held',67);const pcm=owner.synth.generateStereo(2048);assert.deepEqual(copy.synth.generateStereo(2048),pcm);assert.deepEqual(idle.synth.generateStereo(2048),pcm);
    const before=copy.read(),ring=stack(copy.core),ram=copy.core.readRam(),write=copy.core.write.bind(copy.core);let writes=0;copy.core.write=(...args)=>{writes++;return write(...args);};
    for(let version=1;version<=9;version++){const invalid=structuredClone(patch);invalid.version=version;if(version===7)invalid.fm.depths=[9,9,9,9,9,9];assert.throws(()=>copy.loadPatch(invalid));}
    for(const edit of [v=>{v.mode='fm2';v.fm.custom=graph([[0],[]]);},v=>{v.fm.algorithm='chain';},v=>{delete v.fm.custom;},v=>{v.fm.custom=graph(Array.from({length:count},(_,i)=>i===0?[0]:[]));},v=>{v.fm.custom=graph(Array.from({length:count},()=>[]));}]){const invalid=structuredClone(patch);edit(invalid);assert.throws(()=>copy.loadPatch(invalid),/version 10/);}
    assert.equal(writes,0);copy.core.write=write;assert.deepEqual(copy.read(),before);assert.deepEqual(stack(copy.core),ring);assert.deepEqual(copy.core.readRam(),ram);
  }
});

test('v10 normalized getter mode/algorithm/Selfcount guards preserve owners/RAM/history and caller arrays stay detached',async t=>{
  const owner=await create(t),source=await create(t);setup(owner,fixture(4,3,true));setup(source,fixture(6,0b101010,true));const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);owner.synth.generateStereo(137);
  const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;owner.core.write=(...args)=>{writes++;return write(...args);};
  try{for(const changed of ['algorithm','count','mode']){
    const preset=source.exportPatch(),original=preset.fm;let reads=0,modes=0;
    Object.defineProperty(preset,'fm',{enumerable:true,configurable:true,get(){if(++reads<=2)return original;return {...original,...(changed==='algorithm'?{algorithm:'chain'}:changed==='count'?{custom:fixture(6,1,true).custom}:{custom:graph([[0],[]])})};}});
    if(changed==='mode')Object.defineProperty(preset,'mode',{enumerable:true,configurable:true,get(){return ++modes===1?'fm6':'fm2';}});
    assert.throws(()=>owner.loadPatch(preset),/version 10/);assert.equal(writes,0);assert.deepEqual(owner.read(),before);assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
  }
    const forged=source.exportPatch();forged.fm.custom=fixture(6,1,true).custom;let versions=0;
    Object.defineProperty(forged,'version',{enumerable:true,configurable:true,get(){return ++versions===1?10:9;}});
    assert.throws(()=>owner.loadPatch(forged),/version 10/);assert.equal(versions,1);assert.equal(writes,0);assert.deepEqual(owner.read(),before);assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
  }finally{owner.core.write=write;}
  const request=fixture(6,0b101010,true).custom;let gets=0;owner.setConfig({mode:'fm6',fm:{custom:{get inputs(){gets++;owner.setConfig({fm:{depth:7}});return request.inputs;},outputs:request.outputs}}});assert.equal(gets,1);assert.equal(owner.read().config.fm.depth,7);
  request.inputs[1].length=0;assert.deepEqual(owner.read().config.fm.custom.inputs[1],[1]);const publicState=owner.read();publicState.config.fm.custom.inputs[3].length=0;assert.deepEqual(owner.read().config.fm.custom.inputs[3],[3]);
});

test('retained old Code groups keep every Self mapping across v10preset changes until the next attack',async t=>{
  const owner=await create(t),source=await create(t);waves(owner);waves(source);setup(owner,fixture(4,0b1010,true));setup(source,fixture(6,0b101010,true));const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);const previous=owner.read().voiceGroups[0];
  owner.loadPatch(source.exportPatch());assert.deepEqual(owner.read().voiceGroups[0],previous);owner.setConfig({fm:{depths:[2,4,6,12,9,11]}});owner.code(session,'setFrequency',[0,330]);
  for(const op of [1,3]){const slot=previous.operatorSlots[op];assert.equal(owner.read().slots[slot].modulation.depth,op===1?4:12);assert.equal(owner.read().slots[slot].modulation.xOffset,32);}
  owner.invoke('setMix',[3,{totalLevel:43}]);owner.setDspSourceSend(3,{input:1,level:5});assert.equal(owner.read().slots[previous.operatorSlots[3]].totalLevel,43);assert.equal(owner.read().dspRouting.slots[previous.operatorSlots[3]].level,5);
  owner.code(session,'noteOn',[0,69]);const state=owner.read();assert.equal(state.voiceGroups[0].slots.length,6);assert.equal(selfFeedbackCount(state.voiceGroups[0].config.fm.custom),3);assert.equal(state.config.mode,'fm6');
});

test('singleSelf/nonself versions stay4–9; v10is multiple4/6 only and uniformdepths still canonicalize',async t=>{
  const owner=await create(t);assert.equal(owner.exportPatch().version,4);setup(owner,fixture(4,1));assert.equal(owner.exportPatch().version,9);setup(owner,fixture(6,1));assert.equal(owner.exportPatch().version,9);
  owner.setConfig({mode:'fm2',fm:{custom:graph([[0],[]])}});assert.equal(owner.exportPatch().version,8);assert.throws(()=>customRouting(graph([[0],[1]])));
  setup(owner,fixture(4,3));owner.setConfig({fm:{depths:[5,5,5,5,5,5]}});const patch=owner.exportPatch();assert.equal(patch.version,10);assert.equal(patch.fm.depth,5);assert(!Object.hasOwn(patch.fm,'depths'));assert.equal(selfFeedbackCount(patch.fm.custom),2);assert(hasSelfFeedback(patch.fm.custom));
  owner.setConfig({fm:{algorithm:'chain'}});assert.equal(owner.exportPatch().version,4);assert(!Object.hasOwn(owner.exportPatch().fm,'custom'));owner.setConfig({fm:{depths:[1,2,3,4,5,6]}});assert.equal(owner.exportPatch().version,7);assert(!Object.hasOwn(owner.exportPatch().fm,'custom'));
});
