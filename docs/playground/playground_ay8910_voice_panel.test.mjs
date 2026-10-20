import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundAy8910VoicePanel,ay8910VoiceCode} from './playground_ay8910_voice_panel.js';
import {AY8910Synth} from '../../web/ay8910synth.js';

class Events {
  constructor() {this.listeners = new Map();}
  addEventListener(type,handler) {if (!this.listeners.has(type)) this.listeners.set(type,new Set()); this.listeners.get(type).add(handler);}
  removeEventListener(type,handler) {this.listeners.get(type)?.delete(handler);}
  async fire(type,extra = {}) {await Promise.all([...this.listeners.get(type) ?? []].map(handler => handler({type,target:this,preventDefault() {},...extra}))); await flush();}
}
class Element extends Events {
  constructor(doc,tag) {super(); Object.assign(this,{ownerDocument:doc,tagName:tag,children:[],dataset:{},attributes:{},value:'',checked:false,textContent:'',hidden:false});}
  appendChild(node) {this.children.push(node); node.parentNode = this; return node;}
  setAttribute(name,value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name];}
  setCustomValidity(message) {this.validityMessage = message;}
  reportValidity() {}
  setPointerCapture() {}
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const walk = root => [root,...root.children.flatMap(walk)];
const control = (root,name) => walk(root).find(node => node.dataset.chipControl === `ay-${name}`);
const action = (root,name) => walk(root).find(node => node.dataset.chipAction === `ay-${name}`);
const channel = (root,index) => walk(root).find(node => node.dataset.chipChannel === String(index));
const snapshot = () => ({kind:'ay8910',clock:1789773,registers:Array(16).fill(0),
  channels:Array.from({length:3},(_,channel) => ({channel,active:channel !== 0,toneEnabled:channel !== 1,noiseEnabled:channel !== 0,volume:channel ? 7 : 0,configuredVolume:9,configuredEnvelope:channel === 2,envelope:channel === 2,period:254,frequency:440})),
  noise:{period:16,frequency:6991.3},envelope:{period:1500,shape:10,continue:true,attack:false,alternate:true,hold:false}});
function fixture(options = {}) {
  const win = new Events(); Object.assign(win,{setTimeout,clearTimeout}); const doc = new Events(); Object.assign(doc,{defaultView:win,activeElement:null,hidden:false,createElement:tag => new Element(doc,tag)});
  const root = new Element(doc,'div'), calls = [], targets = [], errors = [];
  const panel = createPlaygroundAy8910VoicePanel({root,invoke:async (...args) => {calls.push(args);},onKeyboardTargetChange:target => targets.push(target),onError:error => errors.push(error),...options});
  panel.setConnected(true); panel.update(snapshot()); return {root,doc,win,calls,targets,errors,panel};
}

test('AY readback never writes or retriggers the shared envelope, and keeps focused edits',() => {
  const {root,panel,calls,doc} = fixture(); assert.equal(control(root,'frequency').value,'440'); assert.equal(control(root,'volume').value,'9','configured level survives a quiet applied gate'); assert.equal(control(root,'envelope-shape').value,'10'); assert.equal(walk(root).filter(node => node.dataset.chipChannel !== undefined).length,3);
  const shape = control(root,'envelope-shape'); shape.value = '14'; doc.activeElement = shape;
  for (let i = 0; i < 4; i++) panel.update(snapshot()); assert.equal(shape.value,'14'); assert.deepEqual(calls,[]); panel.dispose();
});

test('tone/noise mix, fixed level and envelope selection are partial per-channel edits',async () => {
  const {root,panel,calls} = fixture(); await channel(root,2).fire('click');
  control(root,'tone').checked = false; await control(root,'tone').fire('change'); control(root,'noise').checked = true; await control(root,'noise').fire('change');
  control(root,'volume').value = '6'; await control(root,'volume').fire('change'); control(root,'envelope').checked = false; await control(root,'envelope').fire('change');
  control(root,'period').value = '2048'; await control(root,'period').fire('change'); control(root,'note').value = 'C4'; await control(root,'note').fire('change');
  assert.deepEqual(calls,[['setVoice',[2,{tone:false}]],['setVoice',[2,{noise:true}]],['setVoice',[2,{volume:6}]],['setVoice',[2,{envelope:false}]],['setTonePeriod',[2,2048]],['setNote',[2,'C4']]]);
  for (const [name,n] of [['volume','16'],['period','4096'],['noise-period','32'],['envelope-shape','16'],['envelope-period','65536']]) {control(root,name).value = n; await control(root,name).fire('change');} assert.equal(calls.length,6); panel.dispose();
});

test('noise and envelope edits stay global; period changes do not resend the shape',async () => {
  const {root,panel,calls} = fixture();
  control(root,'noise-period').value = '24'; await control(root,'noise-period').fire('change'); control(root,'envelope-period').value = '2200'; await control(root,'envelope-period').fire('change');
  control(root,'envelope-shape').value = '12'; await control(root,'envelope-shape').fire('change'); await action(root,'envelope-retrigger').fire('click');
  assert.deepEqual(calls,[['setNoisePeriod',[24]],['setEnvelope',[{period:2200}]],['setEnvelope',[{shape:12}]],['setEnvelope',[{shape:12}]]]); panel.update(snapshot()); assert.equal(calls.length,4); panel.dispose();
});

test('noise-only audition owns the selected physical channel without changing its shared generators',async () => {
  const {root,panel,calls} = fixture(); await channel(root,1).fire('click'); await action(root,'hold').fire('pointerdown',{button:0,pointerId:1}); await action(root,'hold').fire('pointerup',{pointerId:1});
  assert.deepEqual(calls[0][1].slice(0,2),[1,69]); assert.deepEqual(calls[1],['auditionOff',[1,calls[0][1][2]]]); assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff']); panel.dispose();
});

test('audition releases on blur, hiding, channel changes and disconnect',async () => {
  const {root,panel,calls,win} = fixture(), hold = action(root,'hold');
  await hold.fire('pointerdown',{button:0,pointerId:1}); await win.fire('blur'); assert.deepEqual(calls[1],['auditionOff',[0,calls[0][1][2]]]);
  await hold.fire('pointerdown',{button:0,pointerId:2}); await channel(root,2).fire('click'); assert.deepEqual(calls[3],['auditionOff',[0,calls[2][1][2]]]);
  await hold.fire('pointerdown',{button:0,pointerId:3}); panel.setVisible(false); assert.deepEqual(calls[5],['auditionOff',[2,calls[4][1][2]]]);
  panel.setVisible(true); await hold.fire('keydown',{key:' ',repeat:false}); panel.setConnected(false); assert.deepEqual(calls[7],['auditionOff',[2,calls[6][1][2]]]); panel.dispose();
});

test('Keyboard survives a hidden AY panel and stale targets cannot release a new voice',async () => {
  const {root,panel,calls,targets} = fixture(); await action(root,'keyboard').fire('click'); const first = targets.at(-1); panel.setVisible(false); first.noteOn({id:'same',midi:60});
  await channel(root,2).fire('click'); const second = targets.at(-1); second.noteOn({id:'same',midi:67}); first.noteOff({id:'same'}); first.allNotesOff(); first.noteOn({id:'late',midi:69}); await flush();
  assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff','auditionOn']); assert.equal(calls[2][1][0],2);
  second.noteOff({id:'same'}); await flush(); assert.deepEqual(calls[3],['auditionOff',[2,calls[2][1][2]]]); panel.setKeyboardActive(false); second.noteOn({id:'retired',midi:69}); assert.equal(calls.length,4); panel.dispose();
});

test('AY voice JavaScript keeps retained levels and explicitly marks shared generator edits',() => {
  const state = snapshot(), voice = state.channels[2]; voice.volume = 0; voice.envelope = false;
  const source = ay8910VoiceCode(state,2); assert.match(source,/"volume":9/); assert.match(source,/"envelope":true/); assert.match(source,/ay\.setNoisePeriod\(16\)/); assert.match(source,/ay\.setEnvelope\(/);
  const ay = new AY8910Synth({transport:{writeRegister() {},reset() {}}}); ay.initialize(); new Function('ay',source)(ay); const registers = ay.getRegisterSnapshot();
  assert.equal(registers[10] & 31,25); assert.equal(registers[6] & 31,16); assert.equal(registers[13] & 15,10); assert.equal(registers[7] & (4 | 32),0);
});

test('hiding cancels one-second preview and disposal removes all handlers',async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const {root,panel,calls,doc,win} = fixture(); await action(root,'play').fire('click'); panel.setVisible(false); t.mock.timers.tick(1000); await flush(); assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff']);
  panel.dispose(); panel.dispose(); for (const node of [...walk(root),doc,win]) assert.equal([...node.listeners.values()].reduce((total,set) => total + set.size,0),0);
});
