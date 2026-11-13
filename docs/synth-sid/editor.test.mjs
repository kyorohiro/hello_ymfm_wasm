import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createEditor} from './editor.js';
import {createDefaultPreset,readPreset,presetToCode} from './preset.js';
import {createChannelSettings,readChannelSettings,selectedChannelPreset,selectChannelTarget,selectKeyboardMode,applyChannelPreset,editChannelPreset,channelPlaybackPlan,channelSettingsToCode} from './channel_settings.js';
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

test('editable performance observations emit touched fields and packed-bit masks while locked observations stay read-only',async t=>{
  const edits=[],f=editorFixture(t,{onLiveChange:(patch,voice,masks)=>edits.push({patch,voice,masks})}),saved=f.editor.getPreset();
  const registers=new Array(32).fill(0);registers[7]=45;registers[8]=12;registers[11]=0x43;registers[12]=0x98;registers[13]=0x76;registers[23]=0x92;registers[24]=0x18;
  const observation=readSidLiveVoice({model:'6581',clockHz:985248,sampleRate:48000,positionFrames:100,registers,voices:[{envelope:0},{envelope:90},{envelope:0}]},1);
  f.editor.observe(observation,{active:true,editable:true});
  assert.equal(find(f.root,'attack').disabled,false);assert.equal(choice(f.root,'sidModel','6581').disabled,true);
  await step(f.root,'attack',1).fire('click');assert.deepEqual(edits.at(-1),{patch:{voice:{attack:10}},voice:1,masks:{}});
  const cutoff=find(f.root,'filterCutoffRange');cutoff.value='876';await cutoff.fire('input');assert.deepEqual(edits.at(-1),{patch:{filter:{cutoff:876}},voice:1,masks:{}});
  const dry=structuredClone(observation);dry.filter.routed=false;f.editor.observe(dry,{active:true,editable:true});
  await find(f.root,'filterBandpass').fire('click');assert.deepEqual(edits.at(-1),{patch:{filter:{enabled:true,mode:'lowpass+bandpass'}},voice:1,masks:{filterModeBits:2}},'a dry selected CH preserves the shared LP output used by another CH');
  await choice(f.root,'waveform','triangle').fire('click');assert.deepEqual(edits.at(-1),{patch:{voice:{waveform:'triangle+pulse'}},voice:1,masks:{waveformBits:1}});
  assert.deepEqual(f.editor.getPreset(),saved);assert.equal(f.changes.length,0);
  f.editor.observe(observation,{active:true});assert.equal(find(f.root,'attack').disabled,true);
  const count=edits.length;await step(f.root,'attack',1).fire('click');assert.equal(edits.length,count);
});

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
  const f=editorFixture(t),ratio=12139/9113,preset=createDefaultPreset();preset.modulation={...preset.modulation,sync:true,ratio};f.editor.update(preset);
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

function liveObservation({waveformMask=0x70,frequency=0x1200,sourceFrequency=0x2400,modeMask=5,routed=true,voice=0,sync=true,ring=true}={}){
  const registers=Array(32).fill(0),base=voice*7,source=((voice+2)%3)*7;
  registers[base]=frequency&255;registers[base+1]=frequency>>8;
  registers[base+2]=0x34;registers[base+3]=0xa;
  registers[base+4]=waveformMask|9|Number(sync)<<1|Number(ring)<<2;registers[base+5]=0x98;registers[base+6]=0x76;
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
  f.editor.observe(null);assert.equal(value.textContent,'1');assert.equal(range.dataset.unavailable,'false');assert.equal(range.disabled,true);
});

test('inactive Pulse width and ratio retain their values without accepting edits, including read-only Live observations',async t=>{
  const f=editorFixture(t),before=f.editor.getPreset(),nodes=walk(f.root);
  const field=id=>walk(f.root).find(node=>node.children.some(child=>child.id===`${id}Label`));
  const width=find(f.root,'pulseWidth'),ratio=find(f.root,'modulationRatio'),range=find(f.root,'modulationRatioRange');
  for(const id of ['pulseWidth','modulationRatio'])assert.equal(field(id).dataset.disabled,'true');
  find(f.root,'pulseWidthRange').value='1';await find(f.root,'pulseWidthRange').fire('input');
  range.value='8';await range.fire('input');await ratio.fire('keydown',{key:'End'});
  assert.deepEqual(f.editor.getPreset(),before);assert.equal(f.changes.length,0);
  f.editor.observe(liveObservation({waveformMask:0x10,sync:false,ring:false,frequency:1,sourceFrequency:65535}));
  assert.equal(width.dataset.value,String(0xa34));assert.equal(ratio.dataset.value,'65535');
  assert.equal(find(f.root,'modulationRatioLabel').textContent,'Observed frequency ratio');
  assert.match(ratio.getAttribute('aria-description'),/calculated value, not a SID register/);
  assert.match(width.getAttribute('aria-description'),/Pulse is off/);
  for(const id of ['pulseWidth','modulationRatio'])assert.equal(field(id).dataset.disabled,'true','an unused Live value remains visually inactive');
  f.editor.observe(liveObservation({waveformMask:0x10,sync:false,ring:false,frequency:2,sourceFrequency:100}));
  assert.equal(ratio.dataset.value,'50','even an inactive ratio continues to show its raw observation');
  f.editor.observe(liveObservation({waveformMask:0x40,sync:true,ring:false}));
  for(const id of ['pulseWidth','modulationRatio'])assert.equal(field(id).dataset.disabled,'false');
  assert.equal(width.disabled,true);assert.equal(ratio.disabled,true,'active Live values are still read-only');
  f.editor.observe(null);assert.equal(find(f.root,'modulationRatioLabel').textContent,'Modulator ratio');
  const playable=readPreset(before);playable.voice.waveform='pulse';playable.modulation.sync=true;f.editor.update(playable);
  assert.equal(width.disabled,false);assert.equal(ratio.disabled,false);assert.deepEqual(walk(f.root),nodes);
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
function appFixture({stall=false,desktop=false,codeStop=async()=>{}}={}){
  const ids=new Map(),doc=new Element(null,'document');doc.ownerDocument=doc;doc.activeElement=null;doc.hidden=false;doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>{if(!ids.has(id)){const node=new Element(doc);node.id=id;ids.set(id,node);}return ids.get(id);};
  for(const id of ['masterVolume','pitchBend','keyboardPitchBend'])doc.getElementById(id).value=id==='masterVolume'?'.7':'0';
  doc.getElementById('codeOutput').hidden=true;
  const modes=['waveform','spectrum'].map(mode=>{const node=new Element(doc,'button');node.dataset.visualMode=mode;node.setAttribute('aria-pressed',String(mode==='waveform'));return node;});
  const channels=['0','1','2','round-robin'].map(value=>{const node=new Element(doc,'button');node.dataset.sidLiveVoice=value;return node;});
  const keyboardModes=['retrigger','legato'].map(value=>{const node=new Element(doc,'button');node.dataset.sidKeyboardMode=value;return node;});
  doc.querySelectorAll=selector=>selector==='[data-visual-mode]'?modes:selector==='[data-sid-live-voice]'?channels:selector==='[data-sid-keyboard-mode]'?keyboardModes:[];doc.querySelector=()=>modes.find(node=>node.getAttribute('aria-pressed')==='true');
  const visualEvents=[];
  const win=new Element(doc,'window'),calls=[],engines=[],pending=[],audioOptions=[],editorUpdates=[],visual={setMode(){},setRunning(value){visualEvents.push(['running',value]);},connect(){},disconnect(){},stop(){visualEvents.push(['stop']);},wake(){},dispose(){}};
  const desktopEvents=[],code={mode:false,running:false,stops:0,dirty:0},observations=[],editorHooks={};
  const codeLive={state:{liveKind:'code',liveEnabled:true,liveVoice:0,liveActive:false,liveWaiting:false,liveState:null},
    read(){return {...this.state};},
    sync(){if(!this.hooks.isRunning())Object.assign(this.state,{liveState:null,liveActive:false,liveWaiting:false});},
    setEnabled(value){Object.assign(this.state,{liveEnabled:value,liveState:null,liveActive:false});this.hooks.onUpdate();},
    setVoice(value){this.state.liveVoice=value;this.hooks.onUpdate();},
    emit(value){Object.assign(this.state,value);this.hooks.onUpdate();},dispose(){this.disposed=true;}};
  if(desktop){win.top=win;win.location={protocol:'tauri:',hostname:'localhost'};win.__TAURI_INTERNALS__={};win.dispatchEvent=event=>{desktopEvents.push(event.type);return true;};}
  let isStalled=stall,engineCount=0;
  const makeEngine=model=>{
    let settings=createChannelSettings(createDefaultPreset({model})),value=selectedChannelPreset(settings),pitch=0,voices=new Map(),cursor=0;const engine={id:++engineCount,context:{},outputNode:{},sampleRate:48000,disposed:false,holdNext:null,reads:0,ownerEpoch:0,
      captureSoundEditGuard(){const epoch=this.ownerEpoch;return()=>this.ownerEpoch===epoch&&!this.disposed;},
      async resume(){},setVolume(){},async dispose(){this.disposed=true;},
      async read(){engine.reads++;return{preset:readPreset(value),channelSettings:readChannelSettings(settings),pitch,capacity:channelPlaybackPlan(settings).channels.length,voices:[...voices.values()]};},
      async command(method,args=[]){calls.push([engine.id,method,...args]);
        if(method==='noteOn'){
          const plan=channelPlaybackPlan(settings),keepHeld=settings.target!=='round-robin'&&settings.keyboardMode==='legato';
          if(!keepHeld&&voices.size>=plan.channels.length)voices.delete(voices.keys().next().value);
          voices.set(args[0],{id:args[0],midi:args[1],channel:plan.channels[cursor++%plan.channels.length]});return{};
        }
        if(method==='noteOff'){const released=voices.delete(args[0]);if(engine.holdNoteOff)await engine.holdNoteOff;return released;}
        if(method==='stop'){voices.clear();pitch=0;cursor=0;const state=await engine.read();if(engine.holdStop)await engine.holdStop;return state;}
        if(method==='setPitch'){if(engine.rejectPositivePitch&&args[0]>0)throw new Error('Pitch outside SID range');pitch=args[0];return engine.read();}
        if(method==='loadChannelSettings'||method==='setChannelSettings'){
          const nextSettings=readChannelSettings(args[0]),next=selectedChannelPreset(nextSettings);if(next.model!==value.model){voices.clear();pitch=0;}
          if(engine.rejectPatch){engine.rejectPatch=false;throw new Error('Tuning outside SID range');}
          const previous=value,previousTarget=settings.target,previousMode=settings.keyboardMode;settings=nextSettings;value=next;if(method==='loadChannelSettings'||previousTarget!==settings.target||previousMode!==settings.keyboardMode||previous.model!==value.model||previous.modulation.sync!==value.modulation.sync||previous.modulation.ring!==value.modulation.ring||previous.voice.test!==value.voice.test){voices.clear();pitch=0;cursor=0;}
          if(engine.holdNext){const wait=engine.holdNext;engine.holdNext=null;await wait;}
          return engine.read();
        }
      }};engines.push(engine);return engine;
  };
  const createAudio=({signal,model})=>{audioOptions.push({model});const engine=makeEngine(model);if(!isStalled)return Promise.resolve(engine);return new Promise((resolve,reject)=>{const item={resolve:()=>resolve(engine),reject,engine};pending.push(item);signal.addEventListener('abort',()=>{engine.disposed=true;reject(new DOMException('cancelled','AbortError'));},{once:true});});};
  const entries=[{key:'a',label:'A',midi:60},{key:'s',label:'S',midi:64},{key:'d',label:'D',midi:67},{key:'f',label:'F',midi:71}];
  const importState={playing:false,starting:false,paused:false,pausing:false,resuming:false,liveEnabled:true,liveVoice:0,manualReady:false},importCalls=[],manualCalls=[],manualOwners=new Map();
  const importer={state:importState,calls:importCalls,manualCalls,read:()=>({...importState}),setVolume(){},dispose:async()=>{},
    async manualEdit(...args){manualCalls.push(['manualEdit',...args]);return importState.liveState;},
    async manualNoteOn(id,channel,midi,pitch){manualCalls.push(['manualNoteOn',id,channel,midi,pitch]);manualOwners.set(id,{id,channel,midi,gateOwned:true,pitchOwned:true});importState.liveState={...importState.liveState,manualVoices:[...manualOwners.values()]};importer.hooks.onUpdate(importer.read());return importState.liveState;},
    async manualNoteOff(id){manualCalls.push(['manualNoteOff',id]);manualOwners.delete(id);importState.liveState={...importState.liveState,manualVoices:[...manualOwners.values()]};importer.hooks.onUpdate(importer.read());return importState.liveState;},
    async manualPitch(value){manualCalls.push(['manualPitch',value]);return importState.liveState;},
    async manualRelease(){manualCalls.push(['manualRelease']);manualOwners.clear();return importState.liveState;},
    setLiveVoice(voice){importState.liveVoice=voice;importer.hooks.onUpdate(importer.read());},
    setLiveEnabled(value){importState.liveEnabled=value;importer.hooks.onUpdate(importer.read());},
    async stop(options){importCalls.push(options);importState.playing=false;importState.starting=false;importState.paused=false;importState.pausing=false;importState.resuming=false;if(importer.holdStop)await importer.holdStop;}};
  const context=vm.createContext({document:doc,window:win,createAudio,createDefaultPreset,readPreset,presetToCode,createChannelSettings,readChannelSettings,selectedChannelPreset,selectChannelTarget,selectKeyboardMode,applyChannelPreset,editChannelPreset,channelPlaybackPlan,channelSettingsToCode,captureSidVoices,
    setupSidCodeHost:hooks=>{code.hooks=hooks;code.activity=hooks.onActivity;return{ready:Promise.resolve(),isCodeMode:()=>code.mode,isRunning:()=>code.running,
      async stop(){code.running=false;code.stops++;code.activity();await codeStop();},markSoundDirty(){code.dirty++;},async dispose(){code.running=false;}};},
    createSidCodeLive:hooks=>{codeLive.hooks=hooks;return codeLive;},
    createEditor:hooks=>{Object.assign(editorHooks,hooks);return{update(value){editorUpdates.push(readPreset(value));},observe(value,options){observations.push({value,active:options?.active,editable:options?.editable});},dispose(){}};},
    createSidImport:hooks=>{importer.hooks={...hooks,onUpdate(state){Object.assign(importState,{playing:false,starting:false,paused:false,pausing:false,resuming:false,manualReady:false},state);hooks.onUpdate({...importState});}};return importer;},createSidImportPanel:hooks=>{importer.panelHooks=hooks;return{update(){},dispose(){}};},createSidLiveView:()=>({update(state){return state.liveState?readSidLiveVoice(state.liveState,state.liveVoice??0):null;},dispose(){}}),
    createSpuOutputVisualizer:()=>visual,createFretboardState:()=>({}),createFretboardLayout:()=>({entries,rowDefs:[]}),renderFretboardControls(){},
    buildKeyboard({root,layoutEntries}){root.children=[];for(const entry of layoutEntries){const node=new Element(doc,'button');node.className='key';node.dataset.key=entry.key;root.append(node);}},
    setInstrument(){},setFretPosition(){},setStringWindowIndex(){},midiToNoteName:midi=>`note${midi}`,AbortController,DOMException,Event,ResizeObserver:class{observe(){}disconnect(){}},navigator:{clipboard:{writeText:async()=>{}}},setTimeout,clearTimeout,URL,Blob,JSON,console});
  vm.runInContext(appSource+'\nglobalThis.testUi={ensureAudio,stopNotes,applyPreset,applySettings,chooseChannel,chooseKeyboardMode,press,release,setPitch,updateKeys,getPreset:()=>preset,getSettings:()=>channelSettings,getNotes:()=>[...notes.values()],getAudio:()=>audio};',context);
  return{ui:context.testUi,doc,window:win,calls,engines,pending,audioOptions,editorUpdates,entries,importer,visualEvents,desktopEvents,code,codeLive,observations,editorHooks,bridge:win.tetoricaSynthAudio,unstall(){isStalled=false;}};
}

test('Code Live selects only an observed physical channel and never adopts its raw settings into the authored sound',async()=>{
  const f=appFixture();await f.ui.ensureAudio();const before=readChannelSettings(f.ui.getSettings()),writes=f.calls.length,dirty=f.code.dirty;
  f.code.mode=true;f.code.running=true;f.code.activity();
  const raw={model:'6581',clockHz:985248,sampleRate:48000,positionFrames:128,registers:new Array(32).fill(0),voices:[{envelope:80},{envelope:90},{envelope:100}]};
  raw.registers[4]=0x41;raw.registers[6]=0xf2;raw.registers[2]=37;raw.registers[11]=0x11;raw.registers[9]=86;
  f.codeLive.emit({liveState:raw,liveActive:true,liveWaiting:false});
  assert.equal(f.observations.at(-1).value.pulseWidth,37);assert.equal(f.observations.at(-1).active,true);
  assert.equal(f.doc.getElementById('sidLiveEnabledLabel').textContent,'Live from Code');
  assert.equal(f.doc.getElementById('sidLiveChannelLabel').textContent,'Code view');
  await f.ui.chooseChannel(1);assert.equal(f.observations.at(-1).value.pulseWidth,86);
  assert.deepEqual(readChannelSettings(f.ui.getSettings()),before);assert.equal(f.calls.length,writes);assert.equal(f.code.dirty,dirty);assert.equal(f.code.stops,0);
  assert.equal(f.importer.panelHooks.onLiveChange(false),true);assert.equal(f.observations.at(-1).active,false);assert.equal(f.code.running,true);
  assert.equal(f.importer.state.liveEnabled,true,'Code checkbox does not change the song Auto preference');
  f.code.running=false;f.code.activity();assert.equal(f.doc.getElementById('sidLiveEnabledLabel').textContent,'Auto update from song');
  assert.equal(f.doc.getElementById('sidLiveChannelLabel').textContent,'Edit & play');assert.equal(f.observations.at(-1).active,false);
  assert.deepEqual(readChannelSettings(f.ui.getSettings()),before);assert.equal(f.importer.panelHooks.onLiveChange(true),false);
});

test('Code mode keeps typing out of the keyboard allocator and background blur leaves its program running',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.code.mode=true;f.code.running=true;f.ui.updateKeys();
  const before=f.calls.length;f.ui.press('code-typing',f.entries[0]);await flush();
  assert.equal(f.ui.getNotes().length,0);assert.equal(f.calls.length,before);
  assert.equal(f.doc.getElementById('pitchBend').disabled,true);assert.equal(f.doc.getElementById('keyboardPitchBend').disabled,true);
  await f.window.fire('blur');f.doc.hidden=true;await f.doc.fire('visibilitychange');await flush();
  assert.equal(f.code.running,true);assert(f.calls.slice(before).every(call=>call[1]==='releaseKeyboard'),'focus cleanup only releases keyboard owners, never Code');
  f.code.mode=false;f.code.running=false;f.ui.updateKeys();assert.equal(f.doc.getElementById('pitchBend').disabled,false);
});

test('ordinary edits, sound loads and model changes preserve the running Code host',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.code.running=true;
  const live=readPreset(f.ui.getPreset());live.filter.cutoff++;
  await f.ui.applyPreset(live);assert.equal(f.code.stops,0);assert.equal(f.ui.getPreset().filter.cutoff,live.filter.cutoff);
  const before=f.calls.length,next=readPreset(live);next.model='8580';const changing=f.ui.applyPreset(next);
  await changing;assert.equal(f.code.stops,0);assert.equal(f.calls.length,before+1);assert.equal(f.ui.getPreset().model,'8580');assert.equal(f.code.running,true);
  await f.ui.applyPreset({...next,name:'Loaded while running'},{load:true});assert.equal(f.code.running,true);assert.equal(f.code.stops,0);
});

test('a rejected or cancelled Code-time topology selection preserves the held keyboard identity for its later key-up',async()=>{
  for(const fail of ['reject','cancel']){
    const f=appFixture();await f.ui.ensureAudio();f.code.running=true;
    f.ui.press('held-before-load',f.entries[0]);await flush();await flush();
    const id=f.ui.getNotes()[0].id;assert(f.ui.getNotes()[0].started);
    const next=readChannelSettings(f.ui.getSettings());next.channels[0].voice.test=true;let current=true;
    if(fail==='reject'){
      f.engines[0].rejectPatch=true;await assert.rejects(f.ui.applySettings(next,{load:true}));
    }else{
      const changing=f.ui.applySettings(next,{load:true,isCurrent:()=>current});current=false;assert.equal(await changing,false);
    }
    assert.equal(f.ui.getNotes()[0]?.id,id,'failed/cancelled candidate keeps the release identity');
    f.ui.release('held-before-load');await flush();await flush();
    assert.equal(f.ui.getNotes().length,0);assert(f.calls.some(call=>call[1]==='noteOff'&&call[2]===id));
    assert.equal(f.code.running,true);assert.equal(f.code.stops,0);
  }
});

test('a queued sound intent cannot enter a newer Run and reconciles the actual author bank instead of leaving an unapplied draft',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.code.running=true;
  let release;const engine=f.engines[0],gate=new Promise(resolve=>release=resolve);engine.holdNext=gate;
  const first=readPreset(f.ui.getPreset());first.filter.cutoff=711;const older=f.ui.applyPreset(first);await flush();
  const next=readPreset(first);next.name='Must not reach next Run';next.voice.waveform='pulse';const pending=f.ui.applyPreset(next,{load:true});
  engine.ownerEpoch++;release();await older;assert.equal(await pending,false);
  assert.equal(f.code.stops,0);assert(f.code.running);assert.equal(f.ui.getPreset().name,first.name);assert.equal(f.ui.getPreset().filter.cutoff,711);
  assert(!f.calls.some(call=>call[1]==='loadChannelSettings'&&call[2]?.channels[0].name===next.name));
});

test('an ACK after ownership changes reconciles committed settings without marking a stale selection successful',async()=>{
  const f=appFixture();await f.ui.ensureAudio();f.code.running=true;
  let release;const engine=f.engines[0],gate=new Promise(resolve=>release=resolve);engine.holdNext=gate;
  const next=readPreset(f.ui.getPreset());next.name='Committed before Stop';next.voice.waveform='pulse';
  const pending=f.ui.applyPreset(next,{load:true});await flush();engine.ownerEpoch++;release();assert.equal(await pending,false);
  assert.equal(f.ui.getPreset().name,next.name);assert.equal(f.ui.getPreset().voice.waveform,'pulse');assert(f.code.running);assert.equal(f.code.stops,0);
});

test('song preview waits for Code retirement before taking the monitor and desktop output',async()=>{
  let retire;const f=appFixture({desktop:true,codeStop:()=>new Promise(resolve=>{retire=resolve;})});await f.ui.ensureAudio();f.code.running=true;
  const previous=f.bridge.getOutput(),preview={context:{state:'running'},outputNode:{name:'song-output'}};
  const starting=f.importer.hooks.onPreviewStart(preview);await flush();
  assert.equal(f.code.stops,1);assert.equal(f.bridge.getOutput().context,previous.context);
  retire();await starting;assert.equal(f.bridge.getOutput().context,preview.context);assert.equal(f.code.running,false);
});

test('desktop bridge is absent on normal sites, lazy on desktop and awaits output routing before Note On',async()=>{
  assert.equal(appFixture().bridge,undefined);
  const f=appFixture({desktop:true});assert.deepEqual(f.desktopEvents,['tetorica-synth-ready']);
  assert.equal(f.audioOptions.length,0);assert.equal(f.bridge.getOutput(),null);assert(Object.isFrozen(f.bridge));
  const routes=[];let complete;
  f.bridge.setOutputHandler((output,{isCurrent})=>{routes.push({output,isCurrent});return new Promise(resolve=>{complete=resolve;});});
  const output=await f.bridge.ensureReady();assert.equal(routes.length,0,'explicit output selection must not recurse into the routing callback');
  assert.equal(output.context,f.engines[0].context);assert.equal(output.output,f.engines[0].outputNode);
  f.ui.press('desktop-key',f.entries[0]);await flush();await flush();
  assert.equal(routes.length,1);assert.equal(routes[0].isCurrent(),true);assert.equal(f.calls.some(call=>call[1]==='noteOn'),false);
  complete();await flush();await flush();assert.equal(f.calls.filter(call=>call[1]==='noteOn').length,1);
  await f.bridge.stopPlayback();assert.equal(f.ui.getNotes().length,0);assert.equal((await f.engines[0].read()).pitch,0);
  assert.throws(()=>f.bridge.setOutputHandler({}),/function or null/);f.bridge.setOutputHandler(null);
});

test('Stop fences a delayed desktop route and output switching blocks new keyboard gestures',async()=>{
  const f=appFixture({desktop:true});let complete,current;
  f.bridge.setSwitching(true);f.ui.press('blocked',f.entries[0]);assert.equal(f.audioOptions.length,0);assert.equal(f.ui.getNotes().length,0);
  f.bridge.setSwitching(false);f.bridge.setOutputHandler((_,options)=>{current=options.isCurrent;return new Promise(resolve=>{complete=resolve;});});
  f.ui.press('pending-route',f.entries[0]);await flush();await flush();assert.equal(current(),true);
  const stopped=f.ui.stopNotes();assert.equal(current(),false);complete();await stopped;await flush();
  assert.equal(f.calls.some(call=>call[1]==='noteOn'),false);assert.equal(f.ui.getNotes().length,0);
});

test('desktop preview routing selects its separate graph before playback and preserves keyboard allocation',async()=>{
  const f=appFixture({desktop:true});let complete,observed;
  f.bridge.setOutputHandler((output,options)=>{observed={output,...options};return new Promise(resolve=>{complete=resolve;});});
  const preview={context:{state:'running'},outputNode:{name:'preview-master'}};let current=true;
  const starting=f.importer.hooks.onPreviewStart(preview,{isCurrent:()=>current});await flush();await flush();
  assert.equal(observed.output.context,preview.context);assert.equal(observed.isCurrent(),true);
  assert.equal((await f.bridge.ensureReady()).output,preview.outputNode);assert.equal(f.audioOptions.length,0,'preview routing must not create a keyboard engine');
  current=false;assert.equal(observed.isCurrent(),false);complete();await starting;
  f.importer.hooks.onPreviewStop(preview);assert.equal(f.bridge.getOutput(),null);
});

test('song CH keys, Pitch and touched controls reach the running player without author allocation or stopping playback',async()=>{
  const f=appFixture(),saved=readChannelSettings(f.ui.getSettings());
  f.importer.hooks.onUpdate({playing:true,manualReady:true,liveVoice:1,liveState:autoState()});await f.ui.chooseChannel(1);
  f.ui.press('pointer:1',f.entries[0]);await flush();await flush();
  const attack=f.importer.manualCalls.find(call=>call[0]==='manualNoteOn');assert(attack);assert.deepEqual(attack.slice(2),[1,60,0]);
  assert.equal(f.importer.state.playing,true);assert.equal(f.importer.calls.length,0);assert.equal(f.audioOptions.length,0);assert.equal(f.ui.getNotes().length,1);
  f.ui.setPitch(1);await flush();assert.deepEqual(f.importer.manualCalls.at(-1),['manualPitch',1]);
  await f.editorHooks.onLiveChange({voice:{attack:9}},1,{});assert.deepEqual(f.importer.manualCalls.at(-1),['manualEdit',1,{voice:{attack:9}},{}]);
  f.ui.release('pointer:1');await flush();assert.deepEqual(f.importer.manualCalls.at(-1),['manualNoteOff',attack[1]]);
  assert.deepEqual(readChannelSettings(f.ui.getSettings()),saved);assert.equal(f.engines.length,0);
  await f.doc.getElementById('stopAudio').fire('click');await flush();assert.equal(f.importer.calls.length,1,'global Stop still retires the song');assert.equal(f.ui.getNotes().length,0);
});

test('song transport transitions reject keys and a paused CH auditions its frozen sound without moving the song',async()=>{
  for(const mode of ['starting','pausing','resuming']){
    const f=appFixture();f.importer.hooks.onUpdate({[mode]:true,paused:mode==='resuming',manualReady:false});
    f.ui.press('transition',f.entries[0]);await flush();assert.equal(f.importer.state[mode],true);assert.equal(f.engines.length,0);assert.equal(f.ui.getNotes().length,0);assert.equal(f.importer.calls.length,0);
  }
  const f=appFixture(),saved=readChannelSettings(f.ui.getSettings()),frozen=autoState();
  f.importer.hooks.onUpdate({paused:true,liveVoice:0,liveState:frozen});
  f.ui.press('paused',f.entries[0]);await flush();await flush();
  assert.equal(f.importer.state.paused,true);assert.equal(f.importer.calls.length,0);assert.equal(f.engines.length,1);
  const audition=await f.engines[0].read();assert.equal(audition.preset.voice.waveform,'pulse');assert.equal(audition.voices.length,1);
  assert.deepEqual(readChannelSettings(f.ui.getSettings()),saved,'temporary audition never becomes the author preset');assert.deepEqual(f.importer.state.liveState,frozen);
  f.ui.release('paused');await flush();await flush();assert.equal((await f.engines[0].read()).voices.length,0);
  await f.ui.stopNotes();assert.deepEqual((await f.engines[0].read()).channelSettings,saved);assert.equal(f.importer.state.paused,true);
  const empty=appFixture();empty.importer.hooks.onUpdate({paused:true,liveVoice:0,liveState:null});
  assert.doesNotThrow(()=>empty.ui.press('empty',empty.entries[0]));assert.equal(empty.ui.getNotes().length,0);assert.equal(empty.engines.length,0);
});

test('later song ownership removes stale key indicators and an author read cannot remove a live player owner',async()=>{
  const f=appFixture();await f.ui.ensureAudio();
  f.importer.hooks.onUpdate({playing:true,manualReady:true,liveVoice:0,liveState:autoState()});
  f.ui.press('song',f.entries[0]);await flush();await flush();assert.equal(f.ui.getNotes().length,1);
  const edited=readPreset(f.ui.getPreset());edited.voice.attack++;
  await f.ui.applyPreset(edited);assert.equal(f.ui.getNotes().length,1,'an author state read ignores player-owned IDs');
  const source={...f.importer.state.liveState,manualVoices:[]};f.importer.hooks.onUpdate({...f.importer.read(),liveState:source});
  assert.equal(f.ui.getNotes().length,0,'a later source write retires the keyboard indicator');
  const releases=f.importer.manualCalls.filter(call=>call[0]==='manualNoteOff').length;
  f.ui.release('song');await flush();assert.equal(f.importer.manualCalls.filter(call=>call[0]==='manualNoteOff').length,releases,'old key-up does not issue a new physical release');
});

test('Resume retires temporary paused audition and restores the complete authored bank without stopping the song',async()=>{
  const f=appFixture(),saved=readChannelSettings(f.ui.getSettings());
  f.importer.hooks.onUpdate({paused:true,liveVoice:0,liveState:autoState()});
  f.ui.press('paused',f.entries[0]);await flush();await flush();assert.equal((await f.engines[0].read()).voices.length,1);
  f.importer.hooks.onUpdate({...f.importer.read(),paused:false,resuming:true});await flush();await flush();
  assert.equal(f.ui.getNotes().length,0);assert.equal((await f.engines[0].read()).voices.length,0);assert.deepEqual((await f.engines[0].read()).channelSettings,saved);
  f.importer.hooks.onUpdate({...f.importer.read(),resuming:false,playing:true,manualReady:true});
  f.ui.release('paused');await flush();assert.equal(f.importer.calls.length,0);assert.equal(f.importer.state.playing,true);assert.deepEqual(readChannelSettings(f.ui.getSettings()),saved);
});

test('Resume before a paused audition startup completes cannot start a temporary note or replace authored settings',async()=>{
  const f=appFixture({stall:true}),saved=readChannelSettings(f.ui.getSettings()),preview={context:{state:'running'},outputNode:{}};
  await f.importer.hooks.onPreviewStart(preview,{isCurrent:()=>true});
  f.importer.hooks.onUpdate({paused:true,liveVoice:0,liveState:autoState()});
  f.ui.press('pending-paused',f.entries[0]);await flush();assert.equal(f.pending.length,1);assert.equal(f.calls.some(call=>call[1]==='noteOn'),false);
  f.importer.hooks.onUpdate({...f.importer.read(),paused:true,resuming:true});
  f.pending[0].resolve();await flush();await flush();await flush();
  assert.equal(f.calls.some(call=>call[1]==='noteOn'),false);assert.deepEqual((await f.engines[0].read()).channelSettings,saved);
  assert.deepEqual(readChannelSettings(f.ui.getSettings()),saved);assert.equal(f.importer.calls.length,0);assert.equal(f.importer.state.resuming,true);
  assert.equal(f.ui.getNotes().length,0,'a cancelled startup must clear its pending key indicator');
  f.ui.release('pending-paused');await flush();assert.equal(f.calls.some(call=>call[1]==='noteOff'),false);
});

test('closing the preview preserves a held Synth Round robin key and its later release',async()=>{
  const f=appFixture(),preview={context:{state:'running'},outputNode:{}};
  await f.importer.hooks.onPreviewStart(preview,{isCurrent:()=>true});
  f.importer.hooks.onUpdate({playing:true,manualReady:true,liveVoice:0,liveState:autoState()});await f.ui.chooseChannel('round-robin');
  f.ui.press('author',f.entries[0]);await flush();await flush();assert.equal(f.ui.getNotes().length,1);
  f.importer.state.playing=false;f.importer.hooks.onPreviewStop(preview);
  assert.equal(f.ui.getNotes().length,1,'preview closure only retires player-owned keys');assert.equal((await f.engines[0].read()).voices.length,1);
  f.ui.release('author');await flush();await flush();assert.equal((await f.engines[0].read()).voices.length,0);
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
  assert.equal(f.doc.getElementById('sidLiveView').hidden,false,'Live Off freezes the selected song CH instead of changing the target');
  assert.match(f.doc.getElementById('voiceHeading').textContent,/Frozen CH 3/);
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

test('software keyboard mode is available on fixed channels, keeps its choice in Round robin and never starts audio',async()=>{
  const f=appFixture(),button=mode=>f.doc.querySelectorAll('[data-sid-keyboard-mode]').find(node=>node.dataset.sidKeyboardMode===mode);
  assert.equal(button('retrigger').getAttribute('aria-pressed'),'true');assert.equal(button('legato').disabled,true);
  await button('legato').fire('click');assert.equal(f.ui.getSettings().keyboardMode,'retrigger');
  await f.ui.chooseChannel(0);const patches=f.ui.getSettings().channels;
  button('legato').focus();await button('legato').fire('click');await flush();
  assert.equal(f.ui.getSettings().keyboardMode,'legato');assert.deepEqual(f.ui.getSettings().channels,patches);assert.equal(f.doc.activeElement,null);
  await f.ui.chooseChannel('round-robin');assert.equal(button('legato').disabled,true);assert.equal(button('legato').getAttribute('aria-pressed'),'true');
  await f.ui.chooseKeyboardMode('retrigger');assert.equal(f.ui.getSettings().keyboardMode,'legato','disabled Round robin controls retain the fixed-CH choice');
  await f.ui.chooseChannel(2);assert.equal(button('legato').disabled,false);assert.equal(button('legato').getAttribute('aria-pressed'),'true');
  f.importer.hooks.onUpdate({playing:true,liveEnabled:true,liveVoice:2});
  assert.equal(button('retrigger').disabled,false,'the performance setting remains available while Auto displays read-only sound controls');
  await button('retrigger').fire('click');await flush();assert.equal(f.ui.getSettings().keyboardMode,'retrigger');assert.equal(f.engines.length,0);
});

test('changing keyboard mode resets held ownership and Pitch without losing channel settings',async()=>{
  const f=appFixture();await f.ui.chooseChannel(1);await f.ui.ensureAudio();
  f.ui.press('old',f.entries[0]);await flush();await flush();f.ui.setPitch(1);await flush();
  const patches=f.ui.getSettings().channels;await f.ui.chooseKeyboardMode('legato');
  assert.deepEqual(f.ui.getSettings().channels,patches);assert.equal(f.ui.getNotes().length,0);assert.equal((await f.engines[0].read()).voices.length,0);
  assert.equal((await f.engines[0].read()).pitch,0);for(const id of ['pitchBend','keyboardPitchBend'])assert.equal(f.doc.getElementById(id).value,'0');
  assert.equal(f.calls.at(-1)[1],'loadChannelSettings');
  f.ui.press('new',f.entries[1]);await flush();await flush();f.ui.release('old');await flush();
  assert.equal((await f.engines[0].read()).voices.length,1,'an old mode key release cannot remove a new owner');
  f.ui.release('new');await flush();await flush();assert.equal((await f.engines[0].read()).voices.length,0);
});

test('Legato keeps all held key indicators, reads the acknowledged release and reports the returning note',async()=>{
  const f=appFixture();await f.ui.chooseChannel(1);await f.ui.chooseKeyboardMode('legato');await f.ui.ensureAudio();
  f.ui.press('first',f.entries[0]);await flush();await flush();f.ui.press('second',f.entries[1]);await flush();await flush();
  assert.equal(f.ui.getNotes().length,2);assert.equal((await f.engines[0].read()).voices.length,2);
  assert.match(f.doc.getElementById('audioStatus').textContent,/note64.*Legato.*2 keys held.*1 voice/);
  assert.match(f.doc.getElementById('voiceCapacity').textContent,/Legato.*2 keys held/);
  const reads=f.engines[0].reads;f.ui.release('second');await flush();await flush();
  assert(f.engines[0].reads>reads,'a release must consume current endpoint ownership, including a returned held key');
  assert.equal(f.ui.getNotes().length,1);assert.equal(f.ui.getNotes()[0].midi,60);assert.match(f.doc.getElementById('audioStatus').textContent,/note60.*Legato.*1 key held/);
  const keys=f.doc.getElementById('keyboard').querySelectorAll('.key');assert.equal(keys.find(node=>node.dataset.key==='a').getAttribute('aria-pressed'),'true');assert.equal(keys.find(node=>node.dataset.key==='s').getAttribute('aria-pressed'),'false');
  f.ui.release('first');await flush();await flush();assert.equal(f.ui.getNotes().length,0);assert.match(f.doc.getElementById('audioStatus').textContent,/Legato.*0 keys held/);
});

test('a delayed Legato release cannot erase a key created after a keyboard mode change',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);await f.ui.chooseKeyboardMode('legato');await f.ui.ensureAudio();
  f.ui.press('old',f.entries[0]);await flush();await flush();let finish;
  f.engines[0].holdNoteOff=new Promise(resolve=>{finish=resolve;});f.ui.release('old');await flush();
  const changing=f.ui.chooseKeyboardMode('retrigger');f.ui.press('new',f.entries[1]);
  finish();await changing;await flush();await flush();
  assert.equal(f.ui.getNotes().length,1);assert.equal(f.ui.getNotes()[0].midi,64);assert.equal((await f.engines[0].read()).voices.length,1);
  f.engines[0].holdNoteOff=null;f.ui.release('new');await flush();await flush();assert.equal((await f.engines[0].read()).voices.length,0);
});

test('voice loads and Auto preserve keyboard mode while channel setup files restore it or migrate an old setup',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);await f.ui.chooseKeyboardMode('legato');
  const voice=readPreset(f.ui.getPreset());voice.voice.waveform='triangle';await f.ui.applyPreset(voice,{load:true});assert.equal(f.ui.getSettings().keyboardMode,'legato');
  f.importer.hooks.onUpdate({playing:true,liveEnabled:true,liveActive:true,liveVoice:0,liveState:autoState(),liveSource:{name:'Auto source',subtune:1}});
  assert.equal(f.ui.getPreset().voice.waveform,'triangle','song observation does not replace the authored voice');assert.equal(f.ui.getSettings().keyboardMode,'legato');
  const setup=selectKeyboardMode(selectChannelTarget(createChannelSettings(),2),'legato'),input=f.doc.getElementById('presetFileInput');
  input.files=[{size:1000,text:async()=>JSON.stringify(setup)}];await input.fire('change');assert.deepEqual(f.ui.getSettings(),setup);
  const legacy={...setup,version:1};delete legacy.keyboardMode;input.files=[{size:1000,text:async()=>JSON.stringify(legacy)}];await input.fire('change');
  assert.equal(f.ui.getSettings().version,2);assert.equal(f.ui.getSettings().keyboardMode,'retrigger');assert.equal(f.ui.getSettings().target,2);
  assert.deepEqual(f.ui.getSettings().channels,setup.channels);
});

function autoState(){
  const state=liveObservation({waveformMask:0x40});
  const registers=[...state.registers];registers[4]=0x41;
  return {model:state.model,clockHz:state.clockHz,sampleRate:state.sampleRate,positionFrames:state.positionFrames,registers};
}
test('song Live, frozen and transport observations preserve every author setting while sparse edits target the player',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);const authored=readChannelSettings(f.ui.getSettings()),liveState=autoState();
  const frame={playing:true,manualReady:true,liveEnabled:true,liveVoice:0,liveState,liveSource:{name:'Auto source',subtune:1}};
  f.importer.hooks.onUpdate({...frame,liveActive:false,liveWaiting:true});assert.deepEqual(readChannelSettings(f.ui.getSettings()),authored);
  f.importer.hooks.onUpdate({...frame,liveActive:true});assert.equal(f.observations.at(-1).value.waveformMask,0x40);assert.equal(f.observations.at(-1).editable,true);
  f.importer.hooks.onUpdate({...frame,liveEnabled:false,liveActive:false});assert.equal(f.observations.at(-1).active,true);assert.equal(f.observations.at(-1).editable,true);
  await f.editorHooks.onLiveChange({voice:{waveform:'triangle+pulse'},filter:{mode:'notch'}},0,{waveformBits:1,filterModeBits:4});
  assert.deepEqual(f.importer.manualCalls.at(-1),['manualEdit',0,{voice:{waveform:'triangle+pulse'},filter:{mode:'notch'}},{waveformBits:1,filterModeBits:4}]);
  for(const pending of [{starting:true},{loading:true},{choosingFile:true},{pausing:true},{resuming:true}]){
    f.importer.hooks.onUpdate({...frame,playing:false,paused:true,manualReady:false,liveActive:false,...pending});assert.deepEqual(readChannelSettings(f.ui.getSettings()),authored);
  }
  f.importer.hooks.onUpdate({...frame,playing:false,paused:true,manualReady:false,liveActive:false});
  assert.equal(f.observations.at(-1).editable,false,'the paused song state stays frozen');assert.deepEqual(readChannelSettings(f.ui.getSettings()),authored);assert.equal(f.engines.length,0);
});

test('song CH selection preserves authorship and Synth Round robin auditions the author alongside playback',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);const patch=readPreset(f.ui.getPreset());patch.voice.waveform='triangle';await f.ui.applyPreset(patch);
  const before=readChannelSettings(f.ui.getSettings()),liveState=autoState();
  const frame={paused:true,liveEnabled:true,liveVoice:0,liveState,liveSource:{name:'Auto source',subtune:1}};f.importer.hooks.onUpdate(frame);
  await f.ui.chooseChannel(2);assert.equal(f.importer.state.liveVoice,2);assert.deepEqual(readChannelSettings(f.ui.getSettings()),before);assert.equal(f.engines.length,0);
  await f.ui.chooseChannel('round-robin');assert.deepEqual(f.ui.getSettings().channels,before.channels);assert.equal(f.observations.at(-1).active,false);
  f.importer.hooks.onUpdate({...frame,paused:false,playing:true,manualReady:true,liveActive:true,liveState:{...liveState,positionFrames:12000}});
  assert.equal(f.observations.at(-1).active,false);assert.equal(f.doc.getElementById('sidChannelState').hidden,false);
  f.ui.press('author',f.entries[0]);await flush();await flush();assert.equal(f.engines.length,1);assert.equal(f.importer.state.playing,true);assert.equal(f.importer.calls.length,0);assert.equal(f.importer.manualCalls.some(call=>call[0]==='manualNoteOn'),false);
  f.ui.release('author');await flush();await flush();assert.equal((await f.engines[0].read()).voices.length,0);
  assert.deepEqual(f.ui.getSettings().channels,before.channels,'neither advancing playback nor author audition replaces saved channel patches');
});

test('an explicit setup file wins over Auto observations while its text is being read',async()=>{
  const f=appFixture();await f.ui.chooseChannel(0);let finish;
  const setup=selectChannelTarget(createChannelSettings(),2);setup.channels[2].voice.waveform='triangle';
  const input=f.doc.getElementById('presetFileInput');input.files=[{size:1000,text:()=>new Promise(resolve=>{finish=()=>resolve(JSON.stringify(setup));})}];
  const reading=input.fire('change');await flush();
  f.importer.hooks.onUpdate({playing:true,liveEnabled:true,liveActive:true,liveVoice:0,liveState:autoState(),liveSource:{name:'Auto source',subtune:1}});
  finish();await reading;
  assert.equal(f.ui.getSettings().target,2);assert.equal(f.ui.getPreset().voice.waveform,'triangle');
  assert.equal(f.importer.state.liveEnabled,true,'loading an author preset preserves the song follow preference');
  assert.equal(f.importer.calls.length,0,'preset loading does not stop the song');
  assert.equal(f.observations.at(-1).active,false,'explicit preset loading selects the author route');
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
