// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupScspCycle2View} from './fm_cycle2_view.js';

function fixture(){
  const nodes=Object.fromEntries(['scspCycle2Option','scspCycle2Controls','scspCycle2Target','scspCycle2Input',
    'scspCycle2Output','scspCycle2Hint','scspOperatorDepthLabel'].map(id=>{
    const node=new EventTarget();Object.assign(node,{checked:false,disabled:false,blur(){this.blurred=true;}});return[id,node];
  }));
  const calls=[],errors=[],root={getElementById:id=>nodes[id]};
  const view=setupScspCycle2View({root,onOutput:(operator,enabled)=>calls.push({operator,enabled}),onError:error=>errors.push(error)});
  const state={config:{mode:'fm2',fm:{algorithm:'cycle2',depth:8,ratios:[1,1.5,1,1,1,1],cycle2:{outputs:[1]}}}};
  return {nodes,calls,errors,view,state};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const change=(node,enabled)=>{node.checked=enabled;node.dispatchEvent(new Event('change'));};

test('Cycle shows fixed receiving inputs, selected output and live requested B/A without mutating settings',async()=>{
  const {nodes,calls,view,state}=fixture();state.config.fm.ratios[0]=.5;
  const before=structuredClone(state);
  view.update(state,{operator:0});
  assert(!nodes.scspCycle2Option.disabled);assert(!nodes.scspCycle2Controls.hidden);
  assert.equal(nodes.scspCycle2Input.textContent,'B · history average');
  assert.equal(nodes.scspOperatorDepthLabel.textContent,'Depth · B → A (history)');
  assert(!nodes.scspCycle2Output.checked);assert(!nodes.scspCycle2Output.disabled);
  assert.match(nodes.scspCycle2Hint.textContent,/Direct output · B · Requested B\/A × 3$/);
  change(nodes.scspCycle2Output,true);await tick();
  assert.deepEqual(calls,[{operator:0,enabled:true}]);assert(nodes.scspCycle2Output.blurred);
  view.update(state,{operator:1});
  assert.equal(nodes.scspCycle2Input.textContent,'A · current');
  assert.equal(nodes.scspOperatorDepthLabel.textContent,'Depth · A → B');
  assert(nodes.scspCycle2Output.checked);
  change(nodes.scspCycle2Output,false);await tick();
  assert.deepEqual(calls,[{operator:0,enabled:true},{operator:1,enabled:false}]);
  assert.deepEqual(state,before);view.dispose();
});

test('connection choice is FM2-only and inactive/unused/read-only contexts never issue output edits',async()=>{
  const {nodes,calls,view,state}=fixture();
  view.update(state,{operator:2});assert(nodes.scspCycle2Output.disabled);
  assert.equal(nodes.scspCycle2Input.textContent,'Choose A or B');
  assert.equal(nodes.scspOperatorDepthLabel.textContent,'Selected depth (MDL)');
  change(nodes.scspCycle2Output,true);
  view.update(state,{readOnly:true});assert(nodes.scspCycle2Option.disabled);assert(nodes.scspCycle2Output.disabled);
  change(nodes.scspCycle2Output,true);
  state.config.fm.algorithm='custom';view.update(state);
  assert(nodes.scspCycle2Controls.hidden);assert(!nodes.scspCycle2Option.disabled);
  assert.equal(nodes.scspOperatorDepthLabel.textContent,'Selected depth (MDL)');
  change(nodes.scspCycle2Output,true);
  for(const mode of ['pcm','fm4','fm6']){
    state.config.mode=mode;state.config.fm.algorithm='chain';view.update(state);
    assert(nodes.scspCycle2Controls.hidden);assert(nodes.scspCycle2Option.disabled);
    change(nodes.scspCycle2Output,true);
  }
  await tick();assert.deepEqual(calls,[]);view.dispose();
});

test('all direct outputs and Depth-Off hints remain separate from requested ratio or operator selection',()=>{
  const {nodes,view,state}=fixture();
  state.config.fm.cycle2.outputs=[];state.config.fm.depths=[0,8,1,2,3,4];
  view.update(state);
  assert.match(nodes.scspCycle2Hint.textContent,/Direct outputs Off.*Depth 0: B → A$/);
  state.config.fm.cycle2.outputs=[0,1];state.config.fm.depths[1]=0;
  view.update(state,{operator:1});
  assert.match(nodes.scspCycle2Hint.textContent,/Direct output · A \+ B.*Depth 0: B → A \+ A → B$/);
  assert(nodes.scspCycle2Output.checked);
  assert.equal(nodes.scspCycle2Input.textContent,'A · current','Depth 0 keeps the declared fixed connection');
  view.dispose();
});

test('context changes cancel queued edits, while same-context polling preserves the captured operator and value',async()=>{
  const {nodes,calls,view,state}=fixture();view.update(state);
  change(nodes.scspCycle2Output,true);view.update(state,{operator:1});
  await tick();assert.deepEqual(calls,[],'selection changed before callback');
  change(nodes.scspCycle2Output,false);view.update(state,{operator:1});
  await tick();assert.deepEqual(calls,[{operator:1,enabled:false}]);
  change(nodes.scspCycle2Output,false);view.update(state,{operator:1,readOnly:true});
  view.update(state,{operator:1});await tick();assert.equal(calls.length,1,'read-only interruption cancels old callback');
  change(nodes.scspCycle2Output,false);state.config.mode='fm4';state.config.fm.algorithm='chain';view.update(state);
  await tick();assert.equal(calls.length,1,'mode change cancels old callback');
  view.dispose();
});

test('output callback errors are reported and disposal rejects queued and subsequent events',async()=>{
  const {nodes,errors,state,view:initial}=fixture();initial.dispose();
  const view=setupScspCycle2View({root:{getElementById:id=>nodes[id]},onOutput:async()=>{throw Error('test output failure');},onError:error=>errors.push(error)});
  view.update(state);change(nodes.scspCycle2Output,true);await tick();
  assert.equal(errors.length,1);assert.match(errors[0].message,/output failure/);
  change(nodes.scspCycle2Output,true);view.dispose();await tick();assert.equal(errors.length,1);
  change(nodes.scspCycle2Output,true);await tick();assert.equal(errors.length,1);
  const before=nodes.scspOperatorDepthLabel.textContent;view.update(state,{operator:1});
  assert.equal(nodes.scspOperatorDepthLabel.textContent,before);
});
