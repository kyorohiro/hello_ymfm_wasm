// Exercise the application's real dispatch and keyboard routes without a
// browser or audio device. The native lease and transport tests cover the chip.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const invoke=source.slice(source.indexOf('async function invoke('),source.indexOf('const panel = createSpuInstrumentPanel('));
const keyboard=source.slice(source.indexOf('async function press('),source.indexOf('function editing('));
const editorOwner=source.slice(source.indexOf('function retainedPsfEditorOwner('),source.indexOf('const addressText='));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

function harness({view='channel',ready=Promise.resolve()}={}) {
  const calls=[],notes=new Map(),inputs={sustainToggle:{checked:false},spuPsfReferenceKey:{value:'C4'}};
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
    codeHost:{isCodeMode:()=>false,isRunning:()=>false,markSoundDirty(){calls.push(['dirty']);}},
    codeLive:{read:()=>({liveEnabled:false})},audio,state:{auditions:[],pmon:{enabled:false},noise:{enabled:false}},
    pausedStopFence:Promise.resolve(),pausedStopping:0,pausedEditorAudition:false,
    ensureAudio:async()=>{await ready;return audio;},stopPausedKeyboard:async()=>{},pausedSelection:()=>null,
    psfSeekBusy:()=>false,previewActive:()=>false,cancelPendingCapture(){},
    playingPsfChannel:()=>scope.psfView==='channel'&&song.playing&&song.liveEnabled?structuredClone(song):null,
    stopCodeForEdit:async options=>{assert.equal(options.preservePsf,true);calls.push(['preserve']);return true;},
    pausedEditorMethods:new Set(['setInstrumentPreset','setInstrumentEnvelope','setInstrumentMorph','setInstrumentPitchBend']),
    visualizer:{wake(){calls.push(['wake']);}},updateKeys(){},status(){},noteName:midi=>String(midi),
    releasePsfKeys:()=>transport.releaseManual(),report:error=>{throw error;},
  });
  vm.runInContext(editorOwner+'\n'+invoke+'\n'+keyboard,scope);
  return {scope,song,transport,audio,calls,notes};
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
  const h=harness();
  await h.scope.press('key:KeyA',{key:'a',midi:64});
  const id=h.notes.get('key:KeyA').id;
  assert.deepEqual(h.calls,[['on',id,3,64,{referenceMidi:60,bend:1.5}]]);
  assert.equal(h.notes.get('key:KeyA').owner,'psf-live');
  h.scope.release('key:KeyA');assert.deepEqual(h.calls.at(-1),['off',id]);assert.equal(h.notes.size,0);
  assert(h.song.playing);
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
