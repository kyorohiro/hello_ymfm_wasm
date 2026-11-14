// Run the actual UI keyboard dispatch with a controllable audio queue.
// Real APU last-KeyOn ownership is covered by code_keyboard.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const keyboard=source.slice(source.indexOf('function canPlay('),source.indexOf('function setPitchUi('));
const audition=source.slice(source.indexOf('function pressAudition('),source.indexOf('function captureSongVoice('));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function harness({ready=Promise.resolve(),running=true}={}){
  const notes=new Map(),vgmNotes=new Map(),auditionNotes=new Map(),calls=[],listeners=new Map(),documentListeners=new Map();
  const nodes=new Map(),doc={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,{hidden:true,addEventListener(){},blur(){}});return nodes.get(id);},addEventListener(type,fn){documentListeners.set(type,fn);}};
  const code={mode:true,running,busy:false,opens:0,openAllowed:true},engine={async command(method,args){calls.push(['command',method,structuredClone(args)]);return{};},async read(){return{};}};
  let queue=Promise.resolve(),scope;
  const songControls={noteOn(id,midi,target){calls.push(['vgmOn',id,midi,target]);return{channel:0};},noteOff(id){calls.push(['vgmOff',id]);},releaseKeyboard(){calls.push(['vgmRelease']);}};
  scope=vm.createContext({Promise,Map,Set,Number,Math,DOMException,document:doc,window:{addEventListener(type,fn){listeners.set(type,fn);}},$:id=>doc.getElementById(id),
    notes,vgmNotes,auditionNotes,codeHost:{isCodeMode:()=>code.mode,isRunning:()=>code.running,getState:()=>({busy:code.busy}),openOutput(){code.opens++;return code.openAllowed;},stop(){assert.fail('Performance never stops Code');}},
    audio:engine,switchingAudioOutput:false,disposed:false,epoch:0,sequence:0,channelTarget:1,octave:0,preset:{source:'pulse'},layout:{entries:[{key:'a',midi:60}]},
    lastSongState:null,pausedVoice:null,queue,
    isSongActive:()=>Boolean(scope.lastSongState?.playing||scope.lastSongState?.paused),isSongChannelView:()=>true,pausedSongVoice:()=>scope.pausedVoice,
    songControls,audition:{async noteOn(id,midi){calls.push(['trialOn',id,midi]);return{channel:0};},async noteOff(id){calls.push(['trialOff',id]);},stop:async()=>{}},
    enqueue(fn){const task=queue.then(fn);queue=task.catch(error=>{throw error;});scope.queue=queue;return task;},
    ensureAudio:async()=>{await ready;return engine;},updateKeys(){},updateCapacity(){},readVoices(){},status(){},report:error=>{throw error;},
    capacity:()=>4,midiToNoteName:midi=>String(midi),visualizer:{stop(){}},setPitch(){},stopAll(){assert.fail('Performance never stops the session');},renderKeyboard(){},
  });
  vm.runInContext(keyboard+'\n'+audition,scope);
  const event=(target=null,extra={})=>({key:'a',code:'KeyA',target,repeat:false,preventDefault(){this.defaultPrevented=true;},...extra});
  return{scope,code,calls,notes,vgmNotes,auditionNotes,listeners,documentListeners,doc,event,async idle(){await queue;await Promise.resolve();await queue;}};
}
const control=selector=>{const node={closest:query=>query.split(',').includes(selector)?node:null,matches:()=>false};return node;};

test('idle and running Code views accept selected-channel notes and text-field key-up releases only the hand owner',async()=>{
  for(const running of [false,true]){
    const h=harness({running}),down=h.event();h.listeners.get('keydown')(down);await h.idle();
    const note=h.notes.get('key:KeyA');assert(note?.started);assert(down.defaultPrevented);
    assert.equal(h.code.opens,running?0:1,'only completed idle Code output needs reopening');
    assert.deepEqual(h.calls.find(call=>call[1]==='noteOn'),['command','noteOn',[note.id,60,{channel:1}]]);
    const writes=h.calls.length;h.listeners.get('keydown')(h.event(null,{repeat:true}));await h.idle();assert.equal(h.calls.length,writes);
    h.listeners.get('keyup')(h.event(control('textarea')));await h.idle();
    assert.equal(h.notes.size,0);assert.deepEqual(h.calls.findLast(call=>call[0]==='command'),['command','noteOff',[note.id]]);
    assert.equal(h.code.running,running);assert.equal(h.code.mode,true);
  }
});

test('Code-view keyboard leaves editor, select, dialog, handled and modified input untouched',async()=>{
  for(const selector of ['input','select','textarea','dialog[open]','.monaco-editor','#synthCodeEditorHost','[contenteditable]:not([contenteditable="false"])']){
    const h=harness(),e=h.event(control(selector));h.listeners.get('keydown')(e);await h.idle();
    assert.equal(h.notes.size,0,selector);assert(!e.defaultPrevented,selector);assert.equal(h.calls.length,0);
  }
  for(const flag of ['ctrlKey','metaKey','altKey','defaultPrevented','isComposing']){
    const h=harness();h.listeners.get('keydown')(h.event(null,{[flag]:true}));await h.idle();assert.equal(h.notes.size,0,flag);
  }
  const h=harness();h.doc.getElementById('spuFileContextMenu').hidden=false;h.listeners.get('keydown')(h.event());await h.idle();assert.equal(h.notes.size,0);
});

test('Code transitions and quick release fence a pending manual On',async()=>{
  const busy=harness();busy.code.busy=true;busy.scope.press('key:KeyA',{key:'a',midi:60});await busy.idle();assert.equal(busy.notes.size,0);
  const gate=deferred(),h=harness({ready:gate.promise});h.scope.press('key:KeyA',{key:'a',midi:60});await Promise.resolve();
  h.scope.release('key:KeyA');gate.resolve();await h.idle();assert.equal(h.notes.size,0);assert(!h.calls.some(call=>call[1]==='noteOn'));
});

test('Code-view blur releases manual notes without stopping the running program',async()=>{
  const h=harness();h.listeners.get('keydown')(h.event());await h.idle();h.listeners.get('blur')();await h.idle();
  assert.equal(h.notes.size,0);assert(h.calls.some(call=>call[1]==='releaseKeyboard'));assert(!h.calls.some(call=>call[1]==='stop'));assert(h.code.running);
});

test('Code view remains a view while live and paused VGM keyboard routes retain their transport',async()=>{
  const h=harness({running:false});h.scope.lastSongState={playing:true,canInteract:true};
  h.listeners.get('keydown')(h.event());await h.idle();assert.equal(h.vgmNotes.size,1);assert(h.calls.some(call=>call[0]==='vgmOn'));
  h.listeners.get('keyup')(h.event());await h.idle();assert.equal(h.vgmNotes.size,0);assert(h.scope.lastSongState.playing);
  h.scope.lastSongState={paused:true};h.scope.pausedVoice={playable:true,source:'pulse'};
  h.listeners.get('keydown')(h.event());await h.idle();await Promise.resolve();assert.equal(h.auditionNotes.size,1);assert(h.calls.some(call=>call[0]==='trialOn'));
  h.listeners.get('keyup')(h.event());await h.idle();assert.equal(h.auditionNotes.size,0);assert(h.scope.lastSongState.paused);
});
