// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupScspFmDepthView} from './fm_depth_view.js';

function fixture(){
  const input=new EventTarget();Object.assign(input,{value:'',disabled:false,classList:{contains:()=>false},blur(){this.blurred=true;}});
  const summary={},calls=[],errors=[],root={activeElement:null,getElementById:id=>id==='operatorDepth'?input:summary};
  const view=setupScspFmDepthView({root,onDepth:(...args)=>calls.push(args),onError:error=>errors.push(error)});
  const state={config:{mode:'fm4',fm:{depth:9,depths:[3,9,5,8,9,9]}}};
  return {input,summary,calls,errors,root,view,state};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('receiving OP depth uses array or legacy scalar without mutating config',async()=>{
  const {input,summary,calls,view,state}=fixture(),before=structuredClone(state);
  view.update(state,{operator:2});assert.equal(input.value,'5');assert(!input.disabled);
  assert.equal(summary.textContent,'Per-OP · A 3 · B 9 · C 5 · D 8');
  input.value='7';input.dispatchEvent(new Event('change'));
  view.update(state,{operator:0});await tick();assert.deepEqual(calls,[[2,7,4]]);
  assert(input.blurred);assert.deepEqual(state,before);
  delete state.config.fm.depths;view.update(state,{operator:1});assert.equal(input.value,'9');assert(summary.hidden);
  view.dispose();
});

test('PCM, unused OP and SSF contexts cannot issue depth edits',async()=>{
  const {input,calls,view,state}=fixture();
  for(const options of [{operator:4},{operator:0,readOnly:true}]){
    view.update(state,options);assert(input.disabled);input.dispatchEvent(new Event('change'));
  }
  state.config.mode='pcm';view.update(state);assert(input.disabled);input.dispatchEvent(new Event('change'));
  await tick();assert.deepEqual(calls,[]);view.dispose();
});

test('render preserves focused or dragged edits, disposal cancels queued operations',async()=>{
  const {input,calls,root,view,state}=fixture();view.update(state);
  root.activeElement=input;input.value='6';view.update(state);assert.equal(input.value,'6');
  root.activeElement=null;input.classList.contains=()=>true;view.update(state);assert.equal(input.value,'6');
  input.dispatchEvent(new Event('change'));view.dispose();await tick();assert.deepEqual(calls,[]);
  view.update(state,{operator:1});assert.equal(input.value,'6');
});
