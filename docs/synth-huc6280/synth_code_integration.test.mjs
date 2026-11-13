// The application's real Code/manual dispatch and pending-key boundaries.
// No DOM, browser or audio device is constructed.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createDefaultPreset,readPreset,isWaveOnlyEdit} from './preset.js';
import {createHuc6280CodeEdit} from './code_parameter_edit.js';

const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const apply=source.slice(source.indexOf('function applyPreset('),source.indexOf('const editor = createEditor('));
const keyboard=source.slice(source.indexOf('function press('),source.indexOf("$('startAudio').addEventListener"));
const edit=source.slice(source.indexOf('async function editVisiblePreset('),source.indexOf('codeHost=setupHuc6280CodeHost('));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};

function harness({ready=Promise.resolve(),channel=2,running=true,session=1}={}){
  const calls=[],errors=[],notes=new Map();let pending=Promise.resolve(),scope;
  const engine={codeSession:session,state:{preset:createDefaultPreset(),voices:[]},
    async command(method,args=[]){calls.push(['command',method,structuredClone(args)]);return{channel};},
    async getHuc6280Client(){calls.push(['prepareClient']);if(engine.pendingPrepare)await engine.pendingPrepare;engine.codeSession=7;return{};},
    async applyCodePreset(value,options){assert(options.isCurrent());calls.push(['preset',structuredClone(value),options.replace]);engine.state.preset=readPreset(value);if(engine.pendingPreset)await engine.pendingPreset;},
    async applyCodeEdit(value,options){assert(options.isCurrent());calls.push(['edit',structuredClone(value)]);if(engine.pendingEdit)await engine.pendingEdit;return structuredClone(engine.state);},
    async read(){calls.push(['read']);return structuredClone(engine.state);},
  };
  const host={running,mode:false,phase:{busy:false,stopping:false},getState(){return this.phase;},isRunning(){return this.running;},isCodeMode(){return this.mode;},markSoundDirty(){calls.push(['dirty']);}};
  scope=vm.createContext({Promise,DOMException,Map,Set,Array,Number,JSON,structuredClone,
    audio:engine,preset:createDefaultPreset(),displayedPreset:createDefaultPreset(),revision:1,epoch:1,sequence:0,importSequence:0,pitch:1,
    codeHost:host,songControls:null,songState:null,channelTarget:channel,liveSignature:'old',disposed:false,switchingAudioOutput:false,notes,
    readPreset,isWaveOnlyEdit,createHuc6280CodeEdit,
    enqueue(action){const task=pending.then(action);pending=task.catch(error=>errors.push(error));return task;},
    ensureAudio:async()=>{await ready;return engine;},
    updatePresetUi(){calls.push(['ui']);},updateKeys(){},updateCapacity(){},readVoices(){calls.push(['voices']);},
    setPitchUi(value){scope.pitch=value;calls.push(['pitchUi',value]);},
    vgmLibrary:{clearSelection(){calls.push(['clearVgm']);}},
    visualizer:{wake(){calls.push(['wake']);},stop(){calls.push(['visualStop']);}},
    codeLive:{async refresh(){calls.push(['refresh']);}},
    status(message){calls.push(['status',message]);},report:error=>errors.push(error),
    canPlay:()=>true,capacity:()=>6,midiToNoteName:note=>String(note),
    async prepareDdaAudio(){calls.push(['prepareDda']);return{name:'unused',data:'',sampleRate:8000};},
  });
  vm.runInContext(apply+'\n'+keyboard+'\n'+edit,scope);
  return{scope,engine,host,calls,errors,notes,idle:()=>pending};
}

test('author preset/source loads keep Code running and route through its current session',async()=>{
  const h=harness(),next=createDefaultPreset();next.name='Imported Noise';next.source='noise';next.noise.frequency=9;
  assert.equal(await h.scope.applyPreset(next,{load:true}),true);
  assert.equal(h.host.running,true);assert.equal(h.engine.codeSession,1);
  assert.deepEqual(h.calls.find(call=>call[0]==='preset'),['preset',next,true]);
  assert(!h.calls.some(call=>call[0]==='command'&&['loadPreset','setPreset','stop'].includes(call[1])));
  assert.deepEqual(h.scope.preset,next);assert.equal(h.scope.pitch,0);assert(h.calls.some(call=>call[0]==='dirty'));
});

test('physical UI changes send only the selected sparse parameter and retain the returned authored checkpoint',async()=>{
  const h=harness({channel:4}),shown=createDefaultPreset();shown.volume=10;shown.wave.fill(3);h.scope.displayedPreset=shown;
  const next=readPreset(shown);next.volume=12;
  const authored=createDefaultPreset();authored.volume=12;h.engine.state.preset=authored;
  await h.scope.editVisiblePreset(next);
  assert.deepEqual(h.calls.find(call=>call[0]==='edit'),['edit',{channel:4,changes:{volume:12}}]);
  assert.deepEqual(h.scope.preset,authored,'observed foreign wave/pitch settings are not copied wholesale into the author sound');
  assert.equal(h.scope.revision,2);assert(h.calls.some(call=>call[0]==='dirty'));assert(h.calls.some(call=>call[0]==='refresh'));
  assert(!h.calls.some(call=>call[0]==='preset'||call[0]==='command'));
});

test('stale Code session or epoch retires queued edits before they reach the chip',async()=>{
  for(const fence of ['session','epoch','engine']){
    const h=harness(),next=readPreset(h.scope.displayedPreset);next.volume=9;
    const pending=h.scope.editVisiblePreset(next);
    if(fence==='session')h.engine.codeSession++;
    if(fence==='epoch')h.scope.epoch++;
    if(fence==='engine')h.scope.audio={...h.engine,codeSession:3};
    await pending;
    assert(!h.calls.some(call=>['edit','preset','command','dirty'].includes(call[0])),fence);
  }
  const h=harness(),next=createDefaultPreset();next.volume=18;
  const loading=h.scope.applyPreset(next,{load:true});h.engine.codeSession++;
  assert.equal(await loading,false);assert(!h.calls.some(call=>['preset','command','read'].includes(call[0])),'an old queued load cannot address a new Code session');
});

test('keyboard uses the selected physical CH, Code editor guards it, and a quick release cancels delayed On',async()=>{
  const h=harness({channel:3});h.scope.press('key:KeyA',{key:'a',midi:64});await h.idle();
  const note=h.notes.get('key:KeyA');assert(note);assert.deepEqual(h.calls.find(call=>call[0]==='command'&&call[1]==='noteOn'),['command','noteOn',[note.id,64,3]]);
  h.scope.release('key:KeyA');await h.idle();assert.deepEqual(h.calls.findLast(call=>call[0]==='command'),['command','noteOff',[note.id]]);
  const blocked=harness();blocked.host.mode=true;blocked.scope.press('key:KeyA',{key:'a',midi:60});await blocked.idle();assert.equal(blocked.notes.size,0);assert.equal(blocked.calls.length,0);
  const gate=deferred(),quick=harness({ready:gate.promise});quick.scope.press('key:KeyA',{key:'a',midi:60});await Promise.resolve();
  quick.scope.release('key:KeyA');gate.resolve();await quick.idle();assert.equal(quick.notes.size,0);assert(!quick.calls.some(call=>call[0]==='command'&&call[1]==='noteOn'));
});

test('physical-CH DDA replacement rejects before file decoding or current sound changes',async()=>{
  const h=harness(),before=readPreset(h.scope.preset);
  await assert.rejects(h.scope.loadDdaAudio({name:'sample.wav'},{}),/Choose Synth.*shared DDA sample/);
  assert.deepEqual(h.scope.preset,before);assert.equal(h.scope.revision,1);assert(!h.calls.some(call=>['prepareDda','preset','command'].includes(call[0])));
});

test('a delayed hand key cannot cross Code Stop, rerun, engine replacement or a newly started performance',async()=>{
  for(const transition of ['stop','session','engine','start']){
    const gate=deferred(),h=harness({ready:gate.promise,running:transition!=='start'});
    h.scope.press('key:KeyA',{key:'a',midi:60});await Promise.resolve();
    if(transition==='stop'){h.host.running=false;h.engine.codeSession=null;}
    if(transition==='session')h.engine.codeSession=2;
    if(transition==='engine')h.scope.audio={...h.engine,codeSession:2};
    if(transition==='start'){h.host.running=true;h.engine.codeSession=2;}
    gate.resolve();await h.idle();
    assert(!h.calls.some(call=>call[0]==='command'&&call[1]==='noteOn'),transition);
    h.scope.release('key:KeyA');await h.idle();
    assert(!h.calls.some(call=>call[0]==='command'&&call[1]==='noteOff'),transition+' did not acquire a gate to release');
  }
});

test('preparing/stopping Code does not accept a hand key before a physical session exists',async()=>{
  for(const phase of ['busy','stopping']){
    const h=harness({session:null});h.host.phase[phase]=true;
    h.scope.press('key:KeyA',{key:'a',midi:60});await h.idle();
    assert.equal(h.notes.size,0);assert.equal(h.calls.length,0,phase);
  }
});

test('reference playback blocks hand keys and a late hand On cannot enter a newly started song',async()=>{
  for(const field of ['playing','busy']){
    const h=harness();h.scope.songState={[field]:true};
    h.scope.press('key:KeyA',{key:'a',midi:60});await h.idle();assert.equal(h.notes.size,0);assert.equal(h.calls.length,0);
    const gate=deferred(),late=harness({ready:gate.promise});
    late.scope.press('key:KeyA',{key:'a',midi:60});await Promise.resolve();late.scope.songState={[field]:true};gate.resolve();await late.idle();
    assert(!late.calls.some(call=>call[0]==='command'&&call[1]==='noteOn'));
  }
});

test('an explicit sound load ends reference playback before applying to the authored chip',async()=>{
  const h=harness({running:false});h.scope.songControls={read:()=>({canStop:true}),stop:()=>h.calls.push(['songStop'])};
  const next=createDefaultPreset();next.name='New sound';
  await h.scope.applyPreset(next,{load:true});
  assert.equal(h.calls[0][0],'songStop');assert(h.calls.some(call=>call[0]==='command'&&call[1]==='loadPreset'));
  assert.equal(h.scope.preset.name,'New sound');
});

test('an author load made while Code is preparing waits for its session without restarting or losing the selection',async()=>{
  const gate=deferred(),h=harness({session:null}),next=createDefaultPreset();next.name='Prepared noise';next.source='noise';
  h.engine.pendingPrepare=gate.promise;
  const loading=h.scope.applyPreset(next,{load:true});await Promise.resolve();await Promise.resolve();
  assert(h.calls.some(call=>call[0]==='prepareClient'),'the host prepares the existing Code client');
  assert(!h.calls.some(call=>call[0]==='preset'));assert.equal(h.scope.preset.name,'Sine','author checkpoint waits for acknowledgement');
  gate.resolve();assert.equal(await loading,true);
  assert.equal(h.engine.codeSession,7);assert.deepEqual(h.scope.preset,next);assert(h.host.running);
  assert.deepEqual(h.calls.find(call=>call[0]==='preset'),['preset',next,true]);
  assert(!h.calls.some(call=>call[0]==='command'&&['loadPreset','stop'].includes(call[1])));
});

test('Code Stop during client preparation discards the old selection without checkpointing an unapplied sound',async()=>{
  const gate=deferred(),h=harness({session:null}),next=createDefaultPreset();next.name='Stale selection';next.source='noise';
  h.engine.pendingPrepare=gate.promise;const before=readPreset(h.scope.preset),loading=h.scope.applyPreset(next,{load:true});
  await Promise.resolve();await Promise.resolve();assert(h.calls.some(call=>call[0]==='prepareClient'));
  h.host.running=false;h.scope.epoch++;gate.resolve();assert.equal(await loading,false);
  assert.deepEqual(h.scope.preset,before);assert(!h.calls.some(call=>['preset','dirty'].includes(call[0])));
});

test('Files selection cancellation reports false and cannot publish a stale authored sound',async()=>{
  const next=createDefaultPreset();next.name='Cancelled file selection';next.volume=18;
  const untouched=harness(),before=readPreset(untouched.scope.preset);
  assert.equal(await untouched.scope.applyPreset(next,{load:true,isCurrent:()=>false}),false);
  assert.equal(untouched.calls.length,0);assert.equal(untouched.scope.revision,1);assert.deepEqual(untouched.scope.preset,before);

  const gate=deferred(),h=harness();let selected=true;h.engine.pendingPreset=gate.promise;
  const loading=h.scope.applyPreset(next,{load:true,isCurrent:()=>selected});
  await Promise.resolve();await Promise.resolve();assert(h.calls.some(call=>call[0]==='preset'));
  selected=false;gate.resolve();assert.equal(await loading,false);
  assert.deepEqual(h.scope.preset,before,'a backend acknowledgement cannot overwrite the newly selected file');
  assert(!h.calls.some(call=>['read','dirty','wake'].includes(call[0])));
});
