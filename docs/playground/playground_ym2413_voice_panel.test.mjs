import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundYm2413VoicePanel,ym2413VoiceCode} from './playground_ym2413_voice_panel.js';
import {YM2413Synth} from '../../web/ym2413synth.js';

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
const control = (root,name) => walk(root).find(node => node.dataset.chipControl === `opll-${name}`);
const action = (root,name) => walk(root).find(node => node.dataset.chipAction === `opll-${name}`);
const output = (root,name) => walk(root).find(node => node.dataset.chipOutput === `opll-${name}`);
const channel = (root,index) => walk(root).find(node => node.dataset.chipChannel === String(index));
const drum = (root,index) => walk(root).find(node => node.dataset.chipRhythm === String(index));
const snapshot = () => ({kind:'ym2413',clock:3579545,registers:Array(64).fill(0),
  channels:Array.from({length:9},(_,channel) => ({channel,available:true,active:channel === 0,instrument:channel < 2 ? 0 : 3,attenuation:5,sustain:false,frequency:440})),
  userPatch:{feedback:2,operators:Array.from({length:2},(_,operator) => ({multi:1,ksl:0,...(operator ? {} : {tl:30}),ar:15,dr:5,sl:4,rr:12,waveform:0,am:false,vibrato:false,egt:true,ksr:false}))},
  rhythm:{enabled:false,levels:{bassDrum:5,snare:6,tom:7,cymbal:8,hiHat:9}}});
function fixture(options = {}) {
  const win = new Events(); Object.assign(win,{setTimeout,clearTimeout}); const doc = new Events(); Object.assign(doc,{defaultView:win,activeElement:null,hidden:false,createElement:tag => new Element(doc,tag)});
  const root = new Element(doc,'div'), calls = [], targets = [], errors = [];
  const panel = createPlaygroundYm2413VoicePanel({root,invoke:async (...args) => {calls.push(args);},onKeyboardTargetChange:target => targets.push(target),onError:error => errors.push(error),...options});
  panel.setConnected(true); panel.update(snapshot()); return {root,doc,win,calls,targets,errors,panel};
}

test('readback is read-only, keeps focused edits and describes the one shared User patch',() => {
  const {root,panel,calls,doc} = fixture();
  assert.equal(control(root,'instrument').children.length,16); assert.equal(control(root,'note').value,'A4'); assert.equal(control(root,'user-op-0-tl').value,'30'); assert.equal(control(root,'user-op-1-tl'),undefined,'carrier TL is not a shared patch field');
  assert.match(output(root,'user-users').textContent,/CH1, CH2/); assert.deepEqual(calls,[]);
  const input = control(root,'user-op-0-tl'); doc.activeElement = input; input.value = '41'; panel.update(snapshot()); assert.equal(input.value,'41'); assert.deepEqual(calls,[]); panel.dispose();
});

test('built-in voices show ROM ownership while User edits remain global, never per channel',async () => {
  const {root,panel,calls} = fixture(); await channel(root,2).fire('click');
  assert.match(output(root,'instrument-info').textContent,/Piano.*read-only/); assert.match(output(root,'user-users').textContent,/Selected CH3.*unaffected/);
  control(root,'user-op-0-tl').value = '24'; await control(root,'user-op-0-tl').fire('change');
  control(root,'user-feedback').value = '5'; await control(root,'user-feedback').fire('change');
  control(root,'user-op-1-waveform').value = '1'; await control(root,'user-op-1-waveform').fire('change');
  await action(root,'use-user').fire('click');
  assert.deepEqual(calls,[['setUserOperator',[0,{tl:24}]],['setUserPatch',[{feedback:5}]],['setUserOperator',[1,{waveform:1}]],['setVoice',[2,{instrument:0}]]]); panel.dispose();
});

test('channel voice changes are partial and sustain/attenuation stay per channel',async () => {
  const {root,panel,calls} = fixture(); await channel(root,4).fire('click');
  control(root,'instrument').value = '8'; await control(root,'instrument').fire('change');
  control(root,'attenuation').value = '7'; await control(root,'attenuation').fire('change');
  control(root,'sustain').checked = true; await control(root,'sustain').fire('change');
  control(root,'note').value = 'C4'; await control(root,'note').fire('change');
  assert.deepEqual(calls,[['setVoice',[4,{instrument:8}]],['setVoice',[4,{attenuation:7}]],['setVoice',[4,{sustain:true}]],['setNote',[4,'C4']]]);
  control(root,'attenuation').value = '16'; await control(root,'attenuation').fire('change'); control(root,'user-op-0-tl').value = '64'; await control(root,'user-op-0-tl').fire('change'); assert.equal(calls.length,4); panel.dispose();
});

test('rhythm uses five named voices, shared register levels and configured physical tuning',async () => {
  const {root,panel,calls} = fixture(); assert.equal(control(root,'rhythm-snare-attenuation').disabled,true); assert.equal(drum(root,1).hidden,true);
  const state = snapshot(); state.rhythm.enabled = true; for (const voice of state.channels.slice(6)) voice.available = false; panel.update(state);
  assert.equal(channel(root,6).disabled,true); assert.equal(drum(root,1).hidden,false);
  control(root,'rhythm-snare-attenuation').value = '4'; await control(root,'rhythm-snare-attenuation').fire('change');
  control(root,'rhythm-pitch-7').value = '392'; await control(root,'rhythm-pitch-7').fire('change'); await drum(root,1).fire('click');
  assert.equal(control(root,'instrument').disabled,true); assert.equal(action(root,'use-user').disabled,true);
  await action(root,'hold').fire('pointerdown',{button:0,pointerId:1}); await action(root,'hold').fire('pointerup',{pointerId:1});
  assert.deepEqual(calls.slice(0,2),[['setRhythmLevel',['snare',4]],['setFrequency',[7,392]]]); assert.deepEqual(calls[2][1].slice(0,2),['rhythm:1',69]); assert.deepEqual(calls[3],['auditionOff',['rhythm:1',calls[2][1][2]]]); panel.dispose();
});

test('rhythm mode changes retire a selected drum, release its lease and select a melodic channel',async () => {
  const {root,panel,calls} = fixture(); const state = snapshot(); state.rhythm.enabled = true; for (const voice of state.channels.slice(6)) voice.available = false; panel.update(state);
  await drum(root,0).fire('click'); await action(root,'hold').fire('pointerdown',{button:0,pointerId:1}); panel.update(snapshot()); await flush();
  assert.equal(panel.getSelectedChannel(),0); assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff']); assert.equal(calls[1][1][0],'rhythm:0'); panel.dispose();
});

test('audition ownership releases on blur, hiding, channel switch and disconnect',async () => {
  const {root,panel,calls,win} = fixture(), hold = action(root,'hold');
  await hold.fire('pointerdown',{button:0,pointerId:1}); await win.fire('blur'); assert.deepEqual(calls[1],['auditionOff',[0,calls[0][1][2]]]);
  await hold.fire('pointerdown',{button:0,pointerId:2}); await channel(root,1).fire('click'); assert.deepEqual(calls[3],['auditionOff',[0,calls[2][1][2]]]);
  await hold.fire('pointerdown',{button:0,pointerId:3}); panel.setVisible(false); assert.deepEqual(calls[5],['auditionOff',[1,calls[4][1][2]]]);
  panel.setVisible(true); await hold.fire('keydown',{key:' ',repeat:false}); panel.setConnected(false); assert.deepEqual(calls[7],['auditionOff',[1,calls[6][1][2]]]); panel.dispose();
});

test('Keyboard targets survive hiding and stale releases cannot mute the new target',async () => {
  const {root,panel,calls,targets} = fixture(); await action(root,'keyboard').fire('click'); const first = targets.at(-1); panel.setVisible(false); first.noteOn({id:'same',midi:60});
  await channel(root,2).fire('click'); const second = targets.at(-1); second.noteOn({id:'same',midi:67}); first.noteOff({id:'same'}); first.allNotesOff(); first.noteOn({id:'late',midi:70}); await flush();
  assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff','auditionOn']); assert.equal(calls[2][1][0],2);
  second.noteOff({id:'same'}); await flush(); assert.deepEqual(calls[3],['auditionOff',[2,calls[2][1][2]]]); panel.setKeyboardActive(false); second.noteOn({id:'retired',midi:69}); assert.equal(calls.length,4); panel.dispose();
});

test('voice JavaScript exports a shared patch only for instrument 0 and is accepted by the actual Synth',() => {
  const state = snapshot(), custom = ym2413VoiceCode(state,0), builtin = ym2413VoiceCode(state,2);
  assert.match(custom,/Shared by every channel/); assert.match(custom,/opll\.setUserPatch\(/); assert.doesNotMatch(builtin,/opll\.setUserPatch/); assert.match(builtin,/Built-in Piano/);
  const opll = new YM2413Synth({transport:{writeRegister() {},reset() {}}}); opll.initialize(); new Function('opll',custom)(opll);
  assert.equal(opll.getRegisterSnapshot()[0x30] >> 4,0); new Function('opll',builtin)(opll); assert.equal(opll.getRegisterSnapshot()[0x32] >> 4,3);
});

test('preview hides safely and disposal removes every handler',async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const {root,panel,calls,doc,win} = fixture(); await action(root,'play').fire('click'); panel.setVisible(false); t.mock.timers.tick(1000); await flush();
  assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff']); panel.dispose(); panel.dispose(); for (const node of [...walk(root),doc,win]) assert.equal([...node.listeners.values()].reduce((total,entries) => total + entries.size,0),0);
});
