import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createEditor} from './editor.js';
import {createDefaultPreset,readPreset,presetToCode} from './preset.js';
import {createChannelSettings,readChannelSettings,selectedChannelPreset,selectChannelTarget,applyChannelPreset,editChannelPreset,channelPlaybackPlan,channelSettingsToCode} from './channel_settings.js';
import {captureSidVoices} from '../sid-player/voice_snapshot.js';
import {readSidLiveVoice} from './sid_live_view.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
  constructor(doc,tag='div'){
    Object.assign(this,{ownerDocument:doc,tagName:tag,children:[],dataset:{},attributes:{},listeners:new Map(),value:'',textContent:'',disabled:false,hidden:false,checked:false});
    const classes=new Set();this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),toggle:(name,on)=>{if(on??!classes.has(name))classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)};
  }
  append(...nodes){for(const node of nodes)this.appendChild(node);}
  appendChild(node){this.children.push(node);return node;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  getAttribute(key){return this.attributes[key];}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  async fire(type,extra={}){if(this.disabled&&['click','pointerdown','keydown'].includes(type))return;const event={type,target:this,button:0,pointerId:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};for(const fn of this.listeners.get(type)??[])await fn(event);return event;}
  focus(){this.ownerDocument.activeElement=this;}
  blur(){if(this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=null;}
  setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}
  querySelectorAll(selector){return walk(this).filter(node=>selector==='.key'?node.className==='key':false);}
}
const walk=node=>[node,...node.children.flatMap(walk)];
const find=(root,id)=>walk(root).find(node=>node.id===id);
const choice=(root,id,value)=>walk(root).find(node=>node.dataset.choiceFor===id&&node.dataset.value===value);
const step=(root,id,delta)=>walk(root).find(node=>node.dataset.stepperFor===id&&node.dataset.stepperDelta===String(delta));
function editorFixture(t,options={}){
  const doc={activeElement:null,createElement:tag=>new Element(doc,tag)},root=new Element(doc),changes=[],errors=[];
  const previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  const editor=createEditor({root,onChange:value=>changes.push(value),onError:error=>errors.push(error),...options});
  return{root,doc,changes,errors,editor};
}

test('passive SID editor uses compact stepper/buttons, keeps folds and enables a chosen filter mode',async t=>{
  const f=editorFixture(t);
  assert.equal(f.changes.length,0);assert.equal(find(f.root,'filterCard').open,true);assert.equal(find(f.root,'voiceCard').open,true);assert.equal(find(f.root,'modulationCard').open,false);
  assert.equal(walk(f.root).some(node=>node.tagName==='select'||node.tagName==='input'&&node.type==='number'),false);
  assert.equal(find(f.root,'filterEnabled').checked,false);
  await find(f.root,'filterLowpass').fire('click');
  assert.equal(f.changes.at(-1).filter.enabled,true,'turning on a filter output enables the filter');
  assert.equal(find(f.root,'filterEnabled').checked,true);
  find(f.root,'filterEnabled').checked=false;await find(f.root,'filterEnabled').fire('change');
  assert.equal(f.changes.at(-1).filter.enabled,false);assert.match(find(f.root,'filterHelp').textContent,/dry routing/);
  find(f.root,'voiceCard').open=false;const next=createDefaultPreset();next.voice.attack=7;f.editor.update(next);assert.equal(find(f.root,'voiceCard').open,false,'incoming state never reopens a folded card');
  f.editor.dispose();
});

test('SID model choices preserve the sound settings, return pointer focus and support keyboard navigation',async t=>{
  const f=editorFixture(t),group=find(f.root,'sidModel'),old=choice(f.root,'sidModel','6581'),preview=choice(f.root,'sidModel','8580');
  assert.equal(group.getAttribute('role'),'radiogroup');assert.match(preview.textContent,/8580.*Preview/);
  assert.equal(old.getAttribute('aria-checked'),'true');assert.equal(preview.getAttribute('aria-checked'),'false');
  const patch=createDefaultPreset();patch.voice.waveform='pulse';patch.voice.attack=7;patch.modulation.ring=true;patch.filter={enabled:true,mode:'notch',cutoff:1234,resonance:11,volume:6};f.editor.update(patch);
  const typing=new Element(f.doc,'input');typing.focus();const event=await preview.fire('pointerdown');
  assert.equal(event.defaultPrevented,true);assert.equal(f.doc.activeElement,null,'model buttons must leave performance keys available');
  await preview.fire('click');assert.deepEqual(f.changes.at(-1),{...patch,model:'8580'});
  assert.equal(old.getAttribute('aria-checked'),'false');assert.equal(preview.getAttribute('aria-checked'),'true');assert.equal(preview.tabIndex,0);assert.equal(old.tabIndex,-1);
  const left=await group.fire('keydown',{key:'ArrowLeft'});assert.equal(left.defaultPrevented,true);assert.equal(f.editor.getPreset().model,'6581');assert.equal(f.doc.activeElement,old);
  await group.fire('keydown',{key:'End'});assert.equal(f.editor.getPreset().model,'8580');assert.equal(f.doc.activeElement,preview);
  f.editor.update(patch);assert.equal(old.getAttribute('aria-checked'),'true','a rejected model ACK can restore the actual model');assert.equal(preview.getAttribute('aria-checked'),'false');
  assert.equal(f.errors.length,0);f.editor.dispose();
});

test('independent filter outputs combine, preserve shared settings and bypass when the last output turns off',async t=>{
  const f=editorFixture(t),lp=find(f.root,'filterLowpass'),bp=find(f.root,'filterBandpass'),hp=find(f.root,'filterHighpass');
  const shared=f.editor.getPreset().filter;
  for(const [button,mode]of [[lp,'lowpass'],[bp,'lowpass+bandpass'],[hp,'lowpass+bandpass+highpass'],[lp,'bandpass+highpass'],[bp,'highpass'],[hp,'off']]){
    await button.fire('click');const value=f.changes.at(-1).filter;
    assert.equal(value.mode,mode);assert.equal(value.enabled,mode!=='off');
    for(const key of ['cutoff','resonance','volume'])assert.equal(value[key],shared[key]);
  }
  assert.equal(find(f.root,'filterEnabled').checked,false);for(const button of [lp,bp,hp])assert.equal(button.getAttribute('aria-pressed'),'false');
  const enable=find(f.root,'filterEnabled');enable.checked=true;await enable.fire('change');
  assert.equal(f.editor.getPreset().filter.mode,'lowpass');await hp.fire('click');
  assert.equal(f.editor.getPreset().filter.mode,'notch');assert.match(find(f.root,'filterHelp').textContent,/LP \+ HP \(Notch\)/);
  const legacy=createDefaultPreset();legacy.filter.enabled=true;legacy.filter.mode='notch';f.editor.update(legacy);
  assert.equal(lp.getAttribute('aria-pressed'),'true');assert.equal(bp.getAttribute('aria-pressed'),'false');assert.equal(hp.getAttribute('aria-pressed'),'true');
  const input=new Element(f.doc,'input');input.focus();assert.equal((await bp.fire('pointerdown')).defaultPrevented,true);assert.equal(f.doc.activeElement,null);
  assert.equal(f.errors.length,0);f.editor.dispose();
});

test('wave/Pulse/ADSR/filter edits use the latest patch and pointer editing returns focus to performance',async t=>{
  const f=editorFixture(t);assert.equal(find(f.root,'pulseWidthRange').disabled,true);
  await choice(f.root,'waveform','pulse').fire('click');assert.equal(find(f.root,'pulseWidthRange').disabled,false);
  const width=find(f.root,'pulseWidthRange');width.value='1023';await width.fire('input');assert.equal(f.changes.at(-1).voice.pulseWidth,1023);
  const next=createDefaultPreset();next.voice.attack=7;f.editor.update(next);await step(f.root,'attack',1).fire('click');assert.equal(f.changes.at(-1).voice.attack,8,'external patch replaces the stepper basis');
  await find(f.root,'attack').fire('keydown',{key:'End'});assert.equal(f.changes.at(-1).voice.attack,15);assert.equal(step(f.root,'attack',1).disabled,true);
  await step(f.root,'filterResonance',1).fire('click');assert.equal(f.changes.at(-1).filter.resonance,5);
  const text=new Element(f.doc,'input');text.focus();const event=await choice(f.root,'waveform','triangle').fire('pointerdown');assert.equal(event.defaultPrevented,true);assert.equal(f.doc.activeElement,null);
  width.focus();await width.fire('pointerup');assert.equal(f.doc.activeElement,null);
  assert.equal(f.errors.length,0);f.editor.dispose();
});

test('Sync/Ring keep hardware waveform choice, explain capacity and expose software ratio',async t=>{
  const f=editorFixture(t),ring=find(f.root,'ringEnabled');ring.checked=true;await ring.fire('change');
  assert.equal(f.changes.at(-1).voice.waveform,'saw');assert.match(find(f.root,'modulationHelp').textContent,/maximum 1 note/);assert.match(find(f.root,'modulationHelp').textContent,/Triangle only/);
  await choice(f.root,'waveform','triangle').fire('click');assert.doesNotMatch(find(f.root,'modulationHelp').textContent,/select Triangle/);
  await find(f.root,'modulationRatio').fire('keydown',{key:'End'});assert.equal(f.changes.at(-1).modulation.ratio,8);
  const oscillatorTest=find(f.root,'oscillatorTest');oscillatorTest.checked=true;await oscillatorTest.fire('change');assert.equal(f.changes.at(-1).voice.test,true);assert.match(find(f.root,'testHelp').textContent,/TEST is held/);
  f.editor.dispose();
});

test('an imported fractional ratio retains its exact value across display, range and unrelated authoring edits',async t=>{
  const f=editorFixture(t),ratio=4/3,preset=createDefaultPreset();
  preset.modulation={sync:true,ring:true,ratio};preset.voice.waveform='triangle';preset.name='Captured pair';f.editor.update(preset);
  const value=find(f.root,'modulationRatio'),range=find(f.root,'modulationRatioRange');
  assert.equal(f.changes.length,0,'rendering an imported ratio never writes a rounded draft');
  assert.equal(value.textContent,'≈ 1.33333');assert.equal(value.title,String(ratio));
  assert.equal(value.getAttribute('aria-valuenow'),String(ratio));assert.equal(value.getAttribute('aria-valuetext'),'≈ 1.33333');
  assert.equal(range.step,'any','the HTML range must not sanitize the ratio onto a .125 grid');assert.equal(range.value,String(ratio));
  assert.equal(range.getAttribute('aria-valuenow'),String(ratio));
  await range.fire('input');assert.equal(f.editor.getPreset().modulation.ratio,ratio,'even an unchanged range input retains the imported ratio');
  await find(f.root,'filterLowpass').fire('click');await step(f.root,'attack',1).fire('click');await choice(f.root,'waveform','pulse').fire('click');await choice(f.root,'sidModel','8580').fire('click');
  for(const changed of f.changes)assert.equal(changed.modulation.ratio,ratio);
  const renamed={...f.editor.getPreset(),name:'Renamed pair'};f.editor.update(renamed);
  assert.equal(f.editor.getPreset().modulation.ratio,ratio);assert.equal(f.editor.getPreset().name,'Renamed pair');
  const saved=readPreset(JSON.stringify(f.editor.getPreset()));assert.equal(saved.modulation.ratio,ratio);
  assert.match(presetToCode(saved),new RegExp('carrierHz \\* '+String(ratio).replaceAll('.','\\.')));
  assert.equal(find(f.root,'modulationCard').open,false,'incoming pairs preserve the existing fold state');
  assert.equal(f.errors.length,0);f.editor.dispose();
});

test('ratio buttons, drag and both keyboard surfaces step from the exact imported basis and clamp only at bounds',async t=>{
  const f=editorFixture(t),ratio=12139/9113,preset=createDefaultPreset();preset.modulation.ratio=ratio;f.editor.update(preset);
  const value=find(f.root,'modulationRatio'),range=find(f.root,'modulationRatioRange');
  await step(f.root,'modulationRatio',1).fire('click');assert.equal(f.editor.getPreset().modulation.ratio,ratio+.125);
  await step(f.root,'modulationRatio',-1).fire('click');assert.equal(f.editor.getPreset().modulation.ratio,ratio);
  await value.fire('keydown',{key:'ArrowUp'});assert.equal(f.editor.getPreset().modulation.ratio,ratio+.125);
  const down=await range.fire('keydown',{key:'ArrowDown'});assert.equal(down.defaultPrevented,true);assert.equal(f.editor.getPreset().modulation.ratio,ratio);
  await range.fire('keydown',{key:'PageUp'});assert.equal(f.editor.getPreset().modulation.ratio,ratio+1.25);
  await value.fire('keydown',{key:'PageDown'});assert.equal(f.editor.getPreset().modulation.ratio,ratio);
  const typing=new Element(f.doc,'input');typing.focus();
  await value.fire('pointerdown',{pointerId:7,clientX:0});assert.equal(f.doc.activeElement,null);
  await value.fire('pointermove',{pointerId:7,clientX:160*.125/(8-.125)});assert.equal(f.editor.getPreset().modulation.ratio,ratio+.125);
  await value.fire('pointerup',{pointerId:7});assert.equal(value.hasPointerCapture(7),false);
  for(const [initial,delta,bound]of [[.125+1e-10,-1,.125],[8-1e-10,1,8]]){
    f.editor.update({...preset,modulation:{...preset.modulation,ratio:initial}});
    await step(f.root,'modulationRatio',delta).fire('click');assert.equal(f.editor.getPreset().modulation.ratio,bound);
    assert.equal(step(f.root,'modulationRatio',delta).disabled,true);
  }
  await range.fire('keydown',{key:'Home'});assert.equal(f.editor.getPreset().modulation.ratio,.125);assert.equal(value.textContent,'0.125');
  await range.fire('keydown',{key:'End'});assert.equal(f.editor.getPreset().modulation.ratio,8);assert.equal(value.textContent,'8');
  range.focus();await range.fire('pointercancel');assert.equal(f.doc.activeElement,null);
  f.editor.dispose();const before=f.editor.getPreset();await value.fire('keydown',{key:'Home'});assert.deepEqual(f.editor.getPreset(),before);
  assert.equal(f.errors.length,0);
});

test('invalid external patches keep the editor, and disposal ignores late callbacks and edits',async t=>{
  let reject;const f=editorFixture(t,{onChange:()=>new Promise((_resolve,fail)=>{reject=fail;})});
  const before=f.editor.getPreset();assert.throws(()=>f.editor.update({...before,voice:{...before.voice,attack:99}}),/attack/);assert.deepEqual(f.editor.getPreset(),before);
  await step(f.root,'decay',1).fire('click');f.editor.dispose();reject(new Error('late audio failure'));await flush();assert.equal(f.errors.length,0);
  const retained=f.editor.getPreset();await step(f.root,'decay',1).fire('click');assert.deepEqual(f.editor.getPreset(),retained);
});

function liveObservation({waveformMask=0x70,frequency=0x1200,sourceFrequency=0x2400,modeMask=5,routed=true,voice=0}={}){
  const registers=Array(32).fill(0),base=voice*7,source=((voice+2)%3)*7;
  registers[base]=frequency&255;registers[base+1]=frequency>>8;
  registers[base+2]=0x34;registers[base+3]=0xa;
  registers[base+4]=waveformMask|15;registers[base+5]=0x98;registers[base+6]=0x76;
  registers[source]=sourceFrequency&255;registers[source+1]=sourceFrequency>>8;
  registers[21]=4;registers[22]=187;registers[23]=0xb0|(routed?1<<voice:0);registers[24]=0x80|(modeMask<<4)|13;
  return readSidLiveVoice({model:'6581',clockHz:985248,sampleRate:48000,positionFrames:9600,registers,voices:[{envelope:77},{envelope:88},{envelope:99}]},voice);
}

test('Live samples update the same controls and folds while preserving the authored preset beneath them',t=>{
  const f=editorFixture(t),before=f.editor.getPreset(),nodes=walk(f.root);
  find(f.root,'voiceCard').open=false;find(f.root,'modulationCard').open=true;
  const o=liveObservation();f.editor.observe(o);
  assert.deepEqual(walk(f.root),nodes,'observation never rebuilds the control tree');
  assert.equal(find(f.root,'voiceCard').open,false);assert.equal(find(f.root,'modulationCard').open,true);
  assert.equal(f.root.dataset.observing,'true');assert.equal(find(f.root,'pulseWidth').textContent,String(0xa34));
  for(const [id,value]of [['attack',9],['decay',8],['sustain',7],['release',6],['filterCutoff',1500],['filterResonance',11],['chipVolume',13]])assert.equal(find(f.root,id).getAttribute('aria-valuenow'),String(value));
  assert.equal(find(f.root,'filterEnabled').checked,true);assert.equal(find(f.root,'oscillatorTest').checked,true);
  assert.equal(find(f.root,'syncEnabled').checked,true);assert.equal(find(f.root,'ringEnabled').checked,true);
  assert.deepEqual(f.editor.getPreset(),before);assert.equal(f.changes.length,0);
  const next=readPreset(before);next.voice.attack=3;next.voice.waveform='noise';f.editor.update(next);
  assert.equal(find(f.root,'attack').textContent,'9','an authored update does not replace the selected live observation');
  f.editor.observe(null);
  assert.deepEqual(f.editor.getPreset(),next);assert.equal(find(f.root,'attack').textContent,'3');assert.equal(choice(f.root,'waveform','noise').getAttribute('aria-pressed'),'true');
  assert.deepEqual(walk(f.root),nodes);assert.equal(find(f.root,'voiceCard').open,false);assert.equal(f.changes.length,0);
});

test('Live controls faithfully show combined/no waveforms, unrouted outputs and silent filter routing',t=>{
  const f=editorFixture(t),wave=find(f.root,'waveform');f.editor.observe(liveObservation({routed:false,modeMask:7}));
  assert.equal(wave.getAttribute('role'),'group');
  for(const [name,on]of [['triangle',true],['saw',true],['pulse',true],['noise',false]]){
    const node=choice(f.root,'waveform',name);assert.equal(node.getAttribute('aria-pressed'),String(on));assert.equal(node.getAttribute('aria-checked'),undefined);
  }
  assert.equal(find(f.root,'filterEnabled').checked,false);
  for(const id of ['filterLowpass','filterBandpass','filterHighpass'])assert.equal(find(f.root,id).getAttribute('aria-pressed'),'true','the shared output flags are observed even for a dry voice');
  f.editor.observe(liveObservation({waveformMask:0,modeMask:0,routed:true}));
  for(const name of ['triangle','saw','pulse','noise'])assert.equal(choice(f.root,'waveform',name).getAttribute('aria-pressed'),'false');
  assert.equal(find(f.root,'filterEnabled').checked,true);assert.match(find(f.root,'filterHelp').textContent,/all outputs off \(silent routing\)/);
  f.editor.observe(null);assert.equal(wave.getAttribute('role'),'group');assert.equal(choice(f.root,'waveform','saw').getAttribute('aria-pressed'),'true');
});

test('waveform toggles combine independently, allow silence and keep Pulse width and Ring tied to their waveform bits',async t=>{
  const f=editorFixture(t),wave=find(f.root,'waveform');assert.equal(wave.getAttribute('role'),'group');
  await choice(f.root,'waveform','triangle').fire('click');assert.equal(f.editor.getPreset().voice.waveform,'triangle+saw');
  for(const name of ['triangle','saw'])assert.equal(choice(f.root,'waveform',name).getAttribute('aria-pressed'),'true');
  await choice(f.root,'waveform','pulse').fire('click');assert.equal(f.editor.getPreset().voice.waveform,'triangle+saw+pulse');
  assert.equal(find(f.root,'pulseWidthRange').disabled,false);
  const ring=find(f.root,'ringEnabled');ring.checked=true;await ring.fire('change');assert.equal(find(f.root,'modulationHelp').dataset.warning,undefined);
  await choice(f.root,'waveform','triangle').fire('click');assert.equal(f.editor.getPreset().voice.waveform,'saw+pulse');
  assert.equal(find(f.root,'modulationHelp').dataset.warning,'true');
  await choice(f.root,'waveform','saw').fire('click');await choice(f.root,'waveform','pulse').fire('click');
  assert.equal(f.editor.getPreset().voice.waveform,'off');assert.equal(find(f.root,'pulseWidthRange').disabled,true);
  for(const name of ['triangle','saw','pulse','noise'])assert.equal(choice(f.root,'waveform',name).getAttribute('aria-pressed'),'false');
  const before=f.changes.length;choice(f.root,'waveform','triangle').focus();await wave.fire('keydown',{key:'ArrowRight'});
  assert.equal(f.doc.activeElement,choice(f.root,'waveform','saw'));assert.equal(f.changes.length,before,'arrow navigation does not toggle waveforms');
});

test('out-of-keyboard-range and undefined observed ratios are displayed without clamping to an editable value',t=>{
  const f=editorFixture(t),value=find(f.root,'modulationRatio'),range=find(f.root,'modulationRatioRange');
  f.editor.observe(liveObservation({frequency:1,sourceFrequency:65535}));
  assert.equal(value.textContent,'65535');assert.equal(value.getAttribute('aria-valuenow'),'65535');assert.equal(value.dataset.outOfRange,'true');assert.equal(range.dataset.unavailable,'true');
  assert.match(find(f.root,'modulationHelp').textContent,/outside the keyboard tuning range/);
  f.editor.observe(liveObservation({frequency:0}));assert.equal(value.textContent,'—');assert.equal(value.getAttribute('aria-valuenow'),undefined);assert.equal(range.dataset.unavailable,'true');
  f.editor.observe(null);assert.equal(value.textContent,'1');assert.equal(range.dataset.unavailable,'false');assert.equal(range.disabled,false);
});

test('live and waiting controls reject edits without changing the instrument or callbacks, then return to editing',async t=>{
  const f=editorFixture(t),before=f.editor.getPreset();
  f.editor.observe(null,{active:true});assert.equal(f.root.dataset.observing,'true');assert.equal(find(f.root,'attack').disabled,true);
  const input=find(f.root,'filterEnabled');input.checked=true;await input.fire('change');
  find(f.root,'pulseWidthRange').value='4095';await find(f.root,'pulseWidthRange').fire('input');
  await find(f.root,'waveform').fire('keydown',{key:'End'});
  assert.deepEqual(f.editor.getPreset(),before);assert.equal(f.changes.length,0);assert.equal(input.checked,false);
  f.editor.observe(liveObservation());const liveWidth=find(f.root,'pulseWidth').textContent;
  find(f.root,'pulseWidthRange').value='1';await find(f.root,'pulseWidthRange').fire('input');assert.equal(find(f.root,'pulseWidth').textContent,liveWidth);
  assert.deepEqual(f.editor.getPreset(),before);assert.equal(f.changes.length,0);
  f.editor.observe(null);await step(f.root,'attack',1).fire('click');assert.equal(f.changes.length,1);assert.equal(f.editor.getPreset().voice.attack,before.voice.attack+1);
});

test('question-mark help starts closed, toggles independently, preserves focus/folds and survives Live updates',async t=>{
  const f=editorFixture(t);
  for(const id of ['filterCard','voiceCard','modulationCard']){
    assert.equal(find(f.root,`${id}HelpPanel`).hidden,true);assert.equal(find(f.root,`${id}HelpButton`).getAttribute('aria-expanded'),'false');
  }
  const card=find(f.root,'filterCard'),button=find(f.root,'filterCardHelpButton'),panel=find(f.root,'filterCardHelpPanel');let stopped=false;
  button.focus();const click=await button.fire('click',{stopPropagation(){stopped=true;}});
  assert.equal(click.defaultPrevented,true);assert.equal(stopped,true);assert.equal(panel.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(card.open,true);assert.equal(f.doc.activeElement,null);
  f.editor.observe(liveObservation());f.editor.observe(liveObservation({modeMask:0}));f.editor.observe(null);
  assert.equal(panel.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(card.open,true);assert.equal(f.changes.length,0);
  await button.fire('click');assert.equal(panel.hidden,true);assert.equal(f.changes.length,0);
  const folded=find(f.root,'modulationCard'),foldedHelp=find(f.root,'modulationCardHelpButton');
  assert.equal(folded.open,false);await foldedHelp.fire('click');
  assert.equal(folded.open,true,'requesting help reveals a collapsed section');assert.equal(find(f.root,'modulationCardHelpPanel').hidden,false);
  folded.open=false;await foldedHelp.fire('click');
  assert.equal(folded.open,true,'help reveals a section collapsed after its help was opened');assert.equal(find(f.root,'modulationCardHelpPanel').hidden,false);
  await foldedHelp.fire('click');assert.equal(folded.open,true,'closing help never closes the section');assert.equal(find(f.root,'modulationCardHelpPanel').hidden,true);
});

const appSource=(await readFile(new URL('./synth.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from\s*['"][^'"]+['"];\n/gm,'');
function appFixture({stall=false}={}){
  const ids=new Map(),doc=new Element(null,'document');doc.ownerDocument=doc;doc.activeElement=null;doc.hidden=false;doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>{if(!ids.has(id)){const node=new Element(doc);node.id=id;ids.set(id,node);}return ids.get(id);};
  for(const id of ['masterVolume','pitchBend','keyboardPitchBend'])doc.getElementById(id).value=id==='masterVolume'?'.7':'0';
  doc.getElementById('codeOutput').hidden=true;
  const modes=['waveform','spectrum'].map(mode=>{const node=new Element(doc,'button');node.dataset.visualMode=mode;node.setAttribute('aria-pressed',String(mode==='waveform'));return node;});
  const channels=['0','1','2','round-robin'].map(value=>{const node=new Element(doc,'button');node.dataset.sidLiveVoice=value;return node;});
  doc.querySelectorAll=selector=>selector==='[data-visual-mode]'?modes:selector==='[data-sid-live-voice]'?channels:[];doc.querySelector=()=>modes.find(node=>node.getAttribute('aria-pressed')==='true');
  const visualEvents=[];
  const win=new Element(doc,'window'),calls=[],engines=[],pending=[],audioOptions=[],editorUpdates=[],visual={setMode(){},setRunning(value){visualEvents.push(['running',value]);},connect(){},disconnect(){},stop(){visualEvents.push(['stop']);},wake(){},dispose(){}};
  let isStalled=stall,engineCount=0;
  const makeEngine=model=>{
    let settings=createChannelSettings(createDefaultPreset({model})),value=selectedChannelPreset(settings),pitch=0,voices=new Map();const engine={id:++engineCount,context:{},outputNode:{},sampleRate:48000,disposed:false,holdNext:null,
      async resume(){},setVolume(){},async dispose(){this.disposed=true;},
      async read(){return{preset:readPreset(value),channelSettings:readChannelSettings(settings),pitch,capacity:value.modulation.sync||value.modulation.ring||settings.target!=='round-robin'?1:3,voices:[...voices.values()]};},
      async command(method,args=[]){calls.push([engine.id,method,...args]);
        if(method==='noteOn'){if(voices.size>=(value.modulation.sync||value.modulation.ring?1:3))voices.delete(voices.keys().next().value);voices.set(args[0],{id:args[0],midi:args[1],channel:0});return{};}
        if(method==='noteOff')return voices.delete(args[0]);
        if(method==='stop'){voices.clear();pitch=0;const state=await engine.read();if(engine.holdStop)await engine.holdStop;return state;}
        if(method==='setPitch'){if(engine.rejectPositivePitch&&args[0]>0)throw new Error('Pitch outside SID range');pitch=args[0];return engine.read();}
        if(method==='loadChannelSettings'||method==='setChannelSettings'){
          const nextSettings=readChannelSettings(args[0]),next=selectedChannelPreset(nextSettings);if(next.model!==value.model){voices.clear();pitch=0;}
          if(engine.rejectPatch){engine.rejectPatch=false;throw new Error('Tuning outside SID range');}
          const previous=value,previousTarget=settings.target;settings=nextSettings;value=next;if(method==='loadChannelSettings'||previousTarget!==settings.target||previous.model!==value.model||previous.modulation.sync!==value.modulation.sync||previous.modulation.ring!==value.modulation.ring||previous.voice.test!==value.voice.test){voices.clear();pitch=0;}
          if(engine.holdNext){const wait=engine.holdNext;engine.holdNext=null;await wait;}
          return engine.read();
        }
      }};engines.push(engine);return engine;
  };
  const createAudio=({signal,model})=>{audioOptions.push({model});const engine=makeEngine(model);if(!isStalled)return Promise.resolve(engine);return new Promise((resolve,reject)=>{const item={resolve:()=>resolve(engine),reject,engine};pending.push(item);signal.addEventListener('abort',()=>{engine.disposed=true;reject(new DOMException('cancelled','AbortError'));},{once:true});});};
  const entries=[{key:'a',label:'A',midi:60},{key:'s',label:'S',midi:64},{key:'d',label:'D',midi:67},{key:'f',label:'F',midi:71}];
  const importState={playing:false,starting:false,paused:false,pausing:false,resuming:false},importCalls=[];
  const importer={state:importState,calls:importCalls,read:()=>({...importState}),setVolume(){},dispose:async()=>{},
    setLiveVoice(voice){importState.liveVoice=voice;importer.hooks.onUpdate(importer.read());},
    setLiveEnabled(value){importState.liveEnabled=value;importer.hooks.onUpdate(importer.read());},
    async stop(options){importCalls.push(options);importState.playing=false;importState.starting=false;importState.paused=false;importState.pausing=false;importState.resuming=false;if(importer.holdStop)await importer.holdStop;}};
  const context=vm.createContext({document:doc,window:win,createAudio,createDefaultPreset,readPreset,presetToCode,createChannelSettings,readChannelSettings,selectedChannelPreset,selectChannelTarget,applyChannelPreset,editChannelPreset,channelPlaybackPlan,channelSettingsToCode,captureSidVoices,createEditor:()=>({update(value){editorUpdates.push(readPreset(value));},observe(){},dispose(){}}),
    createSidImport:hooks=>{importer.hooks=hooks;return importer;},createSidImportPanel:()=>({update(){},dispose(){}}),createSidLiveView:()=>({update(state){return state.liveState?readSidLiveVoice(state.liveState,state.liveVoice??0):null;},dispose(){}}),
    createSpuOutputVisualizer:()=>visual,createFretboardState:()=>({}),createFretboardLayout:()=>({entries,rowDefs:[]}),renderFretboardControls(){},
    buildKeyboard({root,layoutEntries}){root.children=[];for(const entry of layoutEntries){const node=new Element(doc,'button');node.className='key';node.dataset.key=entry.key;root.append(node);}},
    setInstrument(){},setFretPosition(){},setStringWindowIndex(){},midiToNoteName:midi=>`note${midi}`,AbortController,DOMException,ResizeObserver:class{observe(){}disconnect(){}},navigator:{clipboard:{writeText:async()=>{}}},setTimeout,clearTimeout,URL,Blob,JSON,console});
  vm.runInContext(appSource+'\nglobalThis.testUi={ensureAudio,stopNotes,applyPreset,applySettings,chooseChannel,press,release,setPitch,getPreset:()=>preset,getSettings:()=>channelSettings,getNotes:()=>[...notes.values()],getAudio:()=>audio};',context);
  return{ui:context.testUi,doc,calls,engines,pending,audioOptions,editorUpdates,entries,importer,visualEvents,unstall(){isStalled=false;}};
}

test('a keyboard gesture fences song preview immediately and waits for its close before sounding the Synth',async()=>{
  const f=appFixture();let finish;f.importer.holdStop=new Promise(resolve=>{finish=resolve;});f.importer.state.playing=true;
  f.ui.press('pointer:1',f.entries[0]);
  assert.equal(f.importer.state.playing,false,'song ownership is retired synchronously');
  assert.equal(f.audioOptions.length,1,'Synth audio still opens in the original gesture');
  await flush();assert.equal(f.calls.some(call=>call[1]==='noteOn'),false,'song close gates the new audible note');
  finish();await flush();await flush();assert.equal(f.calls.filter(call=>call[1]==='noteOn').length,1);
  await f.doc.getElementById('stopAudio').fire('click');await flush();
  assert.equal(f.importer.calls.length,2,'global Stop also retires the song');assert.equal(f.ui.getNotes().length,0);
});

test('keyboard attacks retire paused or changing preview ownership before sounding the Synth',async()=>{
  for(const mode of ['paused','pausing','resuming']){
    const f=appFixture();let finish;f.importer.state[mode]=true;
    f.importer.holdStop=new Promise(resolve=>{finish=resolve;});
    f.ui.press('pointer:1',f.entries[0]);
    assert.equal(f.importer.state[mode],false);assert.equal(f.audioOptions.length,1);
    await flush();assert.equal(f.calls.some(call=>call[1]==='noteOn'),false);
    finish();await flush();await flush();assert.equal(f.calls.filter(call=>call[1]==='noteOn').length,1);
  }
});

test('stopping Synth notes preserves the live song monitor, while global Stop still stops it',async()=>{
  const f=appFixture();await f.ui.ensureAudio();
  const preview={context:{state:'running'},outputNode:{}};
  await f.importer.hooks.onPreviewStart(preview,{isCurrent:()=>true});f.importer.state.playing=true;f.visualEvents.length=0;
  await f.ui.stopNotes();assert.deepEqual(f.visualEvents.at(-1),['running',true]);assert.equal(f.visualEvents.some(event=>event[0]==='stop'),false);
  await f.doc.getElementById('stopAudio').fire('click');await flush();assert.deepEqual(f.visualEvents.at(-1),['stop']);
});

test('Live CH observation shares the visible editor without changing the authored instrument or opening Synth audio',()=>{
  const f=appFixture(),before=f.ui.getPreset();
  f.importer.hooks.onUpdate({playing:true,liveEnabled:true,liveVoice:2});
  assert.equal(f.doc.getElementById('voiceEditor').hidden,false);
  assert.equal(f.doc.getElementById('sidLiveView').hidden,false);
  assert.match(f.doc.getElementById('voiceHeading').textContent,/Live CH 3/);
  assert.deepEqual(f.ui.getPreset(),before);assert.equal(f.engines.length,0);
  f.importer.hooks.onUpdate({playing:false,paused:true,liveEnabled:true,liveVoice:1});
  assert.equal(f.doc.getElementById('voiceEditor').hidden,false);
  assert.equal(f.doc.getElementById('sidLiveView').hidden,false);
  assert.match(f.doc.getElementById('voiceHeading').textContent,/Paused CH 2/);
  assert.deepEqual(f.ui.getPreset(),before);assert.equal(f.engines.length,0);
  f.importer.hooks.onUpdate({playing:true,liveEnabled:false,liveVoice:2});
  assert.equal(f.doc.getElementById('voiceEditor').hidden,false);
  assert.equal(f.doc.getElementById('sidLiveView').hidden,true);
  f.importer.hooks.onUpdate({playing:false,liveEnabled:true,liveVoice:2});
  assert.equal(f.doc.getElementById('voiceEditor').hidden,false);
  assert.equal(f.doc.getElementById('patchStatus').hidden,false);
});

test('Round robin selection preserves independent drafts and only an edited field is broadcast before audio opens',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);
  const first=readPreset(f.ui.getPreset());first.voice.waveform='pulse';first.voice.attack=7;await f.ui.applyPreset(first);
  await f.ui.chooseChannel(1);assert.equal(f.ui.getPreset().voice.waveform,'saw');
  const second=readPreset(f.ui.getPreset());second.voice.waveform='triangle';second.filter.cutoff=1200;await f.ui.applyPreset(second);
  await f.ui.chooseChannel(0);assert.equal(f.ui.getPreset().voice.waveform,'pulse');assert.equal(f.ui.getPreset().voice.attack,7);
  assert.equal(f.ui.getPreset().filter.cutoff,1200,'the hardware filter remains shared');
  const before=f.ui.getSettings().channels;
  await f.ui.chooseChannel('round-robin');assert.match(f.doc.getElementById('voiceHeading').textContent,/Round robin/);
  assert.deepEqual(f.ui.getSettings().channels,before);assert.equal(f.doc.getElementById('sidChannelState').hidden,false);
  const edit=readPreset(f.ui.getPreset());edit.voice.attack=6;await f.ui.applyPreset(edit);
  for(let channel=0;channel<3;channel++){
    assert.equal(f.ui.getSettings().channels[channel].voice.attack,6);
    assert.equal(f.ui.getSettings().channels[channel].voice.waveform,before[channel].voice.waveform);
  }
  assert.equal(f.engines.length,0,'choosing or editing channels never starts audio');
});

function autoState(){
  const state=liveObservation({waveformMask:0x40});
  const registers=[...state.registers];registers[4]=0x41;
  return {model:state.model,clockHz:state.clockHz,sampleRate:state.sampleRate,positionFrames:state.positionFrames,registers};
}
test('Auto adopts only fresh playable song settings, freezes them for editing and preserves drafts on stale transitions',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);const authored=f.ui.getPreset(),liveState=autoState();
  const frame={playing:true,liveEnabled:true,liveVoice:0,liveState,liveSource:{name:'Auto source',subtune:1}};
  f.importer.hooks.onUpdate({...frame,liveActive:false,liveWaiting:true});assert.deepEqual(f.ui.getPreset(),authored);
  f.importer.hooks.onUpdate({...frame,liveActive:true});const adopted=f.ui.getPreset();
  assert.equal(adopted.voice.waveform,'pulse');assert.equal(adopted.voice.attack,9);
  assert.equal(f.ui.getSettings().channels[1].voice.waveform,'saw');assert.equal(f.engines.length,0);
  f.importer.hooks.onUpdate({...frame,liveEnabled:false,liveActive:false});assert.deepEqual(f.ui.getPreset(),adopted);
  const edited=readPreset(adopted);edited.voice.attack=4;await f.ui.applyPreset(edited);
  for(const pending of [{starting:true},{loading:true},{choosingFile:true},{pausing:true},{resuming:true}]){
    f.importer.hooks.onUpdate({...frame,playing:false,paused:true,liveActive:false,...pending});assert.equal(f.ui.getPreset().voice.attack,4);
  }
  f.importer.hooks.onUpdate({...frame,playing:false,paused:true,liveActive:false});assert.equal(f.ui.getPreset().voice.attack,9,'a stable Pause frame is adopted immediately');
});

test('selecting Round robin under Auto does not reapply the same settings from Pause or later playback frames',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);const liveState=autoState();
  const frame={playing:false,paused:true,liveEnabled:true,liveVoice:0,liveState,liveSource:{name:'Auto source',subtune:1}};
  f.importer.hooks.onUpdate(frame);const before=f.ui.getSettings().channels;
  assert.notDeepEqual(before[0].voice,before[1].voice);
  await f.ui.chooseChannel('round-robin');f.importer.hooks.onUpdate(frame);assert.deepEqual(f.ui.getSettings().channels,before);
  f.importer.hooks.onUpdate({...frame,paused:false,playing:true,liveActive:true,liveState:{...liveState,positionFrames:12000}});
  assert.deepEqual(f.ui.getSettings().channels,before,'time advancing alone cannot overwrite the saved CH values');
});

test('an explicit setup file wins over Auto observations while its text is being read',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);let finish;
  const setup=selectChannelTarget(createChannelSettings(),2);setup.channels[2].voice.waveform='triangle';
  const input=f.doc.getElementById('presetFileInput');input.files=[{size:1000,text:()=>new Promise(resolve=>{finish=()=>resolve(JSON.stringify(setup));})}];
  const reading=input.fire('change');await flush();
  f.importer.hooks.onUpdate({playing:true,liveEnabled:true,liveActive:true,liveVoice:0,liveState:autoState(),liveSource:{name:'Auto source',subtune:1}});
  finish();await reading;
  assert.equal(f.ui.getSettings().target,2);assert.equal(f.ui.getPreset().voice.waveform,'triangle');
  assert.equal(f.importer.state.liveEnabled,false,'explicit loading stops automatic replacement');
});

test('selecting 8580 before enabling audio initializes that model and exposes Preview without an audio side effect',async()=>{
  const f=appFixture(),preview=createDefaultPreset({model:'8580'});preview.voice.waveform='triangle';
  await f.ui.applyPreset(preview);assert.equal(f.engines.length,0);assert.equal(f.doc.getElementById('sidModelBadge').textContent,'8580');assert.equal(f.doc.getElementById('sidModelStatus').textContent,'PAL · PREVIEW');
  await f.ui.ensureAudio();assert.deepEqual(f.audioOptions,[{model:'8580'}]);assert.equal((await f.engines[0].read()).preset.model,'8580');assert.equal((await f.engines[0].read()).preset.voice.waveform,'triangle');
});

test('model replacement resets held owners and both Pitch wheels in the same audio context',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.ui.press('old',f.entries[0]);await flush();await flush();f.ui.setPitch(1);await flush();
  const preview=createDefaultPreset({model:'8580'});await f.ui.applyPreset(preview);
  const state=await f.engines[0].read();assert.equal(state.preset.model,'8580');assert.equal(state.voices.length,0);assert.equal(state.pitch,0);assert.equal(f.ui.getNotes().length,0);assert.equal(f.engines.length,1);
  assert.equal(f.calls.at(-1)[1],'loadChannelSettings');for(const id of ['pitchBend','keyboardPitchBend'])assert.equal(f.doc.getElementById(id).value,'0');
  f.ui.press('new',f.entries[1]);await flush();await flush();f.ui.release('old');await flush();assert.equal((await f.engines[0].read()).voices.length,1,'a release owned by the old model cannot cut the new note');
  f.ui.release('new');await flush();assert.equal((await f.engines[0].read()).voices.length,0);
});

test('a rejected model replacement restores acknowledged model controls and preserves a stopped playable old patch',async()=>{
  const f=appFixture();await f.ui.ensureAudio();const applied=createDefaultPreset();applied.voice.waveform='pulse';applied.filter.cutoff=1200;await f.ui.applyPreset(applied);
  f.ui.press('old',f.entries[0]);await flush();await flush();f.ui.setPitch(1);await flush();f.engines[0].rejectPatch=true;
  await assert.rejects(f.ui.applyPreset({...applied,model:'8580'}),/Tuning/);
  assert.deepEqual(f.ui.getPreset(),applied);assert.deepEqual(f.editorUpdates.at(-1),applied);assert.equal(f.doc.getElementById('sidModelBadge').textContent,'6581');assert.equal(f.doc.getElementById('sidModelStatus').textContent,'PAL · APPROXIMATION');
  assert.match(f.doc.getElementById('patchStatus').textContent,/rejected.*previous settings kept/);assert.equal(f.ui.getNotes().length,0);assert.equal((await f.engines[0].read()).voices.length,0);assert.equal((await f.engines[0].read()).pitch,0);
  f.engines[0].rejectPositivePitch=true;f.ui.setPitch(2);await flush();await flush();
  for(const id of ['pitchBend','keyboardPitchBend'])assert.equal(f.doc.getElementById(id).value,'0','a later rejected Pitch must restore the stopped instrument, not its pre-switch bend');
  f.ui.press('retry',f.entries[1]);await flush();await flush();assert.equal((await f.engines[0].read()).voices.length,1);f.ui.release('retry');await flush();assert.equal((await f.engines[0].read()).voices.length,0);
});

test('an earlier model ACK cannot replace a newer model draft and both transitions keep the reset',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.ui.press('held',f.entries[0]);await flush();await flush();let acknowledge;f.engines[0].holdNext=new Promise(resolve=>{acknowledge=resolve;});
  const first=f.ui.applyPreset(createDefaultPreset({model:'8580'}));await flush();const latest=createDefaultPreset();latest.voice.waveform='triangle';const last=f.ui.applyPreset(latest);
  assert.equal(f.doc.getElementById('sidModelBadge').textContent,'6581');acknowledge();await first;await last;
  assert.deepEqual(f.ui.getPreset(),latest);assert.deepEqual((await f.engines[0].read()).preset,latest);assert.equal(f.ui.getNotes().length,0);assert.equal((await f.engines[0].read()).voices.length,0);
  assert.deepEqual(f.calls.filter(call=>call[1]==='loadChannelSettings').slice(-2).map(call=>call[2].channels[0].model),['8580','6581']);assert.equal(f.engines.length,1);
});

test('startup Stop cancels pending ownership and a later key retries with a fresh silent engine',async()=>{
  const f=appFixture({stall:true});f.ui.press('first',f.entries[0]);await flush();assert.equal(f.engines.length,1);
  await f.ui.stopNotes();assert.equal(f.engines[0].disposed,true);assert.equal(f.ui.getNotes().length,0);
  f.unstall();f.ui.press('second',f.entries[1]);await flush();await flush();
  assert.equal(f.engines.length,2);assert.equal(f.calls.some(call=>call[0]===1&&call[1]==='noteOn'),false);assert.equal(f.calls.some(call=>call[0]===2&&call[1]==='noteOn'),true);
  f.ui.release('second');await flush();assert.equal((await f.engines[1].read()).voices.length,0);
});

test('Apply ACK cannot replace a newer draft; latest failure rolls back to the previous preset',async()=>{
  const f=appFixture();await f.ui.ensureAudio();let release;f.engines[0].holdNext=new Promise(resolve=>{release=resolve;});
  const first=createDefaultPreset();first.voice.waveform='pulse';const pendingFirst=f.ui.applyPreset(first);await flush();
  const latest=createDefaultPreset();latest.voice.waveform='triangle';const pendingLatest=f.ui.applyPreset(latest);release();await pendingFirst;await pendingLatest;
  assert.equal(f.ui.getPreset().voice.waveform,'triangle');assert.equal((await f.engines[0].read()).preset.voice.waveform,'triangle');
  f.engines[0].rejectPatch=true;const invalidAtPitch=readPreset(latest);invalidAtPitch.modulation.ratio=8;
  await assert.rejects(f.ui.applyPreset(invalidAtPitch),/Tuning/);assert.equal(f.ui.getPreset().modulation.ratio,1);
});

test('stolen IDs and topology changes remove old owners, and both Pitch wheels follow reset ACK',async()=>{
  const f=appFixture();await f.ui.ensureAudio();for(let index=0;index<4;index++)f.ui.press(`key${index}`,f.entries[index]);await flush();await flush();
  assert.equal(f.ui.getNotes().length,3);assert.equal(f.ui.getNotes().some(note=>note.midi===60),false);
  f.ui.release('key0');await flush();assert.equal((await f.engines[0].read()).voices.length,3,'stolen old key release does not cut its replacement');
  f.ui.setPitch(1);await flush();assert.equal(f.doc.getElementById('pitchBend').value,'1');assert.equal(f.doc.getElementById('keyboardPitchBend').value,'1');
  const pair=createDefaultPreset();pair.modulation.sync=true;await f.ui.applyPreset(pair);assert.equal(f.ui.getNotes().length,0);assert.equal(f.doc.getElementById('pitchBend').value,'0');assert.equal(f.doc.getElementById('keyboardPitchBend').value,'0');
});


test('a delayed Stop acknowledgement cannot retire a newly pressed note or lose its release',async()=>{
  const f=appFixture();await f.ui.ensureAudio();let acknowledge;
  f.engines[0].holdStop=new Promise(resolve=>{acknowledge=resolve;});
  const stopped=f.ui.stopNotes();f.ui.press('after-stop',f.entries[0]);await flush();await flush();
  assert.equal((await f.engines[0].read()).voices.length,1);
  acknowledge();await stopped;assert.equal(f.ui.getNotes().length,1,'the old empty snapshot never steals the new owner');
  f.ui.release('after-stop');await flush();assert.equal((await f.engines[0].read()).voices.length,0);
});

test('a rejected latest edit rolls back to the applied patch when intermediate drafts were coalesced',async()=>{
  const f=appFixture();await f.ui.ensureAudio();
  const skipped=createDefaultPreset();skipped.voice.waveform='pulse';
  const rejected=createDefaultPreset();rejected.voice.waveform='noise';
  f.engines[0].rejectPatch=true;const first=f.ui.applyPreset(skipped),latest=f.ui.applyPreset(rejected);
  await first;await assert.rejects(latest,/Tuning/);
  assert.equal(f.ui.getPreset().voice.waveform,'saw');assert.equal((await f.engines[0].read()).preset.voice.waveform,'saw');
});

test('same-tick topology changes retain mandatory reset even when the final topology matches hardware',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.ui.press('held',f.entries[0]);await flush();await flush();f.ui.setPitch(1);await flush();
  const on=createDefaultPreset();on.modulation.sync=true;const off=createDefaultPreset();
  const first=f.ui.applyPreset(on),last=f.ui.applyPreset(off);await first;await last;
  const state=await f.engines[0].read();assert.equal(state.voices.length,0);assert.equal(state.pitch,0);assert.equal(f.ui.getNotes().length,0);
  assert.equal(f.doc.getElementById('pitchBend').value,'0');assert.equal(f.doc.getElementById('keyboardPitchBend').value,'0');
});

test('same-topology preset load followed by an edit inherits reset, then ordinary live edits preserve notes',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.ui.press('held',f.entries[0]);await flush();await flush();
  const loaded=createDefaultPreset();loaded.name='Loaded same topology';const edited=readPreset(loaded);edited.filter.cutoff=1000;
  const first=f.ui.applyPreset(loaded,{load:true}),last=f.ui.applyPreset(edited);await first;await last;
  const resetState=await f.engines[0].read();assert.equal(resetState.voices.length,0);assert.equal(resetState.preset.name,loaded.name);assert.equal(resetState.preset.filter.cutoff,1000);
  f.ui.press('new',f.entries[1]);await flush();await flush();const live=readPreset(edited);live.modulation.ratio=2;await f.ui.applyPreset(live);
  assert.equal((await f.engines[0].read()).voices.length,1,'ratio is live, not a topology reset');assert.equal(f.ui.getNotes().length,1);
});

test('successive rejected pitch drafts restore the last acknowledged value, with held keys releasable',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.entries[0].midi=106;f.ui.press('button:a',f.entries[0]);await flush();await flush();
  f.engines[0].rejectPositivePitch=true;f.ui.setPitch(1);f.ui.setPitch(2);
  const key=f.doc.getElementById('keyboard').querySelectorAll('.key').find(node=>node.dataset.key==='a');assert.equal(key.disabled,false,'optimistic bounds cannot disable a held key');
  await flush();await flush();assert.equal((await f.engines[0].read()).pitch,0);assert.equal(f.doc.getElementById('pitchBend').value,'0');assert.equal(f.doc.getElementById('keyboardPitchBend').value,'0');
  assert.equal(f.ui.getNotes().length,1);f.ui.release('button:a');await flush();assert.equal((await f.engines[0].read()).voices.length,0);
});

test('a rejected live ratio never disables a held key or loses its original note',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.entries[0].midi=83;const pair=createDefaultPreset();pair.modulation.sync=true;await f.ui.applyPreset(pair);
  f.ui.press('button:a',f.entries[0]);await flush();await flush();f.engines[0].rejectPatch=true;
  const invalidAtPitch=readPreset(pair);invalidAtPitch.modulation.ratio=8;const rejected=f.ui.applyPreset(invalidAtPitch);
  const key=f.doc.getElementById('keyboard').querySelectorAll('.key').find(node=>node.dataset.key==='a');assert.equal(key.disabled,false);
  await assert.rejects(rejected,/Tuning/);assert.equal((await f.engines[0].read()).voices.length,1);assert.equal(f.ui.getNotes().length,1);
  f.ui.release('button:a');await flush();assert.equal((await f.engines[0].read()).voices.length,0);
});

test('a reset ACK does not overwrite a newer pitch request queued behind it',async()=>{
  const f=appFixture();await f.ui.ensureAudio();let release;f.engines[0].holdNext=new Promise(resolve=>{release=resolve;});
  const loaded=createDefaultPreset();loaded.name='Reset';const reset=f.ui.applyPreset(loaded,{load:true});await flush();f.ui.setPitch(1);release();await reset;await flush();await flush();
  assert.equal((await f.engines[0].read()).pitch,1);assert.equal(f.doc.getElementById('pitchBend').value,'1');assert.equal(f.doc.getElementById('keyboardPitchBend').value,'1');
});
