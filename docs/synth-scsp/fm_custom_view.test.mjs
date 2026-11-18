// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupScspCustomFmView} from './fm_custom_view.js';

function fixture() {
  const nodes=Object.fromEntries(['scspCustomFmInput','scspCustomFmInputY','scspCustomFmInputYLabel','scspCustomFmOutput','scspCustomFmControls',
    'scspCustomFmOption','scspCustomFmTarget','scspCustomFmHint'].map(id=>{
    const node=new EventTarget();Object.assign(node,{value:'',checked:false,blur(){this.blurred=true;}});return[id,node];
  }));
  for(const id of ['scspCustomFmInput','scspCustomFmInputY'])nodes[id].options=['',0,1,2,3,4,5].map(value=>({value:String(value)}));
  const calls=[],root={getElementById:id=>nodes[id]};
  const view=setupScspCustomFmView({root,onInput:(operator,source,port,count)=>calls.push({operator,source,port,count}),
    onOutput:(operator,enabled,count)=>calls.push({operator,enabled,count})});
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
  await tick();assert.deepEqual(calls,[{operator:0,source:null,port:0,count:2},{operator:1,enabled:true,count:2}]);
  assert.deepEqual(state,before);assert(nodes.scspCustomFmInput.blurred);view.dispose();
});

test('inactive modes, unused operators and SSF context cannot send custom edits',async()=>{
  const {nodes,calls,view,state}=fixture();
  for(const options of [{operator:2},{operator:0,readOnly:true}]){
    view.update(state,options);assert(nodes.scspCustomFmInput.disabled);assert(nodes.scspCustomFmOutput.disabled);
    nodes.scspCustomFmInput.dispatchEvent(new Event('change'));
  }
  state.config.mode='fm4';state.config.fm.algorithm='chain';view.update(state);
  assert(nodes.scspCustomFmControls.hidden);assert(!nodes.scspCustomFmOption.disabled,'Custom is available in all FM modes');
  nodes.scspCustomFmOutput.dispatchEvent(new Event('change'));
  await tick();assert.deepEqual(calls,[]);view.dispose();
});

test('two-input editing tracks X/Y, active count and distinct sources',async()=>{
  const {nodes,calls,view,state}=fixture();
  state.config.mode='fm4';state.config.fm.custom={inputs:[[1,2],[],[],[]],outputs:[0,3]};
  view.update(state,{operator:0});
  assert(!nodes.scspCustomFmInputYLabel.hidden);assert(!nodes.scspCustomFmInputY.disabled);
  assert.equal(nodes.scspCustomFmInput.value,'1');assert.equal(nodes.scspCustomFmInputY.value,'2');
  assert(nodes.scspCustomFmInput.options[3].disabled,'Y cannot also be X');
  assert(nodes.scspCustomFmInputY.options[2].disabled,'X cannot also be Y');
  assert(nodes.scspCustomFmInputY.options[5].hidden,'E is outside 4OP');
  assert.match(nodes.scspCustomFmHint.textContent,/A \+ D.*averaged/);
  nodes.scspCustomFmInputY.value='3';nodes.scspCustomFmInputY.dispatchEvent(new Event('change'));
  view.update(state,{operator:3});
  assert(nodes.scspCustomFmInputY.disabled,'Y waits for X');
  nodes.scspCustomFmInputY.dispatchEvent(new Event('change'));
  await tick();assert.deepEqual(calls,[{operator:0,source:3,port:1,count:4}]);
  state.config.mode='fm6';state.config.fm.custom={inputs:[[],[],[],[],[],[0,3]],outputs:[5]};view.update(state,{operator:5});
  assert(!nodes.scspCustomFmInputY.disabled);assert.equal(nodes.scspCustomFmInputY.value,'3');
  assert(nodes.scspCustomFmInput.options[6].disabled,'F cannot modulate itself');
  view.dispose();
});

test('2OP stays compact and PCM cannot choose Custom',()=>{
  const {nodes,view,state}=fixture();view.update(state);
  assert(nodes.scspCustomFmInputYLabel.hidden);assert(nodes.scspCustomFmInputY.disabled);
  state.config.mode='pcm';state.config.fm.algorithm='chain';view.update(state);
  assert(nodes.scspCustomFmOption.disabled);assert(nodes.scspCustomFmControls.hidden);view.dispose();
});

test('all outputs off are visible and queued edits are cancelled by disposal',async()=>{
  const {nodes,calls,view,state}=fixture();state.config.fm.custom.outputs=[];view.update(state);
  assert.match(nodes.scspCustomFmHint.textContent,/Direct outputs Off/);
  nodes.scspCustomFmInput.value='';nodes.scspCustomFmInput.dispatchEvent(new Event('change'));
  view.dispose();await tick();assert.deepEqual(calls,[]);
});
