// Exercise the application's real dispatch and keyboard routes without a
// browser or audio device. The native lease and transport tests cover the chip.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const invoke=source.slice(source.indexOf('async function invoke('),source.indexOf('const panel = createSpuInstrumentPanel('));
const keyboard=source.slice(source.indexOf('async function press('),source.indexOf('function editing('));
const input=source.slice(source.indexOf('function editing('),source.indexOf("$('sustainToggle').addEventListener"));
const editorOwner=source.slice(source.indexOf('function retainedPsfEditorOwner('),source.indexOf('const addressText='));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

function harness({view='channel',ready=Promise.resolve(),codeMode=false,running=false}={}) {
  const calls=[],notes=new Map(),inputs={sustainToggle:{checked:false},spuPsfReferenceKey:{value:'C4'},spuFileNameDialog:{open:false},spuFileContextMenu:{hidden:true}},listeners=new Map(),windowListeners=new Map();
  const code={mode:codeMode,running,busy:false,opens:0,openAllowed:true};
  const song={playing:true,paused:false,canStop:true,liveEnabled:true,manualAvailable:true,liveVoice:3,selection:{entry:'song.psf'}};
  const audio={state:{auditions:[]},command(method,args){calls.push(['author',method,structuredClone(args)]);return Promise.resolve({channel:0});}};
  const transport={read:()=>structuredClone(song),describeVoice:ch=>({playable:true,channel:ch}),
    noteOn(id,ch,midi,options){calls.push(['on',id,ch,midi,structuredClone(options)]);return {id,channel:ch};},
    noteOff(id){calls.push(['off',id]);return true;},releaseManual(){calls.push(['release']);return true;},
    editVoice(ch,patch){calls.push(['edit',ch,structuredClone(patch)]);return true;},
    setPitchBend(value){calls.push(['bend',value]);return true;},stop(){throw Error('manual controls must not stop PSF');}};
  const scope=vm.createContext({DOMException,Promise,Map,Set,Number,Array,Boolean,
    $:id=>inputs[id],notes,epoch:1,assetEpoch:1,psfActionEpoch:1,psfViewEpoch:1,psfView:view,psfSong:transport,
    noteSequence:0,bend:1.5,topologyPending:0,switchingAudioOutput:false,capturePending:null,disposed:false,
    codeHost:{isCodeMode:()=>code.mode,isRunning:()=>code.running,getState:()=>({busy:code.busy}),openOutput(){code.opens++;return code.openAllowed;},markSoundDirty(){calls.push(['dirty']);}},
    codeLive:{read:()=>({liveEnabled:code.running,liveVoice:7}),sync(){}},audio,state:{auditions:[],pmon:{enabled:false},noise:{enabled:false}},
    pausedStopFence:Promise.resolve(),pausedStopping:0,pausedEditorAudition:false,
    ensureAudio:async()=>{await ready;return audio;},stopPausedKeyboard:async()=>{},pausedSelection:()=>null,
    psfSeekBusy:()=>false,previewActive:()=>false,cancelPendingCapture(){},
    playingPsfChannel:()=>scope.psfView==='channel'&&song.playing&&song.liveEnabled?structuredClone(song):null,
    stopCodeForEdit:async options=>{assert.equal(options.preservePsf,true);calls.push(['preserve']);return true;},
    pausedEditorMethods:new Set(['setInstrumentPreset','setInstrumentEnvelope','setInstrumentMorph','setInstrumentPitchBend']),
    visualizer:{wake(){calls.push(['wake']);}},updateKeys(){},status(){},noteName:midi=>String(midi),
    releasePsfKeys:()=>transport.releaseManual(),report:error=>{throw error;},
    document:{hidden:false,activeElement:null,addEventListener(type,fn){listeners.set(type,fn);}},window:{addEventListener(type,fn){windowListeners.set(type,fn);}},
    layout:{entries:[{key:'a',midi:60}]},octave:0,resetBend(){},panel:{setVisible(){}},
    cancelPsfSeek:async()=>{},stop:async()=>{calls.push(['stop']);},setTimeout,
  });
  scope.visualizer.setVisible=()=>{};
  vm.runInContext(editorOwner+'\n'+invoke+'\n'+keyboard+'\n'+input,scope);
  const event=(target=null,extra={})=>({key:'a',code:'KeyA',target,repeat:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra});
  return {scope,song,transport,audio,calls,notes,code,inputs,listeners,windowListeners,event,async idle(){for(let i=0;i<12;i++)await Promise.resolve();}};
}

test('PSF CH controls dispatch only sparse changes to the playing song, without author writes or stopping it',async()=>{
  const h=harness();
  await h.scope.invoke('setInstrumentPreset',[{volumeLeft:.2}]);
  await h.scope.invoke('setInstrumentEnvelope',[{releaseRate:7},{live:true}]);
  await h.scope.invoke('setInstrumentPitchBend',[2]);
  assert.deepEqual(h.calls.filter(c=>c[0]!=='wake'),[
    ['edit',3,{volumeLeft:.2}],['edit',3,{envelope:{releaseRate:7}}],['bend',2],
  ]);
  assert.equal(h.song.playing,true);
});

test('unsupported PSF sample/shared-effect edits reject without retiring playback or touching the author instrument',async()=>{
  const h=harness();
  for(const method of ['setInstrumentWaveform','setInstrumentMorph','setInstrumentNoise','setInstrumentPmon','setReverb'])
    await assert.rejects(h.scope.invoke(method,[{}]),/Use Synth view/);
  assert.deepEqual(h.calls,[]);assert(h.song.playing);
  h.song.manualAvailable=false;h.song.manualReason='Matching engine required';
  await assert.rejects(h.scope.invoke('setInstrumentPreset',[{pitch:4096}]),/Matching engine/);
  assert.deepEqual(h.calls,[]);
});

test('Synth view edits its independent authored bank while the PSF retains its performance',async()=>{
  const h=harness({view:'synth'});
  await h.scope.invoke('setInstrumentEnvelope',[{attackRate:12}]);
  assert.deepEqual(h.calls,[['preserve'],['author','setInstrumentEnvelope',[{attackRate:12}]],['wake'],['dirty']]);
  assert(h.song.playing);
});

test('startup and Resume defer manual controls without cancelling the source or starting an author key',async()=>{
  for(const phase of ['starting','resuming']) {
    const h=harness();h.song.playing=false;h.song[phase]=true;
    await assert.rejects(h.scope.invoke('setInstrumentEnvelope',[{attackRate:12}]),error=>error.name==='AbortError');
    await h.scope.press('key:KeyA',{key:'a',midi:60});
    assert.deepEqual(h.calls,[]);assert.equal(h.notes.size,0);
  }
});

test('a retained editor operation cannot cross a source/action change while awaiting permission to edit',async()=>{
  const h=harness({view:'synth'}),pending=deferred();
  h.scope.stopCodeForEdit=()=>pending.promise;
  const edit=h.scope.invoke('setInstrumentEnvelope',[{attackRate:12}]);
  h.scope.assetEpoch++;pending.resolve(true);
  await assert.rejects(edit,error=>error.name==='AbortError');
  assert.deepEqual(h.calls,[]);
});

test('playing PSF keyboard targets the selected physical CH and passes a stable reference key without copying its observed sound',async()=>{
  const h=harness({codeMode:true});
  await h.scope.press('key:KeyA',{key:'a',midi:64});
  const id=h.notes.get('key:KeyA').id;
  assert.deepEqual(h.calls,[['on',id,3,64,{referenceMidi:60,bend:1.5}]]);
  assert.equal(h.notes.get('key:KeyA').owner,'psf-live');
  h.scope.release('key:KeyA');assert.deepEqual(h.calls.at(-1),['off',id]);assert.equal(h.notes.size,0);
  assert(h.song.playing);
});

test('Code-view keys share the selected Code CH and key-up inside text still releases only the hand owner',async()=>{
  const h=harness({codeMode:true,running:true});Object.assign(h.song,{playing:false,canStop:false});
  const down=h.event();h.listeners.get('keydown')(down);await h.idle();
  const note=h.notes.get('key:KeyA');assert(note?.started);assert(down.defaultPrevented);
  assert.deepEqual(h.calls.find(call=>call[1]==='instrumentNoteOn'),['author','instrumentNoteOn',[60,note.id,1.5,7]]);
  const count=h.calls.length;h.listeners.get('keydown')(h.event(null,{repeat:true}));await h.idle();assert.equal(h.calls.length,count);
  h.listeners.get('keyup')(h.event({closest:()=>({})}));await h.idle();assert.equal(h.notes.size,0);
  assert(h.calls.some(call=>call[1]==='instrumentNoteOff'&&call[2][0]===note.id));assert.equal(h.code.opens,0);assert(h.code.running);
});

test('Code-view focus boundaries protect editing, dialogs and native controls, including Monaco Escape',async()=>{
  const control=selector=>{const node={closest:query=>query.split(',').includes(selector)?node:null,matches:()=>false};return node;};
  for(const selector of ['input','select','textarea','dialog[open]','.monaco-editor','#synthCodeEditorHost','[contenteditable]:not([contenteditable="false"])']){
    const h=harness({codeMode:true,running:true}),target=control(selector),e=h.event(target);Object.assign(h.song,{playing:false,canStop:false});
    h.listeners.get('keydown')(e);await h.idle();assert.equal(h.notes.size,0,selector);assert(!e.defaultPrevented,selector);
    h.listeners.get('keydown')(h.event(target,{key:'Escape'}));await h.idle();assert.equal(h.calls.length,0,'editor Escape never stops Code');
  }
  for(const flag of ['ctrlKey','metaKey','altKey','defaultPrevented','isComposing']){
    const h=harness({codeMode:true,running:true});h.listeners.get('keydown')(h.event(null,{[flag]:true}));await h.idle();assert.equal(h.notes.size,0,flag);
  }
  const monaco=harness({codeMode:true,running:true}),input={closest:query=>query.includes('.monaco-editor')||query.includes('input[type=text]')?input:null,blur(){assert.fail('Monaco Enter must stay in its editor');},matches:()=>false};
  const enter=monaco.event(input,{key:'Enter'});monaco.listeners.get('keydown')(enter);await monaco.idle();assert(!enter.defaultPrevented);assert.equal(monaco.calls.length,0);
  const h=harness({codeMode:true,running:true});h.inputs.spuFileContextMenu.hidden=false;h.listeners.get('keydown')(h.event());await h.idle();assert.equal(h.notes.size,0);
});

test('idle Code keys reopen the completed output, but Code transitions cancel both new and pending notes',async()=>{
  const h=harness({codeMode:true});Object.assign(h.song,{playing:false,canStop:false});
  await h.scope.press('key:KeyA',{key:'a',midi:60});assert.equal(h.notes.size,1);assert.equal(h.code.opens,1);h.scope.release('key:KeyA');
  h.code.busy=true;await h.scope.press('key:KeyA',{key:'a',midi:60});assert.equal(h.notes.size,0);
  const gate=deferred(),pending=harness({codeMode:true,ready:gate.promise});Object.assign(pending.song,{playing:false,canStop:false});
  const on=pending.scope.press('key:KeyA',{key:'a',midi:60});pending.code.busy=true;gate.resolve();await on;
  assert.equal(pending.notes.size,0);assert(!pending.calls.some(call=>call[1]==='instrumentNoteOn'));assert.equal(pending.code.opens,0);
});

test('Code-view blur releases only keyboard auditions and retains the running program',async()=>{
  const h=harness({codeMode:true,running:true});Object.assign(h.song,{playing:false,canStop:false});
  await h.scope.press('key:KeyA',{key:'a',midi:60});h.windowListeners.get('blur')();await h.idle();
  assert.equal(h.notes.size,0);assert(h.calls.some(call=>call[1]==='instrumentAllNotesOff'));assert(!h.calls.some(call=>call[0]==='stop'||call[1]==='stop'));assert(h.code.running);
});

test('key-up, Pause, CH selection and source changes cancel a pending On before it can reach the running SPU',async()=>{
  for(const action of ['keyup','pause','channel','source']) {
    const pending=deferred(),h=harness({ready:pending.promise});
    const on=h.scope.press('key:KeyA',{key:'a',midi:60});
    if(action==='keyup')h.scope.release('key:KeyA');
    if(action==='pause'){h.song.playing=false;h.song.paused=true;h.scope.psfActionEpoch++;}
    if(action==='channel')h.song.liveVoice=4;
    if(action==='source')h.song.selection.entry='replacement.psf';
    pending.resolve();await on;
    assert.equal(h.calls.some(c=>c[0]==='on'),false,action);
    assert.equal(h.calls.some(c=>c[0]==='author'),false,action);
  }
});

test('PSF Synth-view keys keep the song playing and use the authored bank instead of its selected physical channel',async()=>{
  const h=harness({view:'synth'});
  await h.scope.press('key:KeyA',{key:'a',midi:60});
  assert.equal(h.notes.get('key:KeyA').owner,'psf-editor');
  assert.equal(h.calls[0][0],'author');assert.equal(h.calls[0][1],'instrumentNoteOn');
  assert(h.song.playing);h.scope.release('key:KeyA');assert.equal(h.calls.at(-1)[1],'instrumentNoteOff');
});
