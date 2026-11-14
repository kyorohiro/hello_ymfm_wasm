// Evaluate the actual input selectors during the cold Code initialization
// boundary. No browser or audio device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const selectors=source.slice(source.indexOf('function getPlayableSynth()'),source.indexOf('async function ensureLooper()'));

test('cold Code initialization can apply author tuning before its keyboard adapter exists, for all three editor chips',()=>{
  const fm={},psg={},pcm={},wrapped=[];
  const scope=vm.createContext({codeActive:true,codeAudio:null,synth:{},editorChip:'ym2612',editorPerformanceTarget:fm,
    pcmAudio:{getPcm:()=>({})},psgAudio:{getPsg:()=>({})},pcmVoice:pcm,psgVoice:psg,looper:null,
    isLocalChannelTarget:()=>false,localChannelKeyboard:()=>null,
    isSongChannelTarget:()=>false,isFmSongPlaying:()=>false,isPsgSongPlaying:()=>false,isPcmReferenceKeyboard:()=>false,songAuditionVoice:null});
  vm.runInContext(selectors,scope);
  for(const [chip,target]of [['ym2612',fm],['psg',psg],['pcm',pcm]]){
    scope.editorChip=chip;assert.equal(scope.getPlayableSynth(),target,'cold '+chip);
  }
  scope.codeAudio={keyboardTarget(name,target){wrapped.push(name);return {target};}};
  for(const [chip,target]of [['ym2612',fm],['psg',psg],['pcm',pcm]]){
    scope.editorChip=chip;assert.equal(scope.getPlayableSynth().target,target);
  }
  assert.deepEqual(wrapped,['ym2612','segapsg','rf5c164']);
});

test('switching editor tabs cannot send the old PCM or FM channel number to the PSG keyboard',()=>{
  const input=source.slice(source.indexOf('function isPerformanceInputEnabled()'),source.indexOf('function getCurrentPerformanceVoice()'));
  const described=[];
  const scope=vm.createContext({isLocalChannelTarget:()=>false,localChannelDescription:()=>null,isReferenceKeyboard:()=>true,isSongChannelTarget:()=>true,
    editorChip:'psg',songTargetState:{chip:'pcm',target:'pcm:7',playback:'playing'},
    songControls:{describePsg(ch){assert(ch>=0&&ch<4);described.push(ch);return{playable:true};}},
    codeRuntime:null,codeControls:{isCodeMode:()=>false},editorSwitchPending:false,switchingAudioOutput:false,referenceRecordingStop:null,songAuditionVoice:null});
  vm.runInContext(input,scope);
  assert.equal(scope.isPerformanceInputEnabled(),false);assert.deepEqual(described,[]);
  scope.songTargetState={chip:'ym2612',target:5,playback:'playing'};
  assert.equal(scope.isPerformanceInputEnabled(),false);assert.deepEqual(described,[]);
  scope.songTargetState={chip:'psg',target:'psg:3',playback:'playing'};
  assert.equal(scope.isPerformanceInputEnabled(),true);assert.deepEqual(described,[3]);
});

test('fixed local channel selects its physical keyboard before Code author adapters and reports unavailable hardware states',()=>{
  const input=source.slice(source.indexOf('function isPerformanceInputEnabled()'),source.indexOf('function getCurrentPerformanceVoice()'));
  const physical={ym2612:{name:'physical-fm'},psg:{name:'physical-psg'},pcm:{name:'physical-pcm'}},wrapped=[];
  let description={playable:true};
  const scope=vm.createContext({isLocalChannelTarget:()=>true,localChannelDescription:()=>description,
    localChannelKeyboard:()=>physical[scope.editorChip],codeActive:true,editorChip:'ym2612',
    codeAudio:{keyboardTarget(name){wrapped.push(name);return null;}},isReferenceKeyboard:()=>false,isSongChannelTarget:()=>false,
    codeRuntime:null,codeControls:{isCodeMode:()=>false},editorSwitchPending:false,switchingAudioOutput:false,referenceRecordingStop:null,
    songTargetState:{source:'local',target:0,playback:'stopped'},songAuditionVoice:null});
  vm.runInContext(selectors+'\n'+input,scope);
  for(const chip of ['ym2612','psg','pcm']){
    scope.editorChip=chip;assert.equal(scope.getPlayableSynth(),physical[chip]);assert.equal(scope.isPerformanceInputEnabled(),true);
  }
  assert.deepEqual(wrapped,[],'physical CH keys never pass through the author-preset keyboard wrapper');
  for(const reason of ['DAC / PCM','CSM','zero playback step']){
    description={playable:false,reason};assert.equal(scope.isPerformanceInputEnabled(),false,reason);
  }
  description={playable:true};scope.codeControls.isCodeMode=()=>true;assert.equal(scope.isPerformanceInputEnabled(),true,'Code is a view; editable focus is handled by the input controller');
  scope.codeRuntime={getState:()=>({busy:true})};assert.equal(scope.isPerformanceInputEnabled(),false,'preparing/stopping Code still fences new notes');
});

test('local child-tab transitions never describe the previous chip channel through the new chip keyboard',()=>{
  const guard=source.slice(source.indexOf('function isLocalChannelTarget()'),source.indexOf('function localChannel()'));
  const input=source.slice(source.indexOf('function isPerformanceInputEnabled()'),source.indexOf('function getCurrentPerformanceVoice()'));
  const described=[],author={ym2612:{name:'author-fm'},psg:{name:'author-psg'},pcm:{name:'author-pcm'}};
  const physical={ym2612:{name:'physical-fm'},psg:{name:'physical-psg'},pcm:{name:'physical-pcm'}};
  const scope=vm.createContext({editorChip:'psg',songTargetState:{source:'local',chip:'pcm',target:'pcm:7',playback:'stopped'},
    localChannelKeyboard:()=>physical[scope.editorChip],
    localChannelDescription:()=>{
      const ch=Number(String(scope.songTargetState.target).split(':').at(-1)),max={ym2612:5,psg:3,pcm:7}[scope.editorChip];
      assert(ch<=max,'a transient old PCM CH8 must not be sent to a new FM/PSG description');described.push([scope.editorChip,ch]);return {playable:true};
    },
    codeActive:false,codeAudio:null,synth:{},editorPerformanceTarget:author.ym2612,pcmVoice:author.pcm,psgVoice:author.psg,
    pcmAudio:{getPcm:()=>({})},psgAudio:{getPsg:()=>({})},looper:null,
    isReferenceKeyboard:()=>false,isSongChannelTarget:()=>false,isFmSongPlaying:()=>false,isPsgSongPlaying:()=>false,isPcmReferenceKeyboard:()=>false,
    codeRuntime:null,codeControls:{isCodeMode:()=>false},editorSwitchPending:false,switchingAudioOutput:false,referenceRecordingStop:null,songAuditionVoice:null});
  vm.runInContext(guard+'\n'+selectors+'\n'+input,scope);
  for(const chip of ['psg','ym2612']){
    scope.editorChip=chip;assert.equal(scope.isLocalChannelTarget(),false);assert.equal(scope.getPlayableSynth(),author[chip]);
    assert.equal(scope.isPerformanceInputEnabled(),true);assert.deepEqual(described,[]);
  }
  scope.editorChip='pcm';assert(scope.isLocalChannelTarget());assert.equal(scope.getPlayableSynth(),physical.pcm);assert(scope.isPerformanceInputEnabled());
  scope.editorChip='psg';scope.songTargetState={source:'local',chip:'psg',target:'psg:3',playback:'stopped'};
  assert(scope.isLocalChannelTarget());assert.equal(scope.getPlayableSynth(),physical.psg);assert(scope.isPerformanceInputEnabled());
  assert.deepEqual(described,[['pcm',7],['psg',3]]);
});

test('clearing a previous Live view keeps the selected chip Auto tab instead of restoring the global FM author tab',()=>{
  const update=source.slice(source.indexOf('function setSongLiveView(next)'),source.indexOf('function formatLooperProgress('));
  for(const origin of ['vgm','local'])for(const chip of ['psg','pcm'])for(const previous of ['ym2612','psg','pcm']){
    const selected=[],editor={dataset:{}},panels=new Map();
    const scope=vm.createContext({editorChip:chip,activeInstrumentKind:'fm',songTargetState:{source:origin,chip,target:'synth',playback:origin==='vgm'?'playing':'stopped'},
      songLiveView:previous==='ym2612'?{editable:true}:null,songPsgLiveView:previous==='psg'?{editable:true}:null,
      songPcmLiveView:previous==='pcm'?{editable:true}:null,songPsgLiveSignature:'previous',songPcmLiveSignature:'previous',songObservationMode:previous,
      psgControlHardwarePlayback:false,isLocalChannelTarget:()=>false,isSongChannelTarget:()=>false,isPsgSongPlaying:()=>origin==='vgm',
      document:{querySelector:()=>editor,getElementById:id=>{if(!panels.has(id))panels.set(id,{});return panels.get(id);}},
      setFmSongLiveView:value=>{scope.songLiveView=value;},psgControls:{update(){}},pcmControls:{update(){}},
      psgLiveHighlighter:{update(){}},pcmLiveHighlighter:{update(){}},synthFiles:{refresh(){}},refreshChipAvailability(){},
      editorButtonForKind:kind=>kind,selectEditorChip:kind=>{selected.push(kind);scope.editorChip=kind;},
    });
    vm.runInContext(update,scope);scope.setSongLiveView(null);
    assert.deepEqual(selected,[],origin+' '+chip+' Auto is owned by the explicit target callback, not the previous Live view');
    assert.equal(scope.editorChip,chip);assert.equal(editor.dataset.liveView,'false');assert.equal(editor.dataset.liveEditable,'false');
    assert.equal(scope.songObservationMode,'editor');assert.equal(scope.songLiveView,null);assert.equal(scope.songPsgLiveView,null);assert.equal(scope.songPcmLiveView,null);
  }
});


test('Code view keeps performance available in normal, running and stopped states while transition guards remain',()=>{
  const input=source.slice(source.indexOf('function isPerformanceInputEnabled()'),source.indexOf('function getCurrentPerformanceVoice()'));
  const state={busy:false};
  const scope=vm.createContext({isLocalChannelTarget:()=>false,isReferenceKeyboard:()=>false,isSongChannelTarget:()=>false,
    codeRuntime:{getState:()=>state},codeControls:{isCodeMode:()=>true},editorSwitchPending:false,switchingAudioOutput:false,
    referenceRecordingStop:null,songTargetState:{playback:'stopped'}});
  vm.runInContext(input,scope);
  for(const running of[false,true]){state.running=running;assert.equal(scope.isPerformanceInputEnabled(),true);}
  for(const field of['editorSwitchPending','switchingAudioOutput','referenceRecordingStop']){
    scope[field]=true;assert.equal(scope.isPerformanceInputEnabled(),false,field);scope[field]=false;
  }
  scope.songTargetState.playback='seeking';assert.equal(scope.isPerformanceInputEnabled(),false);
  scope.songTargetState.playback='stopped';state.busy=true;assert.equal(scope.isPerformanceInputEnabled(),false);
  state.busy=false;assert.equal(scope.isPerformanceInputEnabled(),true);
});

test('a hand note reopens a retired Code fade only after ready and never during a newer transition',async()=>{
  const input=source.slice(source.indexOf('function isPerformanceInputEnabled()'),source.indexOf('function getCurrentPerformanceVoice()'));
  const state={busy:false};let opens=0,resuming=null;
  const scope=vm.createContext({isLocalChannelTarget:()=>false,isReferenceKeyboard:()=>false,isSongChannelTarget:()=>false,
    codeRuntime:{getState:()=>state},codeControls:{isCodeMode:()=>true},editorSwitchPending:false,switchingAudioOutput:false,
    referenceRecordingStop:null,songTargetState:{playback:'stopped'},codeActive:false,
    ensureAudioReady:async()=>{},codeOutput:{open(){opens++;}}});
  vm.runInContext(input,scope);
  await scope.ensurePerformanceAudioReady();assert.equal(opens,1,'idle Code view can play a new hand note');
  scope.codeActive=true;await scope.ensurePerformanceAudioReady();assert.equal(opens,1,'a running Code session keeps its existing gate');
  scope.codeActive=false;state.busy=true;await scope.ensurePerformanceAudioReady();assert.equal(opens,1,'a pending Stop fade remains closed');
  state.busy=false;scope.ensureAudioReady=()=>new Promise(resolve=>{resuming=resolve;});
  const pending=scope.ensurePerformanceAudioReady();scope.switchingAudioOutput=true;resuming();await pending;
  assert.equal(opens,1,'late audio readiness never opens the retired output');
});


test('idle recorder documents do not turn a Code view change into a physical all-notes-off',()=>{
  const activity=source.slice(source.indexOf('function hasActiveRecordingPerformance()'),source.indexOf('function eventRecordingBlocked()'));
  const scope=vm.createContext({currentLooperCapture:null,referenceRecordingStop:null,eventRecordSessionActive:false,
    looper:{getState:()=>({running:false,recording:false,busy:false,unitCount:2})},psgLooper:null,pcmLooper:null,
    megaSynth:{isRecording:()=>false,isRecordingPlaybackActive:()=>false},psgEventRecorder:null,pcmEventRecorder:null});
  vm.runInContext(activity,scope);assert.equal(scope.hasActiveRecordingPerformance(),false,'saved idle takes do not own live notes');
  for(const field of['running','recording','armed','busy']){
    scope.pcmLooper={getState:()=>({[field]:true})};assert.equal(scope.hasActiveRecordingPerformance(),true,field);scope.pcmLooper=null;
  }
  scope.looper._stopping=Promise.resolve();assert.equal(scope.hasActiveRecordingPerformance(),true,'pending FM loop cleanup remains fenced');delete scope.looper._stopping;
  scope.psgEventRecorder={isRecording:()=>false,isRecordingPlaybackActive:()=>true};assert.equal(scope.hasActiveRecordingPerformance(),true);
  scope.psgEventRecorder=null;scope.referenceRecordingStop=Promise.resolve();assert.equal(scope.hasActiveRecordingPerformance(),true);
});

test('actual Keyboard/Code view callback preserves hand notes and only retires active recording work',()=>{
  const start=source.lastIndexOf('onModeChange:mode=>{')+'onModeChange:'.length;
  const end=source.indexOf('\n  },',start)+4;
  let recording=false,cleanups=0,opens=0;
  const scope=vm.createContext({codeActive:false,hasActiveRecordingPerformance:()=>recording,
    stopRecordingForReference:()=>{cleanups++;},stopAllNotes:()=>assert.fail('A view-only change must retain hand notes'),
    codeOutput:{open:()=>{opens++;}},updateKeyboardAvailability(){},updateLooperUi(){},updateEventRecordUi(){}});
  vm.runInContext('globalThis.changeMode='+source.slice(start,end),scope);
  scope.changeMode('code');scope.changeMode('keyboard');assert.equal(cleanups,0);assert.equal(opens,1);
  recording=true;scope.changeMode('code');assert.equal(cleanups,1,'actual recorder/looper ownership still retires before Code view');
  scope.codeActive=true;scope.changeMode('keyboard');scope.changeMode('code');assert.equal(cleanups,1,'Code tab changes never restart its cleanup');
});
