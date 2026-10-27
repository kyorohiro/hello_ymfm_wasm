import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundPokeyVoicePanel,pokeyVoiceCode} from './playground_pokey_voice_panel.js';
import {PokeySynth} from '../../web/pokeysynth.js';

class Events{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  async fire(type,extra={}){await Promise.all([...this.listeners.get(type)??[]].map(fn=>fn({type,target:this,preventDefault(){},...extra})));await flush();}
}
class Element extends Events{
  constructor(doc,tag){super();Object.assign(this,{ownerDocument:doc,tagName:tag,children:[],dataset:{},attributes:{},value:'',checked:false,textContent:'',hidden:false,disabled:false});}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key];}
  setCustomValidity(message){this.validityMessage=message;}
  reportValidity(){}
  setPointerCapture(){}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const walk=root=>[root,...root.children.flatMap(walk)];
const control=(root,name)=>walk(root).find(node=>node.dataset.chipControl===`pokey-${name}`);
const action=(root,name)=>walk(root).find(node=>node.dataset.chipAction===`pokey-${name}`);
const output=(root,name)=>walk(root).find(node=>node.dataset.chipOutput===`pokey-${name}`);
const channel=(root,index)=>walk(root).find(node=>node.dataset.chipChannel===String(index));
const snapshot=()=>({kind:'pokey',clock:1789790,sampleRate:48000,audctl:128,skctl:3,running:true,baseClock:'64khz',poly9:true,registers:Array.from({length:16},(_,index)=>index===8?128:index===15?3:0),channels:Array.from({length:4},(_,index)=>({channel:index,active:index===1,volume:index===1?7:0,configuredVolume:index===0?0:9,period:72,frequency:1789790/(56*73),distortion:5,volumeOnly:false,joined:false,helper:false,highClock:false,type:'Tone',reason:'Pure tone'}))});
function fixture(options={}){
  let timerId=0;const timers=new Map(),win=new Events();Object.assign(win,{setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},navigator:{clipboard:{async writeText(){}}}});
  const doc=new Events();Object.assign(doc,{defaultView:win,activeElement:null,hidden:false,createElement:tag=>new Element(doc,tag)});
  const root=new Element(doc,'div'),calls=[],targets=[],errors=[];
  const panel=createPlaygroundPokeyVoicePanel({root,invoke:async(...args)=>{calls.push(args);return options.invoke?.(...args);},onKeyboardTargetChange:target=>targets.push(target),onError:error=>errors.push(error),...Object.fromEntries(Object.entries(options).filter(([key])=>key!=='invoke'))});
  panel.setConnected(true);panel.update(snapshot());return{panel,root,doc,win,calls,targets,errors,timers,tick(){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();}};
}
const change=async(root,name,value)=>{const node=control(root,name);if(node.type==='checkbox')node.checked=value;else node.value=String(value);await node.fire('change');};

test('POKEY applied snapshots show four physical channels and retained zero without writes',()=>{
  const f=fixture();assert.equal(walk(f.root).filter(node=>node.dataset.chipChannel!==undefined).length,4);
  assert.equal(control(f.root,'volume').value,'0');assert.equal(control(f.root,'period').value,'72');assert.equal(control(f.root,'period').readOnly,true);
  assert.match(output(f.root,'gate').textContent,/applied volume 0 · configured volume 0/);assert.match(output(f.root,'mode').textContent,/Distortion 5/);assert.match(output(f.root,'shared-info').textContent,/AUDCTL 0x80 · SKCTL 0x03 · running/);
  const input=control(f.root,'frequency');f.doc.activeElement=input;input.value='523.25';for(let index=0;index<4;index++)f.panel.update(snapshot());assert.equal(input.value,'523.25');assert.deepEqual(f.calls,[]);f.panel.dispose();
});

test('editor audition availability excludes helper/busy/disposed states while allowing audio preparation',()=>{
  const f=fixture();assert.equal(f.panel.getAuditionAvailability(),true);f.panel.setConnected(false);assert.equal(f.panel.getAuditionAvailability(),true,'an otherwise playable voice can prepare audio on its first key');
  const helper=snapshot();helper.channels[0].helper=true;f.panel.update(helper);assert.equal(f.panel.getAuditionAvailability(),false);f.panel.update({...snapshot(),timeline:{preparing:true}});assert.equal(f.panel.getAuditionAvailability(),false);f.panel.update({...snapshot(),pendingTimelines:1});assert.equal(f.panel.getAuditionAvailability(),false);
  f.panel.update(snapshot());assert.equal(f.panel.getAuditionAvailability(),true);f.panel.dispose();assert.equal(f.panel.getAuditionAvailability(),false);assert.deepEqual(f.calls,[]);
});

test('selected edits invoke existing POKEY methods and reject invalid numeric input',async()=>{
  const f=fixture();await channel(f.root,3).fire('click');
  for(const[name,value]of [['volume',0],['distortion',7],['volume-only',true],['frequency',440],['note','C4']])await change(f.root,name,value);
  assert.deepEqual(f.calls,[['setVolume',[3,0]],['setDistortion',[3,7]],['setVolumeOnly',[3,true]],['setFrequency',[3,440]],['setNote',[3,'C4']]]);
  for(const[name,value]of [['volume',16],['volume',-1],['distortion',8],['distortion',1.5],['frequency',0],['frequency','NaN'],['volume','']])await change(f.root,name,value);
  assert.equal(f.calls.length,5);assert.match(control(f.root,'volume').validityMessage,/range/);f.panel.dispose();
});

test('shared clock/poly/join edits release owned auditions and address physical pair controls',async()=>{
  const f=fixture();await action(f.root,'hold').fire('pointerdown',{button:0,pointerId:1});
  await change(f.root,'base-clock','15khz');await change(f.root,'poly9',false);await change(f.root,'joined-0',true);await change(f.root,'joined-1',true);await change(f.root,'high-clock-0',true);await change(f.root,'high-clock-2',true);
  assert.deepEqual(f.calls.slice(1),[['auditionOff',[0,f.calls[0][1][2]]],['setBaseClock',['15khz']],['setPoly9',[false]],['setJoined',[0,true]],['setJoined',[1,true]],['setHighClock',[0,true]],['setHighClock',[2,true]]]);
  const state=snapshot();state.audctl=state.registers[8]=255;state.baseClock='15khz';f.panel.update(state);assert.equal(control(f.root,'base-clock').value,'15khz');for(const name of ['poly9','joined-0','joined-1','high-clock-0','high-clock-2'])assert.equal(control(f.root,name).checked,true);f.panel.dispose();
});

test('joined lower helper cannot be tuned or auditioned; upper owns the joined tone',async()=>{
  const f=fixture(),state=snapshot();state.audctl=state.registers[8]=80;Object.assign(state.channels[0],{joined:true,helper:true,period:10});Object.assign(state.channels[1],{joined:true,highClock:true,period:1800});f.panel.update(state);
  for(const name of ['frequency','note','audition-midi'])assert.equal(control(f.root,name).disabled,true);for(const name of ['hold','play','keyboard'])assert.equal(action(f.root,name).disabled,true);
  await action(f.root,'hold').fire('pointerdown',{button:0,pointerId:1});await action(f.root,'play').fire('click');await action(f.root,'keyboard').fire('click');await change(f.root,'frequency',440);await change(f.root,'note','C4');assert.deepEqual(f.calls,[]);assert.equal(f.targets.length,0);assert.match(output(f.root,'gate').textContent,/CH2 owns/);
  await channel(f.root,1).fire('click');assert.equal(action(f.root,'hold').disabled,false);await action(f.root,'hold').fire('pointerdown',{button:0,pointerId:2});await action(f.root,'hold').fire('pointerup',{pointerId:2});assert.equal(f.calls[0][1][0],1);assert.deepEqual(f.calls[1],['auditionOff',[1,f.calls[0][1][2]]]);f.panel.dispose();
});

test('external joined-helper transition retires the keyboard lease without releasing a newer channel',async()=>{
  const f=fixture();await action(f.root,'keyboard').fire('click');const first=f.targets.at(-1);first.noteOn({id:'same',midi:69});await flush();
  const state=snapshot();state.channels[0].helper=state.channels[0].joined=true;f.panel.update(state);assert.equal(f.targets.at(-1),null);assert.deepEqual(f.calls[1],['auditionOff',[0,f.calls[0][1][2]]]);
  await channel(f.root,1).fire('click');await action(f.root,'keyboard').fire('click');const next=f.targets.at(-1);next.noteOn({id:'same',midi:60});first.noteOff({id:'same'});first.allNotesOff();first.noteOn({id:'late',midi:65});await flush();assert.equal(f.calls.length,3);next.noteOff({id:'same'});assert.deepEqual(f.calls[3],['auditionOff',[1,f.calls[2][1][2]]]);f.panel.dispose();
});

test('hold identity ignores mismatched pointers/keys and releases on blur, hide and visibility loss',async()=>{
  const f=fixture(),hold=action(f.root,'hold');await hold.fire('pointerdown',{button:1,pointerId:1});assert.equal(f.calls.length,0);
  await hold.fire('pointerdown',{button:0,pointerId:2});await hold.fire('pointerup',{pointerId:3});assert.equal(f.calls.length,1);await hold.fire('lostpointercapture',{pointerId:2});assert.equal(f.calls.length,2);
  await hold.fire('keydown',{key:' ',repeat:true});await hold.fire('keydown',{key:'Escape'});assert.equal(f.calls.length,2);
  await hold.fire('keydown',{key:'Enter',repeat:false});await hold.fire('keyup',{key:' '});assert.equal(f.calls.length,3);await hold.fire('keyup',{key:'Enter'});assert.equal(f.calls.length,4);
  await hold.fire('pointerdown',{button:0,pointerId:4});await f.win.fire('blur');await hold.fire('pointerdown',{button:0,pointerId:5});f.panel.setVisible(false);assert.equal(f.calls.length,8);
  f.panel.setVisible(true);await hold.fire('pointerdown',{button:0,pointerId:6});f.doc.hidden=true;await f.doc.fire('visibilitychange');assert.equal(f.calls.length,10);assert.equal(hold.getAttribute('aria-pressed'),'false');f.panel.dispose();
});

test('blank, fractional and out-of-range audition notes cannot allocate a press or preview timer',async()=>{
  const f=fixture();for(const input of ['',-1,128,60.5,'NaN']){control(f.root,'audition-midi').value=String(input);await action(f.root,'hold').fire('pointerdown',{button:0,pointerId:1});await action(f.root,'play').fire('click');}assert.deepEqual(f.calls,[]);assert.equal(f.timers.size,0);f.panel.dispose();
});

test('preview releases only its identity and hidden-panel Keyboard remains active until unbound',async()=>{
  const f=fixture();await action(f.root,'play').fire('click');const preview=f.calls[0][1][2];await action(f.root,'hold').fire('pointerdown',{button:0,pointerId:1});const hold=f.calls[1][1][2];f.tick();await flush();assert.deepEqual(f.calls[2],['auditionOff',[0,preview]]);assert.notEqual(preview,hold);
  await action(f.root,'keyboard').fire('click');const target=f.targets.at(-1);f.panel.setVisible(false);assert.deepEqual(f.calls[3],['auditionOff',[0,hold]]);target.noteOn({id:'key',midi:67});await flush();assert.equal(f.calls[4][0],'auditionOn');
  f.panel.setKeyboardActive(false);assert.deepEqual(f.calls[5],['auditionOff',[0,f.calls[4][1][2]]]);target.noteOn({id:'late',midi:65});assert.equal(f.calls.length,6);f.panel.dispose();
});

test('disconnect invalidates stale keyboard releases and stale command ACK/error status',async()=>{
  const pending=[];const f=fixture({invoke:(method)=>method==='setVolume'?new Promise((resolve,reject)=>pending.push({resolve,reject})):undefined});
  await action(f.root,'keyboard').fire('click');const old=f.targets.at(-1);old.noteOn({id:'same',midi:69});await flush();
  await change(f.root,'volume',5);f.panel.setConnected(false);f.panel.setConnected(true);await action(f.root,'keyboard').fire('click');const next=f.targets.at(-1);next.noteOn({id:'same',midi:60});await flush();
  const before=f.calls.length;old.noteOff({id:'same'});old.allNotesOff();old.noteOn({id:'late',midi:62});assert.equal(f.calls.length,before);pending[0].reject(new Error('old connection failure'));await flush();assert.equal(f.errors.length,0);assert.doesNotMatch(walk(f.root).find(node=>node.className==='chip-editor-status').textContent,/failure/);
  next.noteOff({id:'same'});assert.deepEqual(f.calls.at(-1),['auditionOff',[0,f.calls.at(-2)[1][2]]]);f.panel.dispose();
});

test('only the latest command ACK/error updates the current panel status',async()=>{
  const pending=[],f=fixture({invoke:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});await change(f.root,'volume',5);await change(f.root,'distortion',3);pending[1].reject(new Error('new error'));await flush();pending[0].resolve();await flush();assert.equal(f.errors.length,1);assert.equal(walk(f.root).find(node=>node.className==='chip-editor-status').textContent,'new error');f.panel.dispose();
});

for(const timeline of [{playing:true},{preparing:true},{pendingTimelines:1}])test(`timeline ${Object.keys(timeline)[0]} is read-only, releases owned notes and keeps code usable`,async()=>{
  const f=fixture();await action(f.root,'keyboard').fire('click');const target=f.targets.at(-1);target.noteOn({id:'held',midi:69});await flush();f.panel.update({...snapshot(),timeline});
  const body=walk(f.root).find(node=>node.className==='chip-editor-body');assert.equal(body.disabled,true);assert.match(output(f.root,'timeline').textContent,/read-only/);assert.equal(f.targets.at(-1),null);assert.equal(f.calls.at(-1)[0],'auditionOff');
  const before=f.calls.length;await change(f.root,'volume',4);await action(f.root,'play').fire('click');await action(f.root,'keyboard').fire('click');target.noteOn({id:'late',midi:60});assert.equal(f.calls.length,before);assert.notEqual(action(f.root,'copy').parentNode.parentNode,body);
  f.panel.update({...snapshot(),timeline:{loaded:true}});assert.equal(body.disabled,false);assert.match(output(f.root,'timeline').textContent,/ready/);f.panel.dispose();
});

test('voice code targets the real primary or a caller-bound custom instance, retains zero and exact shared registers',()=>{
  const state=snapshot();state.apiName='pokey2';state.audctl=state.registers[8]=214;state.skctl=state.registers[15]=11;Object.assign(state.channels[0],{helper:true,joined:true});Object.assign(state.channels[1],{frequency:1789790/(2*(1800+7)),period:1800,configuredVolume:0,distortion:7,volumeOnly:true,joined:true,highClock:true});
  const source=pokeyVoiceCode(state,0),writes=[];assert.match(source,/CH2 owns/);assert.match(source,/pokey2\.setVolume\(1, 0\)/);assert.match(source,/writeRegister\(8, 214\)/);assert.match(source,/writeRegister\(15, 11\)/);assert.doesNotMatch(source,/\.reset\(|\.initialize\(|\.keyOn\(/);
  const synth=new PokeySynth({clock:1789790,transport:{writeRegister:(...args)=>writes.push(args),reset(){}}});synth.initialize();writes.length=0;new Function('pokey2',source)(synth);const registers=synth.getRegisterSnapshot();assert.equal(registers[8],214);assert.equal(registers[15],11);assert.equal(registers[0]|registers[2]<<8,1800,'frequency occupies lower/upper physical timer bytes');assert.equal(registers[3]&31,16);assert.equal(registers[3]>>5,7);assert.equal(synth._getState().levels[1],0);assert.equal(writes.some(([register])=>register===9),false);
  const custom=pokeyVoiceCode({...state,apiName:null,instanceId:'custom\nchip.reset();\u2028unexpected();'},0);assert.match(custom,/Bind chip to.*custom\\nchip\.reset/);assert.match(custom,/\\u2028unexpected/);assert.match(custom,/chip\.setVolume\(1, 0\)/);assert.doesNotMatch(custom,/useSoundChip|createSoundChip|pokey2\./);
});

test('apiName option and snapshot override label dual instances without changing held-note identity',async()=>{
  const f=fixture({apiName:'pokey2',instanceId:'pokey:2'});assert.match(control(f.root,'code').value,/pokey2\.setVolume/);await action(f.root,'keyboard').fire('click');const target=f.targets.at(-1);assert.equal(target.name,'POKEY2 · CH1');target.noteOn({id:'held',midi:69});f.panel.update({...snapshot(),apiName:'pokey'});assert.equal(f.panel.getNoteTarget(),target);assert.equal(target.name,'POKEY · CH1');target.noteOff({id:'held'});assert.equal(f.calls[0][1][2],f.calls[1][1][1]);f.panel.dispose();
});

test('hiding clears preview and disposing disconnects every handler without polling',async()=>{
  const f=fixture();await action(f.root,'play').fire('click');assert.equal(f.timers.size,1);f.panel.setVisible(false);assert.equal(f.timers.size,0);f.tick();assert.deepEqual(f.calls.map(([method])=>method),['auditionOn','auditionOff']);f.panel.dispose();f.panel.dispose();for(const node of [...walk(f.root),f.doc,f.win])assert.equal([...node.listeners.values()].reduce((total,set)=>total+set.size,0),0);
});
