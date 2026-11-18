// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupScspCustomFmView} from './fm_custom_view.js';

function fixture() {
  const nodes=Object.fromEntries(['scspCustomFmInput','scspCustomFmOutput','scspCustomFmControls',
    'scspCustomFmOption','scspCustomFmTarget','scspCustomFmHint'].map(id=>{
    const node=new EventTarget();Object.assign(node,{value:'',checked:false,blur(){this.blurred=true;}});return[id,node];
  }));
  nodes.scspCustomFmInput.options=[{value:''},{value:'0'},{value:'1'}];
  const calls=[],root={getElementById:id=>nodes[id]};
  const view=setupScspCustomFmView({root,onInput:(operator,source)=>calls.push({operator,source}),
    onOutput:(operator,enabled)=>calls.push({operator,enabled})});
  const state={config:{mode:'fm2',fm:{algorithm:'custom',custom:{inputs:[[1],[]],outputs:[0]}}}};
  return{nodes,calls,view,state};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('selected operator input and output events capture IDs without copying a stale graph',async()=>{
  const {nodes,calls,view,state}=fixture(),before=structuredClone(state);
  view.update(state,{operator:0});
  assert.equal(nodes.scspCustomFmInput.value,'1');assert(nodes.scspCustomFmOutput.checked);
  assert(nodes.scspCustomFmInput.options[1].disabled,'self source is unavailable in this editor');
  nodes.scspCustomFmInput.value='';nodes.scspCustomFmInput.dispatchEvent(new Event('change'));
  view.update(state,{operator:1});
  nodes.scspCustomFmOutput.checked=true;nodes.scspCustomFmOutput.dispatchEvent(new Event('change'));
  await tick();assert.deepEqual(calls,[{operator:0,source:null},{operator:1,enabled:true}]);
  assert.deepEqual(state,before);assert(nodes.scspCustomFmInput.blurred);view.dispose();
});

test('inactive modes, unused operators and SSF context cannot send custom edits',async()=>{
  const {nodes,calls,view,state}=fixture();
  for(const options of [{operator:2},{operator:0,readOnly:true}]){
    view.update(state,options);assert(nodes.scspCustomFmInput.disabled);assert(nodes.scspCustomFmOutput.disabled);
    nodes.scspCustomFmInput.dispatchEvent(new Event('change'));
  }
  state.config.mode='fm4';state.config.fm.algorithm='chain';view.update(state);
  assert(nodes.scspCustomFmControls.hidden);assert(nodes.scspCustomFmOption.disabled);
  nodes.scspCustomFmOutput.dispatchEvent(new Event('change'));
  await tick();assert.deepEqual(calls,[]);view.dispose();
});

test('all outputs off are visible and queued edits are cancelled by disposal',async()=>{
  const {nodes,calls,view,state}=fixture();state.config.fm.custom.outputs=[];view.update(state);
  assert.match(nodes.scspCustomFmHint.textContent,/Direct outputs Off/);
  nodes.scspCustomFmInput.value='';nodes.scspCustomFmInput.dispatchEvent(new Event('change'));
  view.dispose();await tick();assert.deepEqual(calls,[]);
});
