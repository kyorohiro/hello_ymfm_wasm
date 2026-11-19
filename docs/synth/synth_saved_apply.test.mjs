// Exercise the actual saved-tone application route without an audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {modulationSettings} from './synth_modulation.js';
const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const apply=source.slice(source.indexOf('function applySavedFmEdits('),source.indexOf('function applySavedAuthors('));
const operator={dt:0,multi:1,tl:0,rs:0,ar:31,am:false,d1r:0,d2r:0,sl:0,rr:6,ssg:0};
const preset=()=>({algorithm:7,feedback:0,ams:0,pms:0,pan:{left:true,right:true},lfo:{enabled:false,frequency:0},operators:{1:{...operator},2:{...operator},3:{...operator},4:{...operator}}});
function harness(){
  const edits=[],special=[],gates=[],forwarded=[];
  const scope=vm.createContext({DEFAULT_OPERATOR_STATE:operator,OPERATOR_NUMBERS:[1,2,3,4],VOICE_COUNT:6,modulationWheelValue:0,modulationSettings,
    fmEdits:{apply:(channel,patch)=>edits.push([channel,structuredClone(patch)])},forwardAuthorFmEdit:patch=>forwarded.push(structuredClone(patch)),
    synth:{setChannel3SpecialMode:value=>special.push(['mode',value]),setChannel3SpecialFrequency:(...args)=>special.push(['special',...args]),setFrequency:(...args)=>special.push(['pitch',...args])},
    codeAudio:{syncFmVoice:()=>gates.push('code')},voices:[{held:true,channel:2},{held:false,channel:1}],editorPerformanceTarget:{setKeyMask:channel=>gates.push(channel)}});
  vm.runInContext(apply,scope);return{scope,edits,special,gates,forwarded};
}
test('saving an FM operator edit changes only that field and preserves Code pitch, mode, gates and companion registers',()=>{
  const h=harness(),before=preset(),after=structuredClone(before);after.operators[4].tl=37;
  h.scope.applySavedFmEdits(before,after);
  assert.deepEqual(h.edits,Array.from({length:6},(_,channel)=>[channel,{'operators.4.tl':37}]));
  assert.deepEqual(h.forwarded,[{'operators.4.tl':37}]);assert.deepEqual(h.special,[]);assert.deepEqual(h.gates,[]);
  assert.deepEqual(before,preset(),'saved baseline is not mutated');
});
test('saving unchanged FM files emits nothing and zero/one-based operators compare identically',()=>{
  const h=harness(),before=preset(),after=structuredClone(before);after.operators=Object.values(after.operators);
  h.scope.applySavedFmEdits(before,after);assert.deepEqual(h.edits,[]);assert.deepEqual(h.special,[]);assert.deepEqual(h.gates,[]);
});
test('saving a gate selection updates held notes without writing their frequencies',()=>{
  const h=harness(),before=preset(),after=structuredClone(before);after.capturedVoice={keyMask:5,specialMode:false,specialFrequencies:[]};
  h.scope.applySavedFmEdits(before,after);assert.deepEqual(h.edits,[]);assert.deepEqual(h.special,[]);assert.deepEqual(h.gates,['code',2]);
});
test('accepted CH3 metadata writes only its explicitly changed hardware mode and four pitches',()=>{
  const h=harness(),before=preset(),after=structuredClone(before);after.capturedVoice={keyMask:15,specialMode:true,specialFrequencies:Array.from({length:4},(_,index)=>({block:3,fnum:200+index}))};
  h.scope.applySavedFmEdits(before,after);assert.deepEqual(h.edits,[]);assert.deepEqual(h.gates,[]);
  assert.deepEqual(h.special,[['mode',true],...after.capturedVoice.specialFrequencies.map((pitch,index)=>['special',index,pitch.block,pitch.fnum]),['pitch',2,3,203]]);
});
