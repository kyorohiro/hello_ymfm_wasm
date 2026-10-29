import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundPs1VoicePanel, ps1VoiceCode} from './playground_ps1_voice_panel.js';
import {ps1EnvelopeGeometry, ps1EnvelopePointPatch} from './playground_ps1_envelope.js';
import {decodePs1Envelope} from '../js/ps1_parameters.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
class Events {
  constructor() {this.listeners = new Map();}
  addEventListener(name, callback) {if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback);}
  removeEventListener(name, callback) {this.listeners.get(name)?.delete(callback);}
  async fire(type, extra = {}) {await Promise.all([...this.listeners.get(type) ?? []].map(callback => callback({type, target:this, preventDefault() {}, ...extra}))); await flush();}
}
class Element extends Events {
  constructor(doc, tag) {super(); this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.style = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.checked = false;}
  appendChild(node) {this.children.push(node); node.parentNode = this; return node;}
  replaceChildren(...nodes) {this.children = []; for (const node of nodes) this.appendChild(node);}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name];}
  setCustomValidity(value) {this.validityMessage = value;}
  reportValidity() {}
  setPointerCapture() {}
  getBoundingClientRect() {return {left:0, top:0, width:800, height:180};}
  getContext() {return this.context ?? null;}
}
const walk = root => [root, ...root.children.flatMap(walk)];
const control = (root, name) => walk(root).find(node => node.dataset.chipControl === `ps1-${name}`);
const action = (root, name) => walk(root).find(node => node.dataset.chipAction === `ps1-${name}`);
const channel = (root, index) => walk(root).find(node => node.dataset.chipChannel === String(index));
const output = (root, name) => walk(root).find(node => node.dataset.chipOutput === `ps1-${name}`);
const envelopeHandle = (root, name) => walk(root).find(node => node.dataset.chipEnvelopeHandle === name);
async function beginEnvelope(root, name, pointerId = 1) {
  const node = envelopeHandle(root, name), point = {clientX:parseFloat(node.style.left) * 8, clientY:parseFloat(node.style.top) * 1.8, pointerId};
  await node.fire('pointerdown', {...point, button:0}); return point;
}
const state = () => ({
  kind:'ps1', channels:Array.from({length:24}, (_, ch) => ({sample:0, pitch:4096 + ch, volumeLeft:.75, volumeRight:.5, adsr1:0x9234, adsr2:0xe6e8, reverb:ch === 1, gate:ch === 0})),
  samples:[{id:0, decodedFrames:112, byteLength:64, startAddress:4096, rootFrequencyHz:393.75, basePitch:4096, loop:true}],
  reverb:{preset:'off', volumeLeft:.25, volumeRight:.3},
});
function waveformState(channel = 0) {
  const next = state(), pcm = Array.from({length:112}, (_, index) => (2 * index / 111 - 1) * .5);
  next.samples.push({...next.samples[0], id:1, startAddress:4160, editorChannel:channel});
  next.channels[channel].sample = 1; next.channels[channel].waveform = {sample:1, pcm};
  return next;
}
function fixture(options = {}) {
  const win = new Events(); win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  const frames = new Map(); let frameId = 0;
  win.requestAnimationFrame = callback => {frames.set(++frameId, callback); return frameId;}; win.cancelAnimationFrame = id => frames.delete(id);
  const frame = async () => {const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); await flush();};
  const copied = []; win.navigator = {clipboard:{writeText:async text => copied.push(text)}};
  const doc = new Events(); doc.defaultView = win; doc.activeElement = null; doc.hidden = false; doc.createElement = tag => new Element(doc, tag);
  const root = new Element(doc, 'div'), calls = [], targets = [], errors = [];
  const panel = createPlaygroundPs1VoicePanel({root, invoke:async (...args) => {calls.push(args);}, onKeyboardTargetChange:value => targets.push(value), onError:error => errors.push(error), ...options});
  panel.setConnected(true); panel.update(state());
  return {root, doc, win, calls, targets, errors, copied, panel, frame};
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

test('ADSR edits send independent fields with explicit live owned-note updates and raw words stay advanced', async () => {
  const {root, calls, panel} = fixture();
  for (const [name, value] of [['attack-rate',127], ['decay-rate',15], ['sustain-level',0], ['sustain-rate',126], ['release-rate',26], ['attack-exponential',false], ['sustain-decrease',false], ['sustain-exponential',false], ['release-exponential',false]]) await change(root, name, value);
  assert.deepEqual(calls.map(value => value[0]), Array(9).fill('setEnvelope'));
  assert.deepEqual(calls.map(value => value[1]), [['attackRate',127], ['decayRate',15], ['sustainLevel',0], ['sustainRate',126], ['releaseRate',26], ['attackExponential',false], ['sustainDecrease',false], ['sustainExponential',false], ['releaseExponential',false]].map(([key,value]) => [0,{[key]:value},{live:true}]));
  await change(root, 'retrigger', false); assert.equal(calls.length, 9);
  await change(root, 'attack-rate', 50); assert.deepEqual(calls.at(-1), ['setEnvelope',[0,{attackRate:50},{live:false}]]);
  await change(root, 'adsr1', 65535); await change(root, 'adsr2', 8192);
  assert.deepEqual(calls.slice(-2), [['setPreset',[0,{adsr1:65535},{live:false}]], ['setPreset',[0,{adsr2:8192},{live:false}]]]);
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

test('PS1 graph mappings round-trip every rate code and sustain level, including stopped stages', () => {
  for (const attackExponential of [false, true]) for (const sustainDecrease of [false, true]) {
    const values = {...decodePs1Envelope(0xffff,0xffff), attackExponential, sustainDecrease};
    for (const [id,key,max] of [['attack','attackRate',127],['decay','decayRate',15],['sustain','sustainRate',127],['release','releaseRate',31]]) {
      for (let rate = 0; rate <= max; rate++) {
        const value = {...values,[key]:rate}, point = ps1EnvelopeGeometry(value).handles.find(point => point.id === id);
        assert.deepEqual(ps1EnvelopePointPatch(value,id,point.x,point.y),{[key]:rate,...(id === 'decay' ? {sustainLevel:value.sustainLevel} : {})});
      }
      assert.equal(ps1EnvelopePointPatch(values,id,-10000,0)[key],0); assert.equal(ps1EnvelopePointPatch(values,id,10000,0)[key],max);
    }
    for (let sustainLevel = 0; sustainLevel < 16; sustainLevel++) {
      const value = {...values,sustainLevel}, point = ps1EnvelopeGeometry(value).handles[1];
      assert.equal(ps1EnvelopePointPatch(value,'decay',point.x,point.y).sustainLevel,sustainLevel);
    }
  }
  assert.equal(ps1EnvelopePointPatch({},'attack',NaN,0),null);
});

test('four graph handles edit native rates and decay level, synchronize fields and honor live updates', async () => {
  const {root,calls,panel,frame} = fixture(), canvas = control(root,'envelope');
  for (const [name,key,max,value,level] of [['attack','attackRate',127,65],['decay','decayRate',15,10,9],['sustain','sustainRate',127,87],['release','releaseRate',31,19]]) {
    const from = await beginEnvelope(root,name);
    const point = ps1EnvelopeGeometry({...decodePs1Envelope(0x9234,0xe6e8),...Object.assign({},...calls.map(([,args]) => args[1]))}).handles.find(point => point.id === name);
    const next = {pointerId:from.pointerId,clientX:point.from+(point.to-point.from)*value/max,clientY:level === undefined ? from.clientY : 148-(level+1)/16*130};
    await canvas.fire('pointermove',next); assert.equal(calls.length,['attack','decay','sustain','release'].indexOf(name),'No audio command before frame');
    assert.equal(control(root,key.replace(/[A-Z]/g,value=>'-'+value.toLowerCase())).value,String(value));
    await frame(); await canvas.fire('pointerup',next);
    assert.deepEqual(calls.at(-1),['setEnvelope',[0,{[key]:value,...(level === undefined ? {} : {sustainLevel:level})},{live:true}]]);
  }
  await change(root,'retrigger',false); const from = await beginEnvelope(root,'attack');
  await canvas.fire('pointermove',{...from,clientX:10000}); await canvas.fire('pointerup',{...from,clientX:10000});
  assert.deepEqual(calls.at(-1),['setEnvelope',[0,{attackRate:127},{live:false}]]); panel.dispose();
});

test('graph edits coalesce events, retain unsent values across snapshots and serialize slow inspector writes', async () => {
  const sent = [], finish = [];
  const {root,panel,frame} = fixture({invoke:(...args) => {sent.push(args); return new Promise(resolve => finish.push(resolve));}}), canvas = control(root,'envelope');
  const from = await beginEnvelope(root,'attack');
  for (let dx = 1; dx <= 30; dx++) await canvas.fire('pointermove',{...from,clientX:from.clientX+dx});
  panel.update(state()); assert.notEqual(control(root,'attack-rate').value,'18','Applied readback cannot erase an unsent drag');
  await frame(); assert.equal(sent.length,1);
  for (let dx = 31; dx <= 100; dx++) await canvas.fire('pointermove',{...from,clientX:from.clientX+dx});
  await frame(); await canvas.fire('pointerup',{...from,clientX:from.clientX+100}); assert.equal(sent.length,1,'Only one write is in flight');
  finish.shift()(); await flush(); await frame(); assert.equal(sent.length,2); assert(sent[1][1][1].attackRate>sent[0][1][1].attackRate);
  finish.shift()(); await flush(); await frame(); assert.equal(sent.length,2,'A settled graph never polls'); panel.dispose();
});

test('plain graph clicks, other buttons and foreign pointers never rewrite or quantize ADSR', async () => {
  const {root,calls,panel,frame} = fixture(), canvas = control(root,'envelope'), handle = envelopeHandle(root,'attack');
  const from = await beginEnvelope(root,'attack');
  await canvas.fire('pointermove',{...from,pointerId:2,clientX:600}); await canvas.fire('pointerup',{...from,pointerId:2,clientX:600});
  await canvas.fire('pointerup',from); await frame(); assert.deepEqual(calls,[]);
  for (const extra of [{button:2},{isPrimary:false}]) {
    await handle.fire('pointerdown',{...from,button:0,...extra}); await canvas.fire('pointermove',{...from,clientX:600}); await canvas.fire('pointerup',{...from,clientX:600}); await frame();
  }
  assert.deepEqual(calls,[]); panel.dispose();
});

test('graph cancellation, lifecycle changes and numeric overrides retire pending moves and stale releases', async () => {
  for (const reason of ['cancel','lost','channel','hide','blur','hidden','disconnect','dispose','raw','numeric']) {
    const {root,calls,panel,frame,win,doc} = fixture(), canvas = control(root,'envelope'), from = await beginEnvelope(root,'attack');
    await canvas.fire('pointermove',{...from,clientX:from.clientX+50});
    if (reason === 'cancel') await canvas.fire('pointercancel',from);
    else if (reason === 'lost') await canvas.fire('lostpointercapture',from);
    else if (reason === 'channel') await channel(root,23).fire('click');
    else if (reason === 'hide') panel.setVisible(false);
    else if (reason === 'blur') await win.fire('blur');
    else if (reason === 'hidden') {doc.hidden=true; await doc.fire('visibilitychange');}
    else if (reason === 'disconnect') panel.setConnected(false);
    else if (reason === 'dispose') panel.dispose();
    else await change(root,reason === 'raw' ? 'adsr1' : 'attack-rate',reason === 'raw' ? 15 : 2);
    const after = calls.length;
    await canvas.fire('pointerup',{...from,clientX:700}); await frame(); assert.equal(calls.length,after,reason);
    if (!['raw','numeric'].includes(reason)) assert.deepEqual(calls,[],reason); panel.dispose();
  }
});

test('focused graph arrows adjust one field, clamp endpoints and leave other keys alone', async () => {
  const {root,calls,panel,frame} = fixture(), decay = envelopeHandle(root,'decay');
  let prevented = 0, stopped = 0; const event = key => ({key,preventDefault:()=>prevented++,stopPropagation:()=>stopped++});
  await decay.fire('keydown',event('ArrowUp')); await frame(); assert.deepEqual(calls.at(-1)[1][1],{sustainLevel:5});
  await decay.fire('keydown',event('ArrowRight')); await frame(); assert.deepEqual(calls.at(-1)[1][1],{decayRate:4});
  for (const extra of [{key:'q'},{key:'ArrowRight',ctrlKey:true},{key:'ArrowRight',metaKey:true},{key:'ArrowRight',altKey:true}]) await decay.fire('keydown',extra);
  await envelopeHandle(root,'attack').fire('keydown',{key:'ArrowUp'}); await frame(); assert.equal(calls.length,2); assert.equal(prevented,2); assert.equal(stopped,2);
  const next = state(); next.channels[0].adsr1 = 0x7f0f; panel.update(next);
  await envelopeHandle(root,'attack').fire('keydown',event('ArrowRight')); await decay.fire('keydown',event('ArrowUp')); await frame(); assert.equal(calls.length,2,'No request for an unchanged clamped value'); panel.dispose();
});

test('a failed graph write restores the applied envelope and leaves a newer queued value intact', async () => {
  const rejected = [], {root,panel,frame,errors} = fixture({invoke:() => new Promise((resolve,reject) => rejected.push(reject))});
  const handle = envelopeHandle(root,'attack'); await handle.fire('keydown',{key:'ArrowRight',stopPropagation(){}}); await frame();
  assert.equal(control(root,'attack-rate').value,'19'); rejected.shift()(new Error('Rejected edit')); await flush();
  assert.equal(control(root,'attack-rate').value,'18'); assert.equal(errors.length,1);
  await handle.fire('keydown',{key:'ArrowRight',stopPropagation(){}}); await frame(); await handle.fire('keydown',{key:'ArrowRight',stopPropagation(){}});
  rejected.shift()(new Error('First edit failed')); await flush(); assert.equal(control(root,'attack-rate').value,'20');
  await frame(); rejected.shift()(new Error('Second edit failed')); await flush(); assert.equal(control(root,'attack-rate').value,'18'); panel.dispose();
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

test('uploaded ADPCM has no invented PCM source and explicit shapes create only the selected voice cycle', async () => {
  const {root,calls,panel} = fixture(), canvas = control(root,'waveform');
  assert.equal(control(root,'wave-index').disabled,true); assert.equal(control(root,'wave-value').disabled,true);
  assert.match(output(root,'wave-info').textContent,/Original editable PCM is unavailable/);
  await canvas.fire('pointerdown',{pointerId:1,button:0,clientX:0,clientY:0}); await canvas.fire('pointerup',{pointerId:1});
  assert.deepEqual(calls,[]); await channel(root,23).fire('click');
  for (const shape of ['sine','triangle','saw','square']) await action(root,`wave-${shape}`).fire('click');
  assert.equal(calls.length,4);
  for (const [method,[ch,pcm,options]] of calls) {assert.equal(method,'setWaveform');assert.equal(ch,23);assert.equal(pcm.length,112);assert(pcm.every(value => Number.isFinite(value) && value >= -.65 && value <= .65));assert.deepEqual(options,{retrigger:true});}
  assert.equal(calls[0][1][1][0],0); assert.equal(calls[0][1][1][28],.65);
  assert.equal(calls[1][1][1][0],-.65); assert.equal(calls[1][1][1][56],.65);
  assert.equal(calls[2][1][1][0],-.65); assert(calls[2][1][1][111] > .63);
  assert.equal(calls[3][1][1][55],.65); assert.equal(calls[3][1][1][56],-.65);
  assert.equal(control(root,'wave-index').disabled,true,'only an applied snapshot enables original PCM edits');
  panel.update(waveformState(23)); assert.equal(control(root,'wave-index').disabled,false); panel.dispose();
});

test('a PCM stroke interpolates all 112 values and sends one update on release across unrelated snapshots', async () => {
  const {root,calls,panel} = fixture(); panel.update(waveformState()); const canvas = control(root,'waveform');
  await canvas.fire('pointerdown',{pointerId:1,button:0,clientX:0,clientY:180});
  await canvas.fire('pointermove',{pointerId:1,clientX:799,clientY:0}); assert.deepEqual(calls,[]);
  const next = waveformState(); next.channels[0].adsr1 = 0x7f0f; next.channels[23].pitch = 8000; panel.update(next);
  await canvas.fire('pointerup',{pointerId:1}); assert.equal(calls.length,1);
  const [method,[ch,pcm,options]] = calls[0]; assert.equal(method,'setWaveform'); assert.equal(ch,0); assert.deepEqual(options,{retrigger:true});
  assert.equal(pcm.length,112); assert.equal(pcm[0],-1); assert.equal(pcm[111],1); assert(Math.abs(pcm[55] - (-1 + 110 / 111)) < 1e-12);
  assert(pcm.every(value => Number.isFinite(value) && value >= -1 && value <= 1));
  assert.deepEqual(next.channels[0].waveform.pcm,waveformState().channels[0].waveform.pcm,'drawing never mutates applied state'); panel.dispose();
});

test('cancelled, hidden, old-channel and replaced-source PCM strokes never write', async () => {
  for (const reason of ['pointercancel','lostpointercapture','hide','channel','disconnect','blur','document','sample','waveform','dispose']) {
    const {root,calls,panel,win,doc} = fixture(); panel.update(waveformState()); const canvas = control(root,'waveform');
    await canvas.fire('pointerdown',{pointerId:1,button:0,clientX:20,clientY:20});
    if (reason === 'hide') panel.setVisible(false);
    else if (reason === 'channel') await channel(root,23).fire('click');
    else if (reason === 'disconnect') {panel.setConnected(false);panel.setConnected(true);}
    else if (reason === 'blur') await win.fire('blur');
    else if (reason === 'document') {doc.hidden=true;await doc.fire('visibilitychange');}
    else if (reason === 'sample') {const next=waveformState();next.channels[0].sample=0;panel.update(next);}
    else if (reason === 'waveform') {const next=waveformState();next.channels[0].waveform.pcm[0]=.75;panel.update(next);}
    else if (reason === 'dispose') panel.dispose();
    else await canvas.fire(reason,{pointerId:1});
    await canvas.fire('pointerup',{pointerId:1}); assert.deepEqual(calls,[],reason); panel.dispose();
  }
});

test('PCM drawing tracks the captured pointer and rejects alternate buttons or stale releases', async () => {
  const {root,calls,panel} = fixture(); panel.update(waveformState()); const canvas = control(root,'waveform');
  await canvas.fire('pointerdown',{pointerId:1,button:1,clientX:0,clientY:0}); await canvas.fire('pointerup',{pointerId:1}); assert.deepEqual(calls,[]);
  await canvas.fire('pointerdown',{pointerId:1,button:0,clientX:0,clientY:0});
  await canvas.fire('pointerdown',{pointerId:2,button:0,clientX:799,clientY:180});
  await canvas.fire('pointermove',{pointerId:2,clientX:799,clientY:180}); await canvas.fire('pointerup',{pointerId:2});
  await canvas.fire('lostpointercapture',{pointerId:2}); assert.deepEqual(calls,[]);
  await canvas.fire('pointerup',{pointerId:1}); assert.equal(calls.length,1); assert.equal(calls[0][1][1][0],1);
  assert.equal(calls[0][1][1][111],.5); panel.dispose();
});

test('numeric PCM edits validate index and signed values, preserve the other samples and use the retrigger choice', async () => {
  const {root,calls,panel} = fixture(); const original = waveformState(23); panel.update(original); await channel(root,23).fire('click');
  await change(root,'wave-index',111); assert.deepEqual(calls,[]); assert.equal(control(root,'wave-value').value,'0.5');
  for (const [name,value] of [['wave-index',112],['wave-index',.5],['wave-value',1.01],['wave-value',-1.01],['wave-value','NaN'],['wave-value','Infinity'],['wave-value','']]) await change(root,name,value);
  assert.deepEqual(calls,[]); await change(root,'wave-index',111); await change(root,'retrigger',false); await change(root,'wave-value',-.33);
  assert.deepEqual(calls, [['setWaveform',[23,[...original.channels[23].waveform.pcm.slice(0,111),-.33],{retrigger:false}]]]);
  assert.equal(original.channels[23].waveform.pcm[111],.5); panel.setVisible(false); await change(root,'wave-value',.75); assert.equal(calls.length,1); panel.dispose();
});

test('private PCM samples stay isolated in the sample picker and a source mismatch disables drawing', async () => {
  const {root,calls,panel} = fixture(), next = waveformState();
  next.samples.push({...next.samples[1],id:2,editorChannel:23}); panel.update(next);
  assert.deepEqual(control(root,'sample').children.map(node => node.value),['','0','1']);
  await change(root,'sample',2); assert.deepEqual(calls,[]);
  await channel(root,23).fire('click'); assert.deepEqual(control(root,'sample').children.map(node => node.value),['','0','2']);
  const mismatch = waveformState(23); mismatch.channels[23].waveform.sample = 0; panel.update(mismatch);
  assert.equal(control(root,'wave-value').disabled,true); assert.doesNotMatch(ps1VoiceCode(mismatch,23),/new Float32Array/); panel.dispose();
});

test('copied PCM voice code recreates its loop with the real encoder and retains voice/effect settings', async () => {
  const {encodePs1Adpcm} = await import('../../web/ps1_adpcm_encoder.js');
  const {preparePs1ADPCM} = await import('../../web/ps1synth.js');
  const {root,copied,panel} = fixture(), next = waveformState(23); next.channels[23].reverb = true; next.reverb.preset = 'hall'; panel.update(next); await channel(root,23).fire('click');
  await action(root,'copy').fire('click'); assert.equal(copied.length,1); assert.equal(copied[0],ps1VoiceCode(next,23));
  assert.doesNotMatch(copied[0], /\b(?:const|let|var)\s+(?:sample|pcm|encoded)\b/, 'generated declarations must not shadow Playground built-ins');
  for (const name of ['ps1WavePcm','ps1WaveEncoded','ps1WaveSample']) assert.match(copied[0],new RegExp(`const ${name} =`));
  const calls = [], loaded = {id:99};
  const spu = {async loadADPCM(adpcm,options) {const prepared = preparePs1ADPCM(adpcm,options);assert.equal(adpcm.length,64);assert.equal(prepared.loop,true);assert.equal(prepared.loopStartSamples,0);assert.equal(prepared.rootFrequencyHz,393.75);return loaded;},setPreset(...args) {calls.push(['setPreset',args]);},setReverb(...args) {calls.push(['setReverb',args]);}};
  await new (Object.getPrototypeOf(async function(){}).constructor)('spu','encodePs1Adpcm',copied[0])(spu,encodePs1Adpcm);
  assert.deepEqual(calls[0],['setPreset',[23,{sample:loaded,adsr1:next.channels[23].adsr1,adsr2:next.channels[23].adsr2,volumeLeft:.75,volumeRight:.5,pitch:4119,reverb:true}]]);
  assert.deepEqual(calls[1],['setReverb',[next.reverb]]); panel.dispose();
});

test('PCM source readback, visible redraw and timer advancement never start audio or poll', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']}); let preparations = 0;
  const {root,calls,panel} = fixture({ensureAudioReady:() => {preparations++;}}); panel.update(waveformState());
  panel.setVisible(false); panel.update(waveformState()); panel.setVisible(true); t.mock.timers.tick(60000); await flush();
  assert.equal(preparations,0); assert.deepEqual(calls,[]); assert.match(control(root,'waveform').getAttribute('aria-label'),/112 signed samples/); panel.dispose();
});

test('PCM edits keep Sustain and Keyboard identities and never create extra preview notes in the panel', async () => {
  const {root,calls,targets,panel} = fixture(); panel.update(waveformState());
  await action(root,'sustain').fire('click'); const sustainedId = calls.at(-1)[1][2];
  await action(root,'wave-square').fire('click'); assert.equal(action(root,'sustain').getAttribute('aria-pressed'),'true');
  assert.deepEqual(calls.map(value => value[0]),['auditionOn','setWaveform']);
  await action(root,'release').fire('click'); assert.deepEqual(calls.at(-1),['auditionOff',[0,sustainedId]]);
  await action(root,'keyboard').fire('click'); targets.at(-1).noteOn({id:'pcm-key',midi:69}); await flush();
  const keyboardId = calls.at(-1)[1][2]; await change(root,'wave-index',56); await change(root,'wave-value',.2);
  targets.at(-1).noteOff({id:'pcm-key'}); await flush();
  assert.deepEqual(calls.slice(-3).map(value => value[0]),['auditionOn','setWaveform','auditionOff']);
  assert.deepEqual(calls.at(-1),['auditionOff',[0,keyboardId]]); panel.dispose();
});
