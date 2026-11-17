// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupScspDspRoutingView} from './dsp_routing_view.js';

function fixture() {
  const names = ['scspDspInput','scspDspSend','effectReturn','scspDspReturn0Pan',
    'scspDspReturn1Level','scspDspReturn1Pan','scspDspSource','scspDspSourceLabel',
    'scspDspRouteDefault','scspDspSendTarget','scspDspRouteStatus',
    'scspDspReturn0Status','scspDspReturn1Status','effectEnabled'];
  const nodes = Object.fromEntries(names.map(name => {
    const node = new EventTarget();
    Object.assign(node, {value: '', classList: {contains: () => false}, blur() {}});
    return [name,node];
  }));
  const root = {getElementById: name => nodes[name]}, edits = [];
  const view = setupScspDspRoutingView({root,
    onSend: (target,patch) => edits.push({target,patch}),
    onReturn: (output,patch) => edits.push({output,patch}),
    onSource: operator => edits.push({operator}),
    onError: error => {throw error;},
  });
  const state = {config: {effect: {enabled: true, send: 7, returnLevel: 6}},
    dspRouting: {sources: Array.from({length:6},() => ({input:0,level:7})), slots: Array.from({length:32},() => ({input:0,level:7}))},
    dspRoutingOverrides: {sources: Array(6).fill(null), slots: Array(32).fill(null)},
    dspReturns: [{level:6,pan:0},{level:7,pan:15}],
  };
  return {nodes,view,state,edits};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('send changes capture the selected CH before a queued edit and patch only that field', async () => {
  const {nodes,view,state,edits} = fixture();
  view.update(state,{selected:6});
  nodes.scspDspInput.value = '1';
  nodes.scspDspInput.dispatchEvent(new Event('change'));
  view.update(state,{selected:7});
  await tick();
  assert.deepEqual(edits,[{target:{kind:'slot',index:6},patch:{input:1}}]);
  assert.equal(nodes.scspDspSendTarget.textContent,'CH8 · Send');
  view.dispose();
});

test('Auto, inheritance reset and independent returns retain their exact targets', async () => {
  const {nodes,view,state,edits} = fixture();
  state.dspRouting.sources[2] = {input:1,level:4};
  state.dspRoutingOverrides.sources[2] = {input:1,level:4};
  view.update(state,{operator:2});
  assert.equal(nodes.scspDspSourceLabel.hidden,false);
  assert.equal(nodes.scspDspInput.value,'1');
  assert.equal(nodes.scspDspSend.value,'4');
  assert.equal(nodes.scspDspRouteDefault.disabled,false);
  nodes.scspDspRouteDefault.dispatchEvent(new Event('click'));
  nodes.scspDspReturn1Pan.value='31';
  nodes.scspDspReturn1Pan.dispatchEvent(new Event('change'));
  await tick();
  assert.deepEqual(edits,[{target:{kind:'source',index:2},patch:null},{output:1,patch:{pan:31}}]);
  assert.equal(nodes.scspDspReturn0Status.textContent,'Center');
  assert.equal(nodes.scspDspReturn1Status.textContent,'Right only');
  view.dispose();
});

test('SSF read-only and disposed views cannot send Synth edits', async () => {
  const {nodes,view,state,edits} = fixture();
  view.update(state,{selected:0,readOnly:true});
  for (const name of ['scspDspInput','scspDspSend','effectReturn','scspDspReturn0Pan','scspDspReturn1Level','scspDspReturn1Pan']) {
    assert.equal(nodes[name].disabled,true);
    nodes[name].value='1';nodes[name].dispatchEvent(new Event('change'));
  }
  nodes.scspDspRouteDefault.dispatchEvent(new Event('click'));
  await tick();assert.deepEqual(edits,[]);
  view.update(state,{selected:0});view.dispose();
  nodes.scspDspSend.dispatchEvent(new Event('change'));
  await tick();assert.deepEqual(edits,[]);
});
