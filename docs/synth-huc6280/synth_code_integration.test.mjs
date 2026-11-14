// The application's real Code/manual dispatch and pending-key boundaries.
// No DOM, browser or audio device is constructed.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createDefaultPreset,readPreset,isWaveOnlyEdit} from './preset.js';
import {createHuc6280CodeEdit} from './code_parameter_edit.js';

const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const contextSource=source.match(/^const channelContext=.*$/m)[0];
const apply=source.slice(source.indexOf('function applyPreset('),source.indexOf('const editor = createEditor('));
const keyboard=source.slice(source.indexOf('function pausedSelection('),source.indexOf("$('startAudio').addEventListener"));
const pitchSource=source.slice(source.indexOf('function setPitch(value)'),source.indexOf('for (const [wheel] of pitchWheels)'));
const edit=source.slice(source.indexOf('async function editVisiblePreset('),source.indexOf('codeHost=setupHuc6280CodeHost('));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

function harness({ready=Promise.resolve(),channel=2,running=true,session=1}={}){
  const calls=[],errors=[],notes=new Map(),auditionNotes=new Map();let pending=Promise.resolve(),scope;
  const engine={codeSession:session,state:{preset:createDefaultPreset(),voices:[]},
    async command(method,args=[]){calls.push(['command',method,structuredClone(args)]);
      if(['loadPreset','setPreset'].includes(method)){engine.state.preset=readPreset(args[0]);if(engine.pendingCommand)await engine.pendingCommand;}
      return{channel};},
    async getHuc6280Client(){calls.push(['prepareClient']);if(engine.pendingPrepare)await engine.pendingPrepare;engine.codeSession=7;return{};},
    async applyCodePreset(value,options){assert(options.isCurrent());calls.push(['preset',structuredClone(value),options.replace]);engine.state.preset=readPreset(value);if(engine.pendingPreset)await engine.pendingPreset;},
    async applyCodeEdit(value,options){assert(options.isCurrent());calls.push(['edit',structuredClone(value)]);if(engine.pendingEdit)await engine.pendingEdit;return structuredClone(engine.state);},
    async applyEditorEdit(value,options){assert(options.isCurrent());calls.push(['editorEdit',structuredClone(value)]);return structuredClone(engine.state);},
    async read(){calls.push(['read']);if(engine.pendingRead)await engine.pendingRead;
      if(engine.readFailure){const error=engine.readFailure;engine.readFailure=null;throw error;}
      return structuredClone(engine.state);},
  };
  const host={running,mode:false,phase:{busy:false,stopping:false},getState(){return this.phase;},isRunning(){return this.running;},isCodeMode(){return this.mode;},markSoundDirty(){calls.push(['dirty']);}};
  const audition={active:false,async noteOn(id,midi,options){calls.push(['auditionOn',id,midi]);audition.lastGuard=options.isCurrent;
      if(audition.pendingOn)await audition.pendingOn;return options.isCurrent();},
    async noteOff(id){calls.push(['auditionOff',id]);},async setPitch(value){calls.push(['auditionPitch',value]);},
    read(){return{active:this.active};},async stop(){calls.push(['auditionStop']);if(audition.pendingStop)await audition.pendingStop;this.active=false;},
  };
  const observer=name=>({async refresh(){calls.push([name+'Refresh']);},setEnabled(){},sync(){},setVoice(value){calls.push([name+'Voice',value]);},read:()=>({liveState:{}})});
  scope=vm.createContext({Promise,DOMException,Map,Set,Array,Number,JSON,structuredClone,
    audio:engine,preset:createDefaultPreset(),displayedPreset:createDefaultPreset(),revision:1,epoch:1,sequence:0,importSequence:0,pitch:1,
    codeHost:host,songControls:null,songState:null,channelTarget:channel,channelSelection:0,autoUpdate:true,liveSignature:'old',disposed:false,switchingAudioOutput:false,notes,auditionNotes,audition,auditionSelectionKey:null,
    readPreset,isWaveOnlyEdit,createHuc6280CodeEdit,
    enqueue(action){const task=pending.then(action);pending=task.catch(error=>errors.push(error));return task;},
    ensureAudio:async()=>{await ready;return engine;},
    updatePresetUi(){calls.push(['ui']);},updateKeys(){},updateCapacity(){},readVoices(){calls.push(['voices']);},
    setPitchUi(value){scope.pitch=value;calls.push(['pitchUi',value]);},
    vgmLibrary:{clearSelection(){calls.push(['clearVgm']);}},
    visualizer:{wake(){calls.push(['wake']);},stop(){calls.push(['visualStop']);}},
    codeLive:{...observer('code'),async refresh(){calls.push(['refresh']);}},
    editorLive:observer('editor'),renderCodeLive(){calls.push(['renderLive']);},
    status(message){calls.push(['status',message]);},report:error=>errors.push(error),
    canPlay:()=>true,capacity:()=>6,midiToNoteName:note=>String(note),
    async prepareDdaAudio(){calls.push(['prepareDda']);return{name:'unused',data:'',sampleRate:8000};},
  });
  vm.runInContext(contextSource+'\n'+apply+'\n'+keyboard+'\n'+pitchSource+'\n'+edit,scope);
  return{scope,engine,host,audition,calls,errors,notes,auditionNotes,idle:()=>pending};
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

test('normal physical edits use the idle channel endpoint without changing or persisting the common sound',async()=>{
  const h=harness({running:false,channel:4,session:null}),common=readPreset(h.scope.preset),next=readPreset(h.scope.displayedPreset);next.volume=9;
  await h.scope.editVisiblePreset(next);
  assert.deepEqual(h.calls.find(call=>call[0]==='editorEdit'),['editorEdit',{channel:4,changes:{volume:9}}]);
  assert.deepEqual(h.scope.preset,common);assert(!h.calls.some(call=>['dirty','edit','preset'].includes(call[0])));assert(h.calls.some(call=>call[0]==='editorRefresh'));
});

test('VGM physical view ignores forged parameter changes without stopping playback or touching author/audio',async()=>{
  for(const state of [{playing:true,playback:'playing'},{busy:true,seeking:true,playback:'seeking'}]){
    const h=harness({running:false});h.scope.songState=state;const next=readPreset(h.scope.displayedPreset);next.volume=9;
    assert.equal(await h.scope.editVisiblePreset(next),false);assert.equal(h.calls.length,0);
  }
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
  const loading=h.scope.applyPreset(next,{load:true});await turn();
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
  await turn();assert(h.calls.some(call=>call[0]==='prepareClient'));
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
  await turn();assert(h.calls.some(call=>call[0]==='preset'));
  selected=false;gate.resolve();assert.equal(await loading,false);
  assert.deepEqual(h.scope.preset,before,'a backend acknowledgement cannot overwrite the newly selected file');
  assert(!h.calls.some(call=>['read','dirty','wake'].includes(call[0])));
});

function pausedHarness({channel=0,playable=true,source='wave'}={}){
  const h=harness({channel,running:false,session:null});
  const captured=createDefaultPreset();captured.name='Paused reference';captured.volume=17;captured.wave.fill(9);captured.envelope.enabled=false;
  if(source==='noise'){captured.source='noise';captured.noise.frequency=7;}
  let selection={key:`song:${channel}:123`,channel,snapshot:{positionFrames:123},positionFrames:123,
    prepared:{preset:captured,channel,source,positionFrames:123,playable,capturable:true,reason:playable?'':'Muted channel'}};
  h.scope.songState={playback:'paused',paused:true,playing:false,busy:false,canStop:true,positionFrames:123};
  h.scope.songControls={read:()=>h.scope.songState,getPausedSelection:()=>selection,
    stop(){h.calls.push(['songStop']);h.scope.songState={playback:'stopped',paused:false,playing:false,busy:false,canStop:false,positionFrames:0};selection=null;},
    setView(target){h.calls.push(['songView',target]);},
  };
  return{...h,captured,get selection(){return selection;},replaceSelection(value){selection=value;}};
}

test('actual Capture applies an acknowledged authored preset while retaining the reference Pause/frame and stopping only its private audition',async()=>{
  const h=pausedHarness(),before=readPreset(h.scope.preset);h.audition.active=true;
  const payload={...h.selection.prepared,capturable:true};assert.equal(await h.scope.capturePausedVoice(payload),true);
  assert.equal(h.scope.songState.playback,'paused');assert.equal(h.scope.songState.positionFrames,123);assert(!h.calls.some(call=>call[0]==='songStop'));
  assert.equal(h.calls.filter(call=>call[0]==='auditionStop').length,1);
  assert.deepEqual(h.engine.state.preset,h.captured);assert.deepEqual(h.scope.preset,h.captured);assert.notDeepEqual(h.scope.preset,before);
  assert(h.calls.some(call=>call[0]==='dirty'));assert(h.calls.findIndex(call=>call[0]==='auditionStop')<h.calls.findIndex(call=>call[0]==='command'&&call[1]==='loadPreset'));
});

test('atomic Capture cancellation during load ACK or read ACK restores the previous native author checkpoint without publishing capture',async()=>{
  for(const boundary of['command','read']){
    const h=pausedHarness(),before=readPreset(h.scope.preset),gate=deferred();let current=true;
    if(boundary==='command')h.engine.pendingCommand=gate.promise;else h.engine.pendingRead=gate.promise;
    const loading=h.scope.applyPreset(h.captured,{load:true,keepSongPaused:true,atomic:true,isCurrent:()=>current});await turn();
    assert(h.calls.some(call=>call[0]==='command'&&call[1]==='loadPreset'));assert.deepEqual(h.engine.state.preset,h.captured,'native capture is awaiting acknowledgement');
    assert.deepEqual(h.scope.preset,before,'author UI/checkpoint has not committed before acknowledgement');
    current=false;gate.resolve();assert.equal(await loading,false,boundary);
    const loads=h.calls.filter(call=>call[0]==='command'&&call[1]==='loadPreset');assert.equal(loads.length,2);assert.deepEqual(loads[1][2],[before]);
    assert.deepEqual(h.engine.state.preset,before);assert.deepEqual(h.scope.preset,before);assert(!h.calls.some(call=>['dirty','wake'].includes(call[0])));
    assert.equal(h.scope.songState.playback,'paused');assert.equal(h.scope.songState.positionFrames,123);
  }
});

test('a cancelled atomic Capture cannot publish its stale native state when the pending read rejects before a later read succeeds',async()=>{
  const h=pausedHarness(),before=readPreset(h.scope.preset),gate=deferred();let current=true;
  h.engine.pendingRead=gate.promise;h.engine.readFailure=new DOMException('Snapshot request cancelled','AbortError');
  const loading=h.scope.applyPreset(h.captured,{load:true,keepSongPaused:true,atomic:true,isCurrent:()=>current});await turn();
  assert(h.calls.some(call=>call[0]==='read'));assert.deepEqual(h.engine.state.preset,h.captured);assert.deepEqual(h.scope.preset,before);
  current=false;gate.resolve();await loading.catch(()=>false);
  assert.deepEqual(h.scope.preset,before,'a recovery read must not publish cancelled capture state');
  assert.deepEqual(h.engine.state.preset,before,'an acknowledged native load must roll back when its atomic capture is cancelled');
  assert(!h.calls.some(call=>call[0]==='dirty'));assert.equal(h.scope.songState.playback,'paused');
});

test('a retiring Capture never rolls an acknowledged newer Synth edit back to its older checkpoint',async()=>{
  const h=pausedHarness(),gate=deferred();let current=true;h.engine.pendingCommand=gate.promise;
  const capturing=h.scope.applyPreset(h.captured,{load:true,keepSongPaused:true,atomic:true,isCurrent:()=>current});await turn();
  current=false;h.scope.channelTarget='synth';const next=readPreset(h.scope.preset);next.name='Newer Synth edit';next.volume=9;
  const editing=h.scope.editVisiblePreset(next);gate.resolve();assert.equal(await capturing,false);await editing;
  assert.deepEqual(h.scope.preset,next);assert.deepEqual(h.engine.state.preset,next);
  assert.equal(h.calls.filter(call=>call[0]==='command'&&call[1]==='loadPreset').length,1,'retiring capture does not roll back across a newer author revision');
  assert.equal(h.scope.songState.playback,'paused');
});

test('Capture cancellation before/while private audition shutdown cannot address the author chip',async()=>{
  const h=pausedHarness(),gate=deferred();let current=true;h.audition.active=true;h.audition.pendingStop=gate.promise;
  const loading=h.scope.capturePausedVoice(h.selection.prepared,{isCurrent:()=>current});await turn();
  assert(h.calls.some(call=>call[0]==='auditionStop'));assert(!h.calls.some(call=>call[0]==='command'));
  current=false;gate.resolve();assert.equal(await loading,false);assert(!h.calls.some(call=>call[0]==='command'&&['loadPreset','setPreset'].includes(call[1])));
  assert.equal(h.scope.songState.playback,'paused');
});

test('Synth knobs keep Pause, while an explicit preset load stops the song before applying the authored sound',async()=>{
  const knob=pausedHarness();knob.scope.channelTarget='synth';const next=readPreset(knob.scope.preset);next.volume=11;
  await knob.scope.editVisiblePreset(next);assert(!knob.calls.some(call=>call[0]==='songStop'));
  assert.equal(knob.scope.songState.playback,'paused');assert.equal(knob.scope.songState.positionFrames,123);
  assert(knob.calls.some(call=>call[0]==='command'&&call[1]==='setPreset'));assert.equal(knob.scope.preset.volume,11);
  const loaded=pausedHarness();loaded.scope.channelTarget='synth';await loaded.scope.applyPreset(next,{load:true});
  const stop=loaded.calls.findIndex(call=>call[0]==='songStop'),load=loaded.calls.findIndex(call=>call[0]==='command'&&call[1]==='loadPreset');
  assert(stop>=0&&stop<load);assert.equal(loaded.scope.songState.playback,'stopped');
});

test('paused physical keyboard and Pitch use the isolated audition endpoint; Synth still uses the authored endpoint while Pause survives',async()=>{
  const h=pausedHarness({channel:3});h.scope.press('key:KeyA',{key:'a',midi:64});await turn();
  const note=h.auditionNotes.get('key:KeyA');assert(note);assert.equal(h.notes.size,0);
  assert.deepEqual(h.calls.find(call=>call[0]==='auditionOn'),['auditionOn',note.id,64]);assert(!h.calls.some(call=>call[0]==='command'));
  h.scope.setPitch(.5);await turn();assert(h.calls.some(call=>call[0]==='auditionPitch'&&call[1]===.5));assert(!h.calls.some(call=>call[0]==='command'));
  h.scope.release('key:KeyA');await turn();assert.equal(h.auditionNotes.size,0);assert(h.calls.some(call=>call[0]==='auditionOff'&&call[1]===note.id));
  assert.equal(h.scope.songState.playback,'paused');assert.equal(h.scope.songState.positionFrames,123);
  const authored=pausedHarness();authored.scope.channelTarget='synth';authored.scope.press('key:KeyA',{key:'a',midi:64});await authored.idle();
  assert(authored.calls.some(call=>call[0]==='command'&&call[1]==='noteOn'));assert(!authored.calls.some(call=>call[0]==='auditionOn'));assert.equal(authored.scope.songState.playback,'paused');
});

test('muted paused voices block audition and Noise keeps its fixed hardware clock while Pitch returns to zero',async()=>{
  const muted=pausedHarness({playable:false});muted.scope.press('key:KeyA',{key:'a',midi:64});await turn();assert.equal(muted.auditionNotes.size,0);assert.equal(muted.calls.length,0);
  const noise=pausedHarness({source:'noise',channel:4});noise.scope.press('key:KeyA',{key:'a',midi:1});await turn();assert(noise.calls.some(call=>call[0]==='auditionOn'));
  noise.scope.setPitch(.5);await turn();assert.equal(noise.scope.pitch,0);assert(!noise.calls.some(call=>call[0]==='auditionPitch'));
});

test('a delayed paused-key audition cannot cross release, selection changes, Resume, Code Run or output transition',async()=>{
  for(const transition of['release','channel','resume','seek','code','output']){
    const h=pausedHarness(),gate=deferred();h.audition.pendingOn=gate.promise;h.scope.press('key:KeyA',{key:'a',midi:64});
    assert(h.audition.lastGuard());
    if(transition==='release')h.scope.release('key:KeyA');
    if(transition==='channel'){h.scope.channelTarget=1;h.replaceSelection({...h.selection,key:'song:1:123',channel:1});h.scope.syncAuditionSelection();}
    if(transition==='resume')h.scope.songState={...h.scope.songState,playback:'playing',playing:true,paused:false};
    if(transition==='seek')h.scope.songState={...h.scope.songState,playback:'seeking',seeking:true,busy:true,playing:false,paused:false};
    if(transition==='code'){h.host.running=true;h.scope.songState={playback:'stopped',paused:false,playing:false};}
    if(transition==='output')h.scope.switchingAudioOutput=true;
    assert.equal(h.audition.lastGuard(),false,transition);gate.resolve();await turn();
    assert.equal(h.auditionNotes.size,0);assert(!h.calls.some(call=>call[0]==='command'&&call[1]==='noteOn'));
  }
});
