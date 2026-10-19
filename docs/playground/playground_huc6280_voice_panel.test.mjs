import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundHuc6280VoicePanel,huc6280NoteMidi,huc6280VoiceCode} from './playground_huc6280_voice_panel.js';

class Events {
  constructor(){this.listeners=new Map();}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
  removeEventListener(name,callback){this.listeners.get(name)?.delete(callback);}
  async fire(type,extra={}){await Promise.all([...this.listeners.get(type)??[]].map(callback=>callback({type,target:this,preventDefault(){},...extra})));await flush();}
}
class Element extends Events {
  constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.value='';this.textContent='';this.hidden=false;this.checked=false;}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name];}
  setCustomValidity(value){this.validityMessage=value;}
  reportValidity(){}
  getContext(){return null;}
  getBoundingClientRect(){return{left:0,top:0,width:800,height:160};}
  setPointerCapture(){}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const walk=root=>[root,...root.children.flatMap(walk)];
const control=(root,name)=>walk(root).find(node=>node.dataset.chipControl===`pce-${name}`);
const action=(root,name)=>walk(root).find(node=>node.dataset.chipAction===`pce-${name}`);
const channel=(root,index)=>walk(root).find(node=>node.dataset.chipChannel===String(index));
const output=(root,name)=>walk(root).find(node=>node.dataset.chipOutput===`pce-${name}`);
const state=()=>({
  kind:'huc6280',clock:3579545,sampleRate:48000,selectedChannel:0,masterVolume:{left:15,right:14},lfo:{frequency:100,depth:2,reset:false},globals:[0,254,0,0,0,0,0,0,100,2],
  channels:Array.from({length:6},(_,channel)=>({channel,active:channel===0,enabled:channel===0,dda:false,ddaValue:16,volume:24-channel,pan:{left:15-channel,right:10+channel},period:channel===0?254:512,frequency:channel===0?440.39677657480314:218.47808837890625,waveform:Array.from({length:32},(_,i)=>i),waveformKnown:true,noise:channel>=4?{enabled:false,frequency:16}:null,registers:[0,0,254,0xa0,24,255,16,16]})),
});
function fixture(options={}){
  const win=new Events();win.setTimeout=setTimeout;win.clearTimeout=clearTimeout;
  const doc=new Events();doc.defaultView=win;doc.activeElement=null;doc.hidden=false;doc.createElement=tag=>new Element(doc,tag);
  const root=new Element(doc,'div'),calls=[],targets=[],errors=[];
  const panel=createPlaygroundHuc6280VoicePanel({root,invoke:async(...args)=>{calls.push(args);},onKeyboardTargetChange:target=>targets.push(target),onError:error=>errors.push(error),...options});
  panel.setConnected(true);panel.update(state());return{root,doc,win,calls,targets,errors,panel};
}

test('HuC note entry uses standard MIDI names and rejects malformed notes',()=>{
  assert.equal(huc6280NoteMidi('A4'),69);assert.equal(huc6280NoteMidi('C4'),60);assert.equal(huc6280NoteMidi('Bb3'),58);assert.equal(huc6280NoteMidi('c#-1'),1);
  assert.throws(()=>huc6280NoteMidi('oops'),/note name/);assert.throws(()=>huc6280NoteMidi('C20'),/MIDI/);
});

test('HuC readback renders six channels and applied five-bit settings without writes or audio initialization',()=>{
  const{root,panel,calls}=fixture();assert.equal(control(root,'note').value,'A4');assert.equal(control(root,'period').value,'254');assert.equal(control(root,'volume').value,'24');assert.equal(control(root,'pan-left').value,'15');assert.equal(control(root,'master-right').value,'14');assert.equal(control(root,'wave-value').value,'0');
  assert.equal(walk(root).filter(node=>node.dataset.chipChannel!==undefined).length,6);assert.match(output(root,'clock').textContent,/3,579,545/);assert.match(output(root,'gate').textContent,/Enabled.*Wave/);assert.deepEqual(calls,[]);panel.dispose();
});

test('period zero displays the longest hardware period and polling keeps focused edits',()=>{
  const{root,panel,doc,calls}=fixture();const period=control(root,'period');doc.activeElement=period;period.value='123';const next=state();next.channels[0].period=0;next.channels[0].frequency=next.clock/(32*4096);panel.update(next);
  assert.equal(period.value,'123');assert.equal(control(root,'frequency').value,String(Number(next.channels[0].frequency.toFixed(6))));assert.match(huc6280VoiceCode(next),/Raw period 0; 0 encodes 4096/);assert.deepEqual(calls,[]);panel.dispose();
});

test('channel, master and LFO edits send independent partial fields without triggering',async()=>{
  const{root,panel,calls}=fixture();for(const[name,value]of[['volume','31'],['pan-left','2'],['pan-right','3'],['period','0'],['frequency','432.5'],['master-left','4'],['master-right','5'],['lfo-frequency','255'],['lfo-depth','3']]){control(root,name).value=value;await control(root,name).fire('change');}
  control(root,'note').value='C4';await control(root,'note').fire('change');control(root,'lfo-reset').checked=true;await control(root,'lfo-reset').fire('change');
  assert.deepEqual(calls,[['setVoice',[0,{volume:31}]],['setVoice',[0,{pan:{left:2}}]],['setVoice',[0,{pan:{right:3}}]],['setVoice',[0,{period:0}]],['setFrequency',[0,432.5]],['setMasterVolume',[{left:4}]],['setMasterVolume',[{right:5}]],['setLfo',[{frequency:255}]],['setLfo',[{depth:3}]],['setNote',[0,60]],['setLfo',[{reset:true}]]]);
  for(const[name,value]of[['volume','32'],['period','4096'],['pan-left','2.5'],['lfo-frequency','256']]){control(root,name).value=value;await control(root,name).fire('change');}assert.equal(calls.length,11);panel.dispose();
});

test('five-bit waveform drawing sends exactly one 32-value update on release and retains independent settings',async()=>{
  const{root,panel,calls}=fixture();const canvas=control(root,'waveform');await canvas.fire('pointerdown',{pointerId:1,button:0,clientX:0,clientY:160});await canvas.fire('pointermove',{pointerId:1,clientX:799,clientY:0});assert.deepEqual(calls,[]);
  const changed=state();changed.channels[0].volume=12;panel.update(changed);await canvas.fire('pointerup',{pointerId:1});assert.equal(calls.length,1);assert.equal(calls[0][0],'setWaveform');assert.equal(calls[0][1][0],0);const wave=calls[0][1][1];assert.equal(wave.length,32);assert.equal(wave[0],0);assert.equal(wave[31],31);assert(wave.every(value=>Number.isInteger(value)&&value>=0&&value<=31));panel.dispose();
});

test('cancelled, hidden, disconnected or old-channel waveform strokes never write',async()=>{
  const{root,panel,calls}=fixture();const canvas=control(root,'waveform');
  for(const cancel of ['pointercancel','lostpointercapture','hide','channel','disconnect']){await canvas.fire('pointerdown',{pointerId:1,button:0,clientX:10,clientY:20});if(cancel==='hide')panel.setVisible(false);else if(cancel==='channel')await channel(root,1).fire('click');else if(cancel==='disconnect')panel.setConnected(false);else await canvas.fire(cancel,{pointerId:1});await canvas.fire('pointerup',{pointerId:1});panel.setVisible(true);panel.setConnected(true);}
  assert.deepEqual(calls,[]);panel.dispose();
});

test('unknown raw waveform order is explained and only a complete explicit shape replaces it',async()=>{
  const{root,panel,calls}=fixture();const unknown=state();unknown.channels[0].waveformKnown=false;panel.update(unknown);assert.equal(control(root,'wave-index').disabled,true);assert.equal(control(root,'wave-value').disabled,true);assert.match(output(root,'wave-info').textContent,/unknown/);assert.doesNotMatch(huc6280VoiceCode(unknown),/pce\.setWaveform\(/);
  await control(root,'waveform').fire('pointerdown',{pointerId:1,button:0,clientX:10,clientY:20});await control(root,'waveform').fire('pointerup',{pointerId:1});assert.deepEqual(calls,[]);await action(root,'wave-triangle').fire('click');assert.equal(calls[0][0],'setWaveform');assert.deepEqual(calls[0][1][1],Array.from({length:32},(_,i)=>i<16?i*2:63-i*2));panel.dispose();
});

test('individual waveform sample edits and explicit shapes remain five-bit and keep channel selection',async()=>{
  const{root,panel,calls}=fixture();await channel(root,3).fire('click');control(root,'wave-index').value='31';await control(root,'wave-index').fire('change');control(root,'wave-value').value='7';await control(root,'wave-value').fire('change');assert.equal(calls[0][1][0],3);assert.equal(calls[0][1][1][31],7);
  for(const shape of ['sine','saw','square'])await action(root,`wave-${shape}`).fire('click');assert.equal(calls.length,4);for(const[,args]of calls){assert.equal(args[0],3);assert.equal(args[1].length,32);assert(args[1].every(value=>Number.isInteger(value)&&value>=0&&value<=31));}panel.dispose();
});

test('noise is exposed only on CH5 and CH6 and audition triggers its clock rather than an arbitrary note field',async()=>{
  const{root,panel,calls}=fixture();assert.equal(control(root,'noise-enabled').parentNode.parentNode.parentNode.hidden,true);await channel(root,4).fire('click');assert.equal(control(root,'noise-enabled').parentNode.parentNode.parentNode.hidden,false);
  control(root,'noise-frequency').value='31';await control(root,'noise-frequency').fire('change');control(root,'noise-enabled').checked=true;await control(root,'noise-enabled').fire('change');assert.deepEqual(calls,[['setVoice',[4,{noise:{frequency:31}}]],['setVoice',[4,{noise:{enabled:true}}]]]);
  const next=state();next.channels[4].noise.enabled=true;panel.update(next);assert.equal(control(root,'audition-midi').disabled,true);assert.equal(control(root,'frequency').disabled,true);control(root,'audition-midi').value='bad';await action(root,'hold').fire('pointerdown',{pointerId:1,button:0});assert.deepEqual(calls.at(-1)[1].slice(0,2),[4,60]);panel.dispose();
});

test('DDA disables note audition and enabling it explicitly releases the prior note first',async()=>{
  const{root,panel,calls,targets}=fixture();await action(root,'hold').fire('pointerdown',{pointerId:1,button:0});control(root,'dda').checked=true;await control(root,'dda').fire('change');assert.deepEqual(calls.map(([method])=>method),['auditionOn','auditionOff','setVoice']);assert.deepEqual(calls[2],['setVoice',[0,{dda:true}]]);
  const dda=state();dda.channels[0].dda=true;dda.channels[0].ddaValue=27;panel.update(dda);for(const name of ['hold','play','keyboard'])assert.equal(action(root,name).disabled,true);assert.equal(control(root,'dda-value').disabled,false);assert.equal(control(root,'dda-value').value,'27');
  await action(root,'play').fire('click');await action(root,'hold').fire('pointerdown',{pointerId:2,button:0});await action(root,'keyboard').fire('click');assert.equal(calls.length,3);assert.deepEqual(targets,[]);control(root,'dda-value').value='16';await control(root,'dda-value').fire('change');assert.deepEqual(calls.at(-1),['setVoice',[0,{ddaValue:16}]]);panel.dispose();
});

test('Hold releases on blur, correct pointer cancellation, channel selection and disconnect',async()=>{
  const{root,panel,calls,win}=fixture(),hold=action(root,'hold');await hold.fire('pointerdown',{pointerId:1,button:0});await hold.fire('pointerdown',{pointerId:2,button:0});assert.equal(calls.length,3);await hold.fire('pointerup',{pointerId:1});assert.equal(calls.length,3);await hold.fire('pointercancel',{pointerId:2});assert.deepEqual(calls[3],['auditionOff',[0,calls[2][1][2]]]);
  await hold.fire('keydown',{key:' ',repeat:false});await win.fire('blur');assert.equal(calls.at(-1)[0],'auditionOff');await hold.fire('pointerdown',{pointerId:3,button:0});await channel(root,5).fire('click');assert.equal(calls.at(-1)[0],'auditionOff');await hold.fire('pointerdown',{pointerId:4,button:0});panel.setConnected(false);assert.deepEqual(calls.at(-1)[1].slice(0,1),[5]);panel.dispose();
});

test('one-second preview is bounded and hiding cancels it without retiring Keyboard',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const{root,panel,calls,targets}=fixture();await action(root,'play').fire('click');t.mock.timers.tick(999);assert.equal(calls.length,1);t.mock.timers.tick(1);await flush();assert.deepEqual(calls[1],['auditionOff',[0,calls[0][1][2]]]);
  await action(root,'keyboard').fire('click');const target=targets.at(-1);await action(root,'play').fire('click');panel.setVisible(false);t.mock.timers.tick(1000);await flush();assert.equal(calls.length,4);target.noteOn({id:'hidden',midi:60});await flush();assert.equal(calls[4][0],'auditionOn');await action(root,'play').fire('click');assert.equal(calls.length,5);panel.dispose();
});

test('Keyboard ownership isolates press IDs across channel changes, replacement bindings and disconnect',async()=>{
  const{root,panel,calls,targets}=fixture();await action(root,'keyboard').fire('click');const first=targets.at(-1);assert.equal(first.owner,'huc6280-voice-panel');first.noteOn({id:'press',midi:60});await flush();await channel(root,2).fire('click');const second=targets.at(-1);second.noteOn({id:'press',midi:67});first.noteOff({id:'press'});first.allNotesOff();first.noteOn({id:'late',midi:69});await flush();assert.deepEqual(calls.map(([method])=>method),['auditionOn','auditionOff','auditionOn']);assert.equal(calls[2][1][0],2);
  panel.setKeyboardActive(false);await flush();await channel(root,3).fire('click');assert.equal(targets.length,2);second.noteOn({id:'retired',midi:69});assert.equal(calls.length,4);await action(root,'keyboard').fire('click');panel.setConnected(false);assert.equal(targets.at(-1),null);panel.dispose();
});

test('voice JavaScript copies exact waveform/period/global settings and keeps DDA code gated',()=>{
  const wave=state(),code=huc6280VoiceCode(wave,0);assert.match(code,/pce\.setWaveform\(0, \[0,1,2/);assert.match(code,/writeRegister\(2, 254\)/);assert.match(code,/writeRegister\(3, 160\)/);assert.match(code,/setMasterVolume\(15, 14\)/);assert.match(code,/setLfo\(/);assert.match(code,/setDda\(0, false\)/);assert.doesNotMatch(code,/writeDda\(/);
  wave.channels[0].dda=true;wave.channels[0].ddaValue=23;wave.channels[0].waveformKnown=false;const dda=huc6280VoiceCode(wave,0);assert.match(dda,/pce\.writeDda\(0, 23\)/);assert.doesNotMatch(dda,/pce\.keyOn\(/);assert(dda.indexOf('pce.keyOff(0)')<dda.indexOf('pce.writeDda(0, 23)'),'unknown wave order must not leave a previously enabled channel outputting a held DAC value');
});

test('old-instance errors stay silent and disposal removes every registered handler',async()=>{
  let rejectCommand;const{root,panel,doc,win,errors}=fixture({invoke:()=>new Promise((resolve,reject)=>{rejectCommand=reject;})});control(root,'volume').value='20';const changing=control(root,'volume').fire('change');panel.setConnected(false);panel.setConnected(true);rejectCommand(new Error('Old chip disconnected'));await changing;assert.deepEqual(errors,[]);panel.dispose();panel.dispose();for(const node of [...walk(root),doc,win])assert.equal([...node.listeners.values()].reduce((sum,entries)=>sum+entries.size,0),0);
});
