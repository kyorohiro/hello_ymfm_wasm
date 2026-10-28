import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundPs1VoicePanel} from './playground_ps1_voice_panel.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
class Events {
  constructor() {this.listeners = new Map();}
  addEventListener(name, callback) {if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback);}
  removeEventListener(name, callback) {this.listeners.get(name)?.delete(callback);}
  async fire(type, extra = {}) {await Promise.all([...this.listeners.get(type) ?? []].map(callback => callback({type, target:this, preventDefault() {}, ...extra}))); await flush();}
}
class Element extends Events {
  constructor(doc, tag) {super(); this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.checked = false;}
  appendChild(node) {this.children.push(node); node.parentNode = this; return node;}
  replaceChildren(...nodes) {this.children = []; for (const node of nodes) this.appendChild(node);}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name];}
  setCustomValidity(value) {this.validityMessage = value;}
  reportValidity() {}
  setPointerCapture() {}
  getContext() {return this.context ?? null;}
}
const walk = root => [root, ...root.children.flatMap(walk)];
const control = (root, name) => walk(root).find(node => node.dataset.chipControl === `ps1-${name}`);
const action = (root, name) => walk(root).find(node => node.dataset.chipAction === `ps1-${name}`);
const channel = (root, index) => walk(root).find(node => node.dataset.chipChannel === String(index));
const output = (root, name) => walk(root).find(node => node.dataset.chipOutput === `ps1-${name}`);
const state = () => ({
  kind:'ps1', channels:Array.from({length:24}, (_, ch) => ({sample:0, pitch:4096 + ch, volumeLeft:.75, volumeRight:.5, adsr1:0x9234, adsr2:0xe6e8, reverb:ch === 1, gate:ch === 0})),
  samples:[{id:0, decodedFrames:112, byteLength:64, startAddress:4096, rootFrequencyHz:393.75, basePitch:4096, loop:true}],
  reverb:{preset:'off', volumeLeft:.25, volumeRight:.3},
});
function fixture(options = {}) {
  const win = new Events(); win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  const copied = []; win.navigator = {clipboard:{writeText:async text => copied.push(text)}};
  const doc = new Events(); doc.defaultView = win; doc.activeElement = null; doc.hidden = false; doc.createElement = tag => new Element(doc, tag);
  const root = new Element(doc, 'div'), calls = [], targets = [], errors = [];
  const panel = createPlaygroundPs1VoicePanel({root, invoke:async (...args) => {calls.push(args);}, onKeyboardTargetChange:value => targets.push(value), onError:error => errors.push(error), ...options});
  panel.setConnected(true); panel.update(state());
  return {root, doc, win, calls, targets, errors, copied, panel};
}
async function change(root, name, value) {const node = control(root, name); if (node.type === 'checkbox') node.checked = value; else node.value = String(value); await node.fire('change');}

test('PS1 readback exposes 24 voices, decoded ADSR and shared reverb without audio writes', () => {
  const {root, calls, panel} = fixture();
  assert.equal(walk(root).filter(node => node.dataset.chipChannel !== undefined).length, 24);
  assert.equal(control(root, 'attack-rate').value, '18'); assert.equal(control(root, 'decay-rate').value, '3'); assert.equal(control(root, 'sustain-level').value, '4');
  assert.equal(control(root, 'sustain-rate').value, '27'); assert.equal(control(root, 'release-rate').value, '8');
  for (const name of ['attack-exponential','sustain-exponential','sustain-decrease','release-exponential','retrigger']) assert.equal(control(root, name).checked, true);
  assert.equal(control(root, 'reverb-send').checked, false); assert.equal(control(root, 'reverb-preset').value, 'off'); assert.equal(control(root, 'reverb-left').value, '0.25');
  assert.equal(control(root, 'reverb-preset').children.length, 8); assert.match(output(root, 'envelope').textContent, /A 18.*D 3.*SL 4.*S 27.*R 8/); assert.match(output(root, 'sample').textContent, /64 ADPCM bytes.*Root 393.750/);
  assert.equal(output(root, 'gate').textContent, 'On'); assert.deepEqual(calls, []); panel.dispose();
});

test('ADSR edits send independent fields with explicit owned-note retrigger and raw words stay advanced', async () => {
  const {root, calls, panel} = fixture();
  for (const [name, value] of [['attack-rate',127], ['decay-rate',15], ['sustain-level',0], ['sustain-rate',126], ['release-rate',26], ['attack-exponential',false], ['sustain-decrease',false], ['sustain-exponential',false], ['release-exponential',false]]) await change(root, name, value);
  assert.deepEqual(calls.map(value => value[0]), Array(9).fill('setEnvelope'));
  assert.deepEqual(calls.map(value => value[1]), [['attackRate',127], ['decayRate',15], ['sustainLevel',0], ['sustainRate',126], ['releaseRate',26], ['attackExponential',false], ['sustainDecrease',false], ['sustainExponential',false], ['releaseExponential',false]].map(([key,value]) => [0,{[key]:value},{retrigger:true}]));
  await change(root, 'retrigger', false); assert.equal(calls.length, 9);
  await change(root, 'attack-rate', 50); assert.deepEqual(calls.at(-1), ['setEnvelope',[0,{attackRate:50},{retrigger:false}]]);
  await change(root, 'adsr1', 65535); await change(root, 'adsr2', 8192);
  assert.deepEqual(calls.slice(-2), [['setPreset',[0,{adsr1:65535},{retrigger:false}]], ['setPreset',[0,{adsr2:8192},{retrigger:false}]]]);
  assert.equal(control(root, 'adsr1').parentNode.parentNode.parentNode.tagName, 'details'); panel.dispose();
});

test('focused controls retain edits and a schematic redraw never invokes audio or fabricates milliseconds', async () => {
  const {root, doc, calls, panel} = fixture(), canvas = control(root, 'envelope'), drawn = [];
  canvas.context = new Proxy({}, {set(target,key,value) {target[key] = value; return true;}, get(target,key) {return target[key] ?? ((...args) => drawn.push([key,...args]));}});
  const focused = control(root, 'attack-rate'); doc.activeElement = focused; focused.value = '99';
  const next = state(); next.channels[0].adsr1 = 0x7f0f; next.channels[0].adsr2 = 0x1fdf; panel.update(next);
  assert.equal(focused.value, '99'); assert.equal(control(root, 'sustain-rate').value, '127'); assert.match(output(root, 'envelope').textContent, /hold.*infinite.*illustrative/);
  assert(drawn.some(value => value[0] === 'lineTo')); assert.match(canvas.getAttribute('aria-label'), /illustrative, not elapsed time/);
  assert.doesNotMatch(output(root, 'envelope').textContent, /\d\s*(?:ms|seconds)/); assert.deepEqual(calls, []);
  panel.setVisible(false); const before = drawn.length; panel.update(state()); assert.equal(drawn.length, before); panel.setVisible(true); assert(drawn.length > before); panel.dispose();
});

test('invalid ADSR, pitch and return values never write and valid fractional volumes stay available', async () => {
  const {root, calls, panel} = fixture();
  for (const [name,value] of [['attack-rate',128], ['decay-rate',16], ['sustain-level',-1], ['sustain-rate',.5], ['release-rate',32], ['adsr1',65536], ['adsr2',-1], ['pitch',16384], ['reverb-left',1.01], ['reverb-right',''], ['volume-left',-1.01]]) await change(root,name,value);
  assert.deepEqual(calls, []); await change(root,'volume-left',-.25); await change(root,'volume-right',.33);
  assert.deepEqual(calls, [['setPreset',[0,{volumeLeft:-.25}]], ['setPreset',[0,{volumeRight:.33}]]]); panel.dispose();
});

test('the schematic identifies stopped attack and sustain at the retained core table limits', () => {
  const {root,calls,panel} = fixture();
  for (const [adsr1,adsr2,attackHeld,sustainHeld] of [[107<<8,107<<6,false,false],[108<<8,108<<6,true,true],[0x8000|(99<<8),0x8000|(99<<6),false,false],[0x8000|(100<<8),0x8000|(100<<6),true,true],[0x8000|(100<<8),0xc000|(107<<6),true,false],[0x8000|(100<<8),0xc000|(108<<6),true,true]]) {
    const next = state(); Object.assign(next.channels[0],{adsr1,adsr2}); panel.update(next); const info = output(root,'envelope').textContent;
    assert.equal(info.includes('stopped at zero'),attackHeld); assert.equal(info.includes('(hold)'),sustainHeld);
  }
  assert.deepEqual(calls,[]); panel.dispose();
});

test('selected voice reverb switch and chip-wide preset/return edits remain separate without triggering notes', async () => {
  const {root, calls, panel, copied} = fixture(); await channel(root, 23).fire('click');
  await change(root,'reverb-send',true); await change(root,'reverb-preset','hall'); await change(root,'reverb-left',.4); await change(root,'reverb-right',.5);
  assert.deepEqual(calls, [['setPreset',[23,{reverb:true}]], ['setReverb',[{preset:'hall'}]], ['setReverb',[{volumeLeft:.4}]], ['setReverb',[{volumeRight:.5}]]]);
  const next = state(); next.channels[23].reverb = true; next.reverb = {preset:'hall',volumeLeft:.4,volumeRight:.5}; panel.update(next);
  assert.equal(control(root,'reverb-send').checked,true); assert.equal(control(root,'reverb-preset').value,'hall');
  await action(root,'copy').fire('click'); assert.equal(copied.length,1); assert.match(copied[0],/spu\.setPreset\(23,.*"reverb":true/); assert.match(copied[0],/spu\.setReverb\(.*"preset":"hall"/); panel.dispose();
});

test('latched Sustain play permits editing without key release and toggles only its own note', async () => {
  const {root, calls, panel} = fixture(); await change(root,'audition-midi',69); await action(root,'sustain').fire('click');
  assert.equal(action(root,'sustain').getAttribute('aria-pressed'),'true'); assert.deepEqual(calls[0].slice(0,1),['auditionOn']); assert.deepEqual(calls[0][1].slice(0,2),[0,69]);
  await change(root,'attack-rate',10); await change(root,'volume-left',.6);
  assert.deepEqual(calls.map(value => value[0]),['auditionOn','setEnvelope','setPreset']);
  panel.update(state()); assert.equal(action(root,'sustain').getAttribute('aria-pressed'),'true');
  await action(root,'sustain').fire('click'); assert.deepEqual(calls.at(-1),['auditionOff',[0,calls[0][1][2]]]); assert.equal(action(root,'sustain').getAttribute('aria-pressed'),'false'); panel.dispose();
});

test('latched audition releases on hide, channel change, blur, document hide and disconnect', async () => {
  for (const reason of ['hide','channel','blur','document','disconnect']) {
    const {root, doc, win, calls, panel} = fixture(); await action(root,'sustain').fire('click');
    if (reason === 'hide') panel.setVisible(false); else if (reason === 'channel') await channel(root,23).fire('click'); else if (reason === 'blur') await win.fire('blur'); else if (reason === 'document') {doc.hidden=true;await doc.fire('visibilitychange');} else panel.setConnected(false);
    assert.equal(calls.length,2,reason); assert.deepEqual(calls[1],['auditionOff',[0,calls[0][1][2]]]); assert.equal(action(root,'sustain').getAttribute('aria-pressed'),'false'); panel.dispose();
  }
});

test('Hold pointer and key ownership ignores releases from replaced presses', async () => {
  const {root, calls, panel} = fixture(), hold = action(root,'hold');
  await hold.fire('pointerdown',{pointerId:1,button:0}); await hold.fire('pointerdown',{pointerId:2,button:0}); assert.equal(calls.length,3);
  await hold.fire('pointerup',{pointerId:1}); assert.equal(calls.length,3); await hold.fire('pointercancel',{pointerId:2}); assert.equal(calls.length,4);
  await hold.fire('keydown',{key:'Enter',repeat:false}); await hold.fire('keyup',{key:' '}); assert.equal(calls.length,5); await hold.fire('keyup',{key:'Enter'}); assert.equal(calls.length,6);
  await hold.fire('keydown',{key:'Enter',repeat:true}); await hold.fire('pointerdown',{pointerId:3,button:1}); assert.equal(calls.length,6); panel.dispose();
});

test('one-second preview is bounded and hidden panels cannot start preview, latch or Hold', async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const {root,calls,panel} = fixture();
  await action(root,'play').fire('click'); t.mock.timers.tick(999); assert.equal(calls.length,1); t.mock.timers.tick(1); await flush(); assert.equal(calls.length,2);
  await action(root,'play').fire('click'); panel.setVisible(false); assert.equal(calls.length,4); t.mock.timers.tick(1000); await flush(); assert.equal(calls.length,4);
  await action(root,'play').fire('click'); await action(root,'sustain').fire('click'); await action(root,'hold').fire('pointerdown',{pointerId:1,button:0}); assert.equal(calls.length,4); panel.dispose();
});

test('Keyboard press identities survive visible editing and old-channel releases cannot stop replacements', async () => {
  const {root,calls,targets,panel} = fixture(); await action(root,'keyboard').fire('click'); const first = targets.at(-1);
  first.noteOn({id:'press',midi:60}); await flush(); await change(root,'release-rate',12); assert.equal(calls[1][0],'setEnvelope');
  await channel(root,23).fire('click'); const second = targets.at(-1); second.noteOn({id:'press',midi:67}); first.noteOff({id:'press'}); first.allNotesOff(); first.noteOn({id:'old',midi:69}); await flush();
  assert.deepEqual(calls.map(value => value[0]),['auditionOn','setEnvelope','auditionOff','auditionOn']); assert.equal(calls.at(-1)[1][0],23);
  panel.setVisible(false); second.noteOff({id:'press'}); await flush(); second.noteOn({id:'hidden',midi:69}); await flush(); assert.equal(calls.at(-1)[0],'auditionOn','the established shared Keyboard remains usable when its chip tab is hidden');
  panel.setKeyboardActive(false); second.noteOn({id:'retired',midi:72}); await flush(); assert.equal(calls.at(-1)[0],'auditionOff');
  panel.setVisible(true); await action(root,'keyboard').fire('click'); panel.setConnected(false); assert.equal(targets.at(-1),null); panel.dispose();
});

test('Release retires all locally held sources but never emits a chip-wide stop/reset', async () => {
  const {root,calls,targets,panel} = fixture(); await action(root,'sustain').fire('click'); await action(root,'keyboard').fire('click'); targets.at(-1).noteOn({id:'key',midi:64}); await flush(); await action(root,'play').fire('click');
  await action(root,'release').fire('click'); assert.equal(calls.filter(value => value[0] === 'auditionOn').length,3); assert.equal(calls.filter(value => value[0] === 'auditionOff').length,3); assert(calls.every(value => ['auditionOn','auditionOff'].includes(value[0]))); panel.dispose();
});

test('a transport reset snapshot clears stale pressed indicators without releasing replacement voices', async () => {
  const {root,calls,panel} = fixture(); await action(root,'sustain').fire('click'); await action(root,'hold').fire('pointerdown',{pointerId:1,button:0}); await action(root,'play').fire('click');
  const next = state(); next.auditions = [{channel:0,id:'replacement-owner'}]; panel.update(next);
  assert.equal(action(root,'sustain').getAttribute('aria-pressed'),'false'); assert.equal(action(root,'hold').getAttribute('aria-pressed'),'false');
  await action(root,'release').fire('click'); await action(root,'hold').fire('pointerup',{pointerId:1}); assert.deepEqual(calls.map(entry => entry[0]),['auditionOn','auditionOn','auditionOn']);
  panel.dispose();
});

test('direct audition prepares the output gate before sending On and pending snapshots keep its press identity', async () => {
  let finishPrepare; const order = [];
  const {root,panel} = fixture({ensureAudioReady:() => {order.push('prepare');return new Promise(resolve => {finishPrepare = resolve;});},invoke:async method => {order.push(method);}});
  await action(root,'sustain').fire('click'); assert.deepEqual(order,['prepare']); assert.equal(action(root,'sustain').getAttribute('aria-pressed'),'true');
  const pending = state(); pending.auditions = []; panel.update(pending);
  finishPrepare(); await flush(); assert.deepEqual(order,['prepare','auditionOn']);
  await action(root,'release').fire('click'); assert.deepEqual(order,['prepare','auditionOn','auditionOff']); panel.dispose();
});

test('release, tab hiding and channel changes cancel pending audio preparation without a late On', async () => {
  for (const cancel of ['release','hide','channel']) {
    let finishPrepare; const {root,calls,panel} = fixture({ensureAudioReady:() => new Promise(resolve => {finishPrepare=resolve;})});
    await action(root,'sustain').fire('click'); assert.deepEqual(calls,[]);
    if (cancel === 'release') await action(root,'release').fire('click'); else if (cancel === 'hide') panel.setVisible(false); else await channel(root,23).fire('click');
    finishPrepare(); await flush(); assert.deepEqual(calls,[],cancel); assert.equal(action(root,'sustain').getAttribute('aria-pressed'),'false'); panel.dispose();
  }
});

test('failed preparation clears the local press and disconnected or disposed completions stay silent', async () => {
  let failPrepare; const failed = fixture({ensureAudioReady:() => new Promise((resolve,reject) => {failPrepare=reject;})});
  await action(failed.root,'sustain').fire('click'); failPrepare(new Error('Output unavailable')); await flush();
  assert.deepEqual(failed.calls,[]); assert.equal(failed.errors.length,1); assert.equal(action(failed.root,'sustain').getAttribute('aria-pressed'),'false'); failed.panel.dispose();
  for (const cancel of ['disconnect','dispose']) {
    let finishPrepare; const {root,calls,errors,panel} = fixture({ensureAudioReady:() => new Promise(resolve => {finishPrepare=resolve;})});
    await action(root,'hold').fire('pointerdown',{pointerId:1,button:0});
    if (cancel === 'disconnect') {panel.setConnected(false);panel.setConnected(true);} else panel.dispose();
    finishPrepare(); await flush(); assert.deepEqual(calls,[],cancel); assert.deepEqual(errors,[]); assert.equal(action(root,'hold').getAttribute('aria-pressed'),'false'); panel.dispose();
  }
});

test('disconnect fences stale errors and disposal removes every listener', async () => {
  let rejectCommand; const {root,panel,doc,win,errors} = fixture({invoke:() => new Promise((resolve,reject) => {rejectCommand=reject;})});
  await change(root,'attack-rate',30); panel.setConnected(false); panel.setConnected(true); rejectCommand(new Error('Old chip disconnected')); await flush(); assert.deepEqual(errors,[]);
  panel.dispose(); panel.dispose(); for (const node of [...walk(root),doc,win]) assert.equal([...node.listeners.values()].reduce((sum,listeners) => sum + listeners.size,0),0);
});
