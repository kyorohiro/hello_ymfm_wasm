import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createEditor} from './editor.js';
import {createDefaultPreset,readPreset,presetToCode} from './preset.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
  constructor(doc,tag='div'){
    Object.assign(this,{ownerDocument:doc,tagName:tag,children:[],dataset:{},attributes:{},listeners:new Map(),value:'',textContent:'',disabled:false,hidden:false,checked:false});
    const classes=new Set();this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),toggle:(name,on)=>{if(on??!classes.has(name))classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)};
  }
  append(...nodes){for(const node of nodes)this.appendChild(node);}
  appendChild(node){this.children.push(node);return node;}
  setAttribute(key,value){this.attributes[key]=String(value);}
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
  await choice(f.root,'filterMode','lowpass').fire('click');
  assert.equal(f.changes.at(-1).filter.enabled,true,'choosing the already selected mode also enables filter');
  assert.equal(find(f.root,'filterEnabled').checked,true);
  find(f.root,'filterEnabled').checked=false;await find(f.root,'filterEnabled').fire('change');
  assert.equal(f.changes.at(-1).filter.enabled,false);assert.match(find(f.root,'filterHelp').textContent,/dry routing/);
  find(f.root,'voiceCard').open=false;const next=createDefaultPreset();next.voice.attack=7;f.editor.update(next);assert.equal(find(f.root,'voiceCard').open,false,'incoming state never reopens a folded card');
  f.editor.dispose();
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

test('invalid external patches keep the editor, and disposal ignores late callbacks and edits',async t=>{
  let reject;const f=editorFixture(t,{onChange:()=>new Promise((_resolve,fail)=>{reject=fail;})});
  const before=f.editor.getPreset();assert.throws(()=>f.editor.update({...before,voice:{...before.voice,attack:99}}),/attack/);assert.deepEqual(f.editor.getPreset(),before);
  await step(f.root,'decay',1).fire('click');f.editor.dispose();reject(new Error('late audio failure'));await flush();assert.equal(f.errors.length,0);
  const retained=f.editor.getPreset();await step(f.root,'decay',1).fire('click');assert.deepEqual(f.editor.getPreset(),retained);
});

const appSource=(await readFile(new URL('./synth.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from\s*['"][^'"]+['"];\n/gm,'');
function appFixture({stall=false}={}){
  const ids=new Map(),doc=new Element(null,'document');doc.ownerDocument=doc;doc.activeElement=null;doc.hidden=false;doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>{if(!ids.has(id)){const node=new Element(doc);node.id=id;ids.set(id,node);}return ids.get(id);};
  for(const id of ['masterVolume','pitchBend','keyboardPitchBend'])doc.getElementById(id).value=id==='masterVolume'?'.7':'0';
  doc.getElementById('codeOutput').hidden=true;
  const modes=['waveform','spectrum'].map(mode=>{const node=new Element(doc,'button');node.dataset.visualMode=mode;node.setAttribute('aria-pressed',String(mode==='waveform'));return node;});
  doc.querySelectorAll=selector=>selector==='[data-visual-mode]'?modes:[];doc.querySelector=()=>modes.find(node=>node.getAttribute('aria-pressed')==='true');
  const win=new Element(doc,'window'),calls=[],engines=[],pending=[],visual={setMode(){},setRunning(){},connect(){},disconnect(){},stop(){},wake(){},dispose(){}};
  let isStalled=stall,engineCount=0;
  const makeEngine=()=>{
    let value=createDefaultPreset(),pitch=0,voices=new Map();const engine={id:++engineCount,context:{},outputNode:{},sampleRate:48000,disposed:false,holdNext:null,
      async resume(){},setVolume(){},async dispose(){this.disposed=true;},
      async read(){return{preset:readPreset(value),pitch,capacity:value.modulation.sync||value.modulation.ring?1:3,voices:[...voices.values()]};},
      async command(method,args=[]){calls.push([engine.id,method,...args]);
        if(method==='noteOn'){if(voices.size>=(value.modulation.sync||value.modulation.ring?1:3))voices.delete(voices.keys().next().value);voices.set(args[0],{id:args[0],midi:args[1],channel:0});return{};}
        if(method==='noteOff')return voices.delete(args[0]);
        if(method==='stop'){voices.clear();pitch=0;const state=await engine.read();if(engine.holdStop)await engine.holdStop;return state;}
        if(method==='setPitch'){if(engine.rejectPositivePitch&&args[0]>0)throw new Error('Pitch outside SID range');pitch=args[0];return engine.read();}
        if(method==='loadPreset'||method==='setPreset'){
          if(engine.rejectPatch){engine.rejectPatch=false;throw new Error('Tuning outside SID range');}
          const previous=value;value=readPreset(args[0]);if(method==='loadPreset'||previous.modulation.sync!==value.modulation.sync||previous.modulation.ring!==value.modulation.ring||previous.voice.test!==value.voice.test){voices.clear();pitch=0;}
          if(engine.holdNext){const wait=engine.holdNext;engine.holdNext=null;await wait;}
          return engine.read();
        }
      }};engines.push(engine);return engine;
  };
  const createAudio=({signal})=>{const engine=makeEngine();if(!isStalled)return Promise.resolve(engine);return new Promise((resolve,reject)=>{const item={resolve:()=>resolve(engine),reject,engine};pending.push(item);signal.addEventListener('abort',()=>{engine.disposed=true;reject(new DOMException('cancelled','AbortError'));},{once:true});});};
  const entries=[{key:'a',label:'A',midi:60},{key:'s',label:'S',midi:64},{key:'d',label:'D',midi:67},{key:'f',label:'F',midi:71}];
  const context=vm.createContext({document:doc,window:win,createAudio,createDefaultPreset,readPreset,presetToCode,createEditor:()=>({update(){},dispose(){}}),
    createSpuOutputVisualizer:()=>visual,createFretboardState:()=>({}),createFretboardLayout:()=>({entries,rowDefs:[]}),renderFretboardControls(){},
    buildKeyboard({root,layoutEntries}){root.children=[];for(const entry of layoutEntries){const node=new Element(doc,'button');node.className='key';node.dataset.key=entry.key;root.append(node);}},
    setInstrument(){},setFretPosition(){},setStringWindowIndex(){},midiToNoteName:midi=>`note${midi}`,AbortController,DOMException,ResizeObserver:class{observe(){}disconnect(){}},navigator:{clipboard:{writeText:async()=>{}}},setTimeout,clearTimeout,URL,Blob,console});
  vm.runInContext(appSource+'\nglobalThis.testUi={ensureAudio,stopNotes,applyPreset,press,release,setPitch,getPreset:()=>preset,getNotes:()=>[...notes.values()],getAudio:()=>audio};',context);
  return{ui:context.testUi,doc,calls,engines,pending,entries,unstall(){isStalled=false;}};
}

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
