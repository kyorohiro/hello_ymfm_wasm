import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundOplVoicePanel,oplVoiceCode} from './playground_opl_voice_panel.js';

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
const control = (root,name) => walk(root).find(node => node.dataset.chipControl === `opl-${name}`);
const action = (root,name) => walk(root).find(node => node.dataset.chipAction === `opl-${name}`);
const channel = (root,index) => walk(root).find(node => node.dataset.chipChannel === String(index));
const snapshot = (kind = 'ym3812') => ({kind,clock:kind === 'ymf262' ? 14318180 : 3579545,registers:Array(kind === 'ymf262' ? 512 : 256).fill(0),
  channels:Array.from({length:kind === 'ymf262' ? 18 : 9},(_,channel) => ({channel,active:channel === 0,available:true,pairedWith:null,fourOp:false,frequency:440,algorithm:0,feedback:2,pan:{left:true,right:true},
    operators:Array.from({length:2},(_,operator) => ({multi:1,tl:operator ? 20 : 35,ksl:0,ar:15,dr:5,sl:4,rr:12,waveform:0,am:false,vibrato:false,egt:true,ksr:false}))})),lfo:{amDepth:false,pmDepth:true},rhythm:{enabled:false}});
function fixture(kind = 'ym3812',options = {}) {
  const win = new Events(); Object.assign(win,{setTimeout,clearTimeout}); const doc = new Events(); Object.assign(doc,{defaultView:win,activeElement:null,hidden:false,createElement:tag => new Element(doc,tag)});
  const root = new Element(doc,'div'), calls = [], targets = [], errors = [];
  const panel = createPlaygroundOplVoicePanel({root,kind,invoke:async (...args) => {calls.push(args);},onKeyboardTargetChange:target => targets.push(target),onError:error => errors.push(error),...options});
  panel.setConnected(true); panel.update(snapshot(kind)); return {root,doc,win,calls,targets,errors,panel};
}

for (const kind of ['ym3526','ym3812','y8950','ymf262']) test(`${kind} rendering is read-only and respects waveform/stereo limits`,() => {
  const {root,panel,calls,doc} = fixture(kind);
  assert.equal(control(root,'note').value,'A4'); assert.equal(control(root,'op-0-tl').value,'35'); assert.deepEqual(calls,[]);
  assert.equal(control(root,'op-0-waveform').max,kind === 'ymf262' ? '7' : kind === 'ym3812' ? '3' : '0');
  assert.equal(control(root,'pan-left').parentNode.hidden,kind !== 'ymf262');
  const input = control(root,'op-0-tl'); input.value = '41'; doc.activeElement = input;
  panel.update(snapshot(kind)); assert.equal(input.value,'41'); assert.deepEqual(calls,[]); panel.dispose();
});

test('operator, pitch and global edits send partial commands and validate bounds',async () => {
  const {root,panel,calls} = fixture();
  for (const [name,value] of [['op-0-tl','26'],['op-1-multi','2'],['algorithm','1'],['feedback','5'],['frequency','432.5']]) {control(root,name).value = value; await control(root,name).fire('change');}
  control(root,'op-1-egt').checked = false; await control(root,'op-1-egt').fire('change');
  control(root,'am-depth').checked = true; await control(root,'am-depth').fire('change');
  control(root,'note').value = 'C4'; await control(root,'note').fire('change');
  assert.deepEqual(calls,[['setOperator',[0,0,{tl:26}]],['setOperator',[0,1,{multi:2}]],['setAlgo',[0,1]],['setAlgo',[0,1,5]],['setFrequency',[0,432.5]],['setOperator',[0,1,{egt:false}]],['setLFO',[{amDepth:true}]],['setNote',[0,'C4']]]);
  for (const [name,value] of [['op-0-tl','64'],['op-1-multi','1.5'],['op-0-waveform','4']]) {control(root,name).value = value; await control(root,name).fire('change');}
  assert.equal(calls.length,8); panel.dispose();
});

test('four-op readback exposes logical OP3/4 and disables the borrowed channel',async () => {
  const {root,panel,calls} = fixture('ymf262'), state = snapshot('ymf262');
  state.channels[0].fourOp = true; state.channels[0].pairedWith = 3; state.channels[0].operators.push(...state.channels[3].operators); state.channels[3].pairedWith = 0; state.channels[3].available = false; state.channels[0].algorithm = 3;
  panel.update(state); assert.equal(channel(root,3).disabled,true); assert.equal(control(root,'op-3-tl').parentNode.parentNode.hidden,false);
  control(root,'op-3-tl').value = '30'; await control(root,'op-3-tl').fire('change');
  assert.deepEqual(calls,[['setOperator',[0,3,{tl:30}]]]);
  control(root,'four-op').checked = false; await control(root,'four-op').fire('change'); assert.deepEqual(calls.at(-1),['setFourOp',[0,false]]);
  assert.match(oplVoiceCode(state),/"fourOp": true/); assert.match(oplVoiceCode(state),/"algorithm": 3/); panel.dispose();
});

test('audition releases on blur, channel switch, hiding and disconnect, using owned note IDs',async () => {
  const {root,panel,win,calls} = fixture(), hold = action(root,'hold');
  await hold.fire('pointerdown',{button:0,pointerId:1}); await win.fire('blur');
  assert.deepEqual(calls[0].slice(0,1),['auditionOn']); assert.deepEqual(calls[1],['auditionOff',[0,calls[0][1][2]]]);
  await hold.fire('pointerdown',{button:0,pointerId:2}); await channel(root,1).fire('click'); assert.deepEqual(calls[3],['auditionOff',[0,calls[2][1][2]]]);
  await hold.fire('pointerdown',{button:0,pointerId:3}); panel.setVisible(false); assert.deepEqual(calls[5],['auditionOff',[1,calls[4][1][2]]]);
  panel.setVisible(true); await hold.fire('keydown',{key:' ',repeat:false}); panel.setConnected(false); assert.deepEqual(calls[7],['auditionOff',[1,calls[6][1][2]]]); panel.dispose();
});

test('Keyboard uses the selected chip voice while hidden and ignores stale releases',async () => {
  const {root,panel,calls,targets} = fixture('ymf262'); await action(root,'keyboard').fire('click');
  const first = targets.at(-1); panel.setVisible(false); first.noteOn({id:'same',midi:60});
  await channel(root,9).fire('click'); const second = targets.at(-1); second.noteOn({id:'same',midi:67}); first.noteOff({id:'same'}); first.allNotesOff(); first.noteOn({id:'late',midi:70}); await flush();
  assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff','auditionOn']); assert.equal(calls[2][1][0],9);
  second.noteOff({id:'same'}); await flush(); assert.deepEqual(calls[3],['auditionOff',[9,calls[2][1][2]]]);
  panel.setKeyboardActive(false); second.noteOn({id:'retired',midi:69}); assert.equal(calls.length,4); panel.dispose();
});

test('pairing a selected secondary releases its old note and selects the primary without writes',async () => {
  const {root,panel,calls} = fixture('ymf262'); await channel(root,3).fire('click'); await action(root,'hold').fire('pointerdown',{pointerId:1,button:0});
  const state = snapshot('ymf262'); state.channels[0].fourOp = true; state.channels[0].pairedWith = 3; state.channels[0].operators.push(...state.channels[3].operators); state.channels[3].pairedWith = 0; state.channels[3].available = false;
  panel.update(state); await flush(); assert.equal(panel.getSelectedChannel(),0); assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff']); panel.dispose();
});

test('one-second preview is cancelled by hiding and disposal removes all listeners',async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const {root,panel,calls,doc,win} = fixture(); await action(root,'play').fire('click');
  panel.setVisible(false); t.mock.timers.tick(1000); await flush(); assert.deepEqual(calls.map(([method]) => method),['auditionOn','auditionOff']); panel.dispose(); panel.dispose();
  for (const node of [...walk(root),doc,win]) assert.equal([...node.listeners.values()].reduce((total,set) => total + set.size,0),0);
});

test('Y8950 FM and ADPCM share one Keyboard selection and retire each other’s old targets',async()=>{
  const f=fixture('y8950'),state={...snapshot('y8950'),adpcm:{start:0,end:32,deltaN:12000,volume:180,repeat:false,memorySize:32,validRange:true}};
  f.panel.update(state);const adpcmAction=name=>walk(f.root).find(node=>node.dataset.chipAction===`y8950-adpcm-${name}`);
  await action(f.root,'keyboard').fire('click');const fm=f.targets.at(-1);fm.noteOn({id:'fm',midi:69});await flush();
  await adpcmAction('keyboard').fire('click');const pcm=f.targets.at(-1);assert.equal(f.panel.getSelectedChannel(),'adpcm');assert.equal(f.calls.at(-1)[0],'auditionOff');pcm.noteOn({id:'pcm',midi:45});await flush();assert.equal(f.calls.at(-1)[1][0],'adpcm');
  const before=f.calls.length;fm.noteOn({id:'stale',midi:72});fm.allNotesOff();assert.equal(f.calls.length,before);
  await action(f.root,'keyboard').fire('click');assert.equal(f.panel.getSelectedChannel(),0);assert.equal(f.calls.at(-1)[0],'auditionOff');const count=f.calls.length;pcm.noteOn({id:'old',midi:60});assert.equal(f.calls.length,count);
  await adpcmAction('keyboard').fire('click');await action(f.root,'hold').fire('pointerdown',{button:0,pointerId:10});assert.equal(f.panel.getSelectedChannel(),0);assert.equal(f.calls.at(-1)[1][0],0);f.panel.dispose();
});

test('Y8950 ADPCM is absent from the other three OPL panels',()=>{
  for(const kind of ['ym3526','ym3812','ymf262']){const f=fixture(kind);assert(!walk(f.root).some(node=>Object.hasOwn(node.dataset,'y8950Adpcm')));f.panel.dispose();}
});

test('Y8950 FM rhythm reservation changes do not release the independent ADPCM lease',async()=>{
  const f=fixture('y8950'),data={...snapshot('y8950'),adpcm:{start:0,end:32,deltaN:12000,volume:180,memorySize:32,validRange:true}};f.panel.update(data);
  await channel(f.root,6).fire('click');const pcm=walk(f.root).find(node=>node.dataset.chipAction==='y8950-adpcm-hold');await pcm.fire('pointerdown',{button:0,pointerId:7});assert.equal(f.calls.at(-1)[1][0],'adpcm');const before=f.calls.length;
  const reserved=structuredClone(data);reserved.channels[6].available=false;f.panel.update(reserved);assert.equal(f.calls.length,before,'readback of FM reservation must not alter ADPCM');
  control(f.root,'rhythm').checked=true;await control(f.root,'rhythm').fire('change');assert.equal(f.calls.at(-1)[0],'setRhythm');assert(!f.calls.slice(before).some(([method])=>method==='auditionOff'));
  f.panel.dispose();assert.equal(f.calls.at(-1)[0],'auditionOff');
});
