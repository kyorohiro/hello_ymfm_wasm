/** DX7 control endpoint for the Native renderer. PCM never crosses this bridge. */
import {createInitVoice,parseSysex,packVoice} from './msfa_dx7/src/sysex.js';
import {presetToVoice,voiceToPreset,validatePreset,validateOperator,validateOperators} from './msfa_dx7/src/preset.js';
import {Dx7VoiceInspector} from './playground_dx7_inspector.js?v=wonderswan-mode-2';

const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);return value;};
const abort=()=>new DOMException('Native DX7 operation was cancelled','AbortError');
const patchMethods=new Set(['setPreset','setOperator','setOperators','setFeedback','selectVoice','loadSysex']);
const copyBank=voices=>voices.map(voice=>voice.slice());
const bankState=(voices,selectedVoice,sampleRate,stateRevision)=>({sampleRate,internalSampleRate:44100,
  voices:voices.map((voice,index)=>({index,name:voiceToPreset(voice).name})),selectedVoice,stateRevision});

// Both bases are valid raw voices. Their union identifies explicitly supplied
// fields even when an edit happens to equal the current value. Keep the codec
// authoritative instead of duplicating its operator/VCED offset table here.
function maskedPatch(patch){
  const zero=new Uint8Array(155),one=new Uint8Array(155).fill(1);
  const voice=presetToVoice(patch,zero),other=presetToVoice(patch,one),indices=[];
  for(let index=0;index<155;index++)if(voice[index]!==zero[index]||other[index]!==one[index])indices.push(index);
  return {voice:Array.from(voice),indices};
}

export function createNativeGenesisDx7(synth){
  let applied={voices:[createInitVoice()],selectedVoice:0},logical={voices:copyBank(applied.voices),selectedVoice:0};
  let nextCommand=0,nextVoice=0,stateRevision=0,serial=Promise.resolve(),dead=false,optimisticSelected=null,selectionSequence=0,inspectorRequests=null;
  const pending=new Map(),listeners=new Set(),notes=new Map(),auditionVoices=new Map();
  const check=()=>{if(dead)throw new Error('Native DX7 endpoint is closed');if(!synth.isReady())throw new Error('Native DX7 audio is not ready');if(synth.stopping||synth.closing)throw abort();};
  const token=()=>{check();return {session:synth.session,generation:synth.generation};};
  const current=lease=>{check();if(lease.session!==synth.session||lease.generation!==synth.generation)throw abort();};
  const allocateVoice=()=>{if(nextVoice>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native DX7 voice lease limit exceeded');return ++nextVoice;};
  function applyProjection(state,message){
    if(message.method==='load-bank'){state.voices=message.voices.map(voice=>new Uint8Array(voice));state.selectedVoice=0;}
    else if(message.method==='select-voice'){if(message.index<state.voices.length)state.selectedVoice=message.index;}
    else if(message.method==='set-preset')state.voices[state.selectedVoice]=new Uint8Array(message.voice);
    else if(message.method==='edit-voice'){
      const voice=state.voices[state.selectedVoice];for(const index of message.indices)voice[index]=message.voice[index];
    }
  }
  function rebuild(){
    logical={voices:copyBank(applied.voices),selectedVoice:applied.selectedVoice};
    for(const item of [...pending.values()].sort((a,b)=>a.frame-b.frame||a.id-b.id))applyProjection(logical,item.message);
    stateRevision++;
  }
  const state=()=>bankState(logical.voices,logical.selectedVoice,synth.clock.sampleRate||44100,stateRevision);
  function notify(){const value=state();for(const listener of listeners)listener(value);synth.emit({type:'native-state',name:'dx7',state:value});}
  function adopt(snapshot){
    if(!snapshot||!Array.isArray(snapshot.voices)||!snapshot.voices.length||snapshot.voices.length>32||
      !Number.isInteger(snapshot.selectedVoice)||snapshot.selectedVoice<0||snapshot.selectedVoice>=snapshot.voices.length||
      !Array.isArray(snapshot.pendingCommands)||snapshot.pendingCommands.some(id=>!Number.isSafeInteger(id)||id<1)||
      !Array.isArray(snapshot.activeNotes)||snapshot.activeNotes.some(note=>!Number.isInteger(note?.midi)||note.midi<0||note.midi>127||!Number.isInteger(note.velocity)||note.velocity<1||note.velocity>127))throw new Error('Native DX7 returned an invalid snapshot');
    const voices=snapshot.voices.map(bytes=>{const voice=new Uint8Array(bytes);if(voice.length!==155||!Array.isArray(bytes)||bytes.some(v=>!Number.isInteger(v)||v<0||v>127))throw new Error('Native DX7 returned an invalid voice');packVoice(voice);return voice;});
    applied={voices,selectedVoice:snapshot.selectedVoice};
    const awaiting=new Set(snapshot.pendingCommands);for(const [id,item]of pending)if(item.accepted&&!awaiting.has(id))pending.delete(id);
    if(Array.isArray(snapshot.activeNotes)){
      inspector.notes.clear();for(const note of snapshot.activeNotes){if(Number.isInteger(note.midi)&&note.midi>=0&&note.midi<=127&&Number.isInteger(note.velocity)&&note.velocity>0&&note.velocity<=127)inspector.notes.set(note.midi,note.velocity);}
    }
    rebuild();notify();return snapshot;
  }
  function normalize(method,args){
    if(!Array.isArray(args))throw new TypeError('DX7 arguments must be an array');
    switch(method){
      case 'loadSysex':return {method:'load-bank',voices:parseSysex(args[0]).voices.map(voice=>Array.from(voice.data))};
      case 'setPreset':validatePreset(args[0]);return {method:'set-preset',voice:Array.from(presetToVoice(args[0]))};
      case 'setOperator':validateOperator(args[0],args[1]);return {method:'edit-voice',...maskedPatch({operators:{[args[0]]:args[1]}})};
      case 'setOperators':validateOperators(args[0]);return {method:'edit-voice',...maskedPatch({operators:Object.fromEntries(args[0])})};
      case 'setFeedback':integer(args[0],7,'Feedback');return {method:'edit-voice',...maskedPatch({feedback:args[0]})};
      case 'selectVoice':integer(args[0],logical.voices.length-1,'Voice index');return {method:'select-voice',index:args[0]};
      case 'noteOn':integer(args[0],127,'MIDI note');integer(args[1]??100,127,'Velocity');return args[1]===0?{method:'note-off',note:args[0]}:{method:'note-on',note:args[0],velocity:args[1]??100};
      case 'noteOff':integer(args[0],127,'MIDI note');return {method:'note-off',note:args[0]};
      case 'allNotesOff':return {method:'all-notes-off'};
      case 'panic':case 'stopVoices':return {method:'panic'};
      default:throw new Error(`Unsupported Native DX7 operation: ${method}`);
    }
  }
  async function perform(method,args=[],timing={},auditionOwner,prepared){
    const lease=token();
    if(method==='dispose')return;
    if(method==='getState'||method==='getPreset'){
      await refresh();current(lease);return method==='getState'?state():voiceToPreset(logical.voices[logical.selectedVoice]);
    }
    const message=prepared??normalize(method,args);
    if(!auditionOwner&&inspector.blocked({method,args})&&!['allNotesOff','panic','stopVoices'].includes(method)){
      if(method==='loadSysex')throw new Error('DX7 is held by a manual audition');
      return state();
    }
    if(nextCommand>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native DX7 command identity limit exceeded');
    const id=++nextCommand;message.id=id;
    if(auditionOwner)message.audition=true;
    const noteKey=`${timing.performance??'main'}:${timing.owner??'main'}:${message.note}`;
    if(message.method==='note-on'){
      const voice=allocateVoice();message.voice=voice;
      if(auditionOwner)auditionVoices.set(message.note,{owner:auditionOwner,voice});else notes.set(noteKey,voice);
    }
    if(message.method==='note-off'){
      const held=auditionOwner?auditionVoices.get(message.note):null;
      const voice=auditionOwner?(held?.owner===auditionOwner?held.voice:undefined):notes.get(noteKey);
      if(voice!==undefined)message.voice=voice;
      if(!auditionOwner)notes.delete(noteKey);else if(held?.owner===auditionOwner)auditionVoices.delete(message.note);
    }
    const frame=method==='loadSysex'||timing.time===undefined?0:synth.frameAt(timing.time);
    const command={type:'dx7',frame,message,...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})};
    if(patchMethods.has(method)){
      if(pending.size>=65536){await refresh();current(lease);if(pending.size>=65536)throw new RangeError('Native DX7 patch queue is full');}
      pending.set(id,{id,frame,message,accepted:false,performance:timing.performance,owner:timing.owner});
    }
    try{synth.enqueue(command);await synth.flush();current(lease);}
    catch(error){pending.delete(id);rebuild();throw error;}
    if(patchMethods.has(method)){const item=pending.get(id);if(item)item.accepted=true;rebuild();notify();}
    if(!timing.time)inspector.observe({method,args});
    return state();
  }
  // Serialize preparation/projections across Main, the direct Worker port, and
  // inspector edits. This order never waits for a future sound frame.
  function dispatch(method,args=[],timing={},owner){
    const lease=token(),prepared=['getState','getPreset','dispose'].includes(method)?undefined:normalize(method,args);
    // Normalize while still on the caller's stack. Mutable presets and SysEx
    // views cannot change a queued edit after the public call returns.
    // The normalized command already owns compact copies of every preset or
    // bank. Do not clone a tiny SysEx view's potentially huge backing buffer.
    const copied=['noteOn','noteOff'].includes(method)?args.slice():[],timed={...timing};
    const result=serial.then(()=>{current(lease);return perform(method,copied,timed,owner,prepared);});serial=result.catch(()=>{});return result;
  }
  async function refresh(){const lease=token(),snapshot=await synth.nativeRequest('native_genesis_dx7_status');current(lease);return adopt(snapshot);}
  const inspector=new Dx7VoiceInspector({sampleRate:synth.clock.sampleRate||44100,internalSampleRate:44100,
    getApplied:()=>applied,getLogical:()=>({...logical,pendingCommands:pending.size}),
    dispatch:(command,owner)=>{const promise=dispatch(command.method,command.args,{},owner);if(inspectorRequests)inspectorRequests.push(promise);else promise.catch(error=>synth.reportAsyncError(error));return promise;},beginAudition(){},
    endAudition(){}});
  const report=promise=>{promise.catch(error=>{if(error?.name!=='AbortError')synth.reportAsyncError(error);});};
  const client={id:'dx7',internalSampleRate:44100,
    get sampleRate(){return synth.clock.sampleRate||44100;},get voices(){return state().voices;},get selectedVoice(){return optimisticSelected??logical.selectedVoice;},
    _getState:state,_onStateChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    _adoptState(){return false;},_stopVoices(){return dispatch('stopVoices');},getState(){return dispatch('getState');},
    async loadSysex(bytes){return (await dispatch('loadSysex',[bytes])).voices;},
    async setPreset(preset){await dispatch('setPreset',[preset]);},async setOperator(operator,params){await dispatch('setOperator',[operator,params]);},
    async setOperators(entries){await dispatch('setOperators',[entries]);},async setFeedback(value){await dispatch('setFeedback',[value]);},
    getPreset(){return dispatch('getPreset');},selectVoice(index){normalize('selectVoice',[index]);const version=++selectionSequence;optimisticSelected=index;const promise=dispatch('selectVoice',[index]);report(promise.finally(()=>{if(version===selectionSequence)optimisticSelected=null;}));},
    noteOn(note,velocity=100){normalize('noteOn',[note,velocity]);report(dispatch('noteOn',[note,velocity]));},
    noteOff(note){normalize('noteOff',[note]);report(dispatch('noteOff',[note]));},allNotesOff(){report(dispatch('allNotesOff'));},panic(){report(dispatch('panic'));},dispose(){},
  };
  return {client,async dispatch(message,timing={}){
    const value=await dispatch(message.method,message.args??[],timing);
    return message.id===undefined?undefined:{id:message.id,value:message.method==='getPreset'?value:state()};
  },async read(){await dispatch('getState');inspector.sampleRate=synth.clock.sampleRate;return inspector.read();},
  async invoke(method,args=[]){
    await serial;await refresh();const requests=[];let result,failure;inspectorRequests=requests;
    try{result=inspector.invoke(method,args);}catch(error){failure=error;}finally{inspectorRequests=null;}
    await Promise.all(requests);if(failure)throw failure;await synth.flush();await refresh();
    return ['auditionOn','auditionOff','auditionAllOff'].includes(method)?result:inspector.read();
  },
  async mix(volume,pan){check();synth.enqueue({type:'dx7',frame:0,message:{method:'mix',volume,pan}});await synth.flush();},
  async performance(request){
    const prefix=request.op==='cancel-owner'?`${request.performance}:${request.owner}:`:null;
    for(const key of notes.keys())if(prefix?key.startsWith(prefix):!key.startsWith('main:'))notes.delete(key);
    for(const [id,item]of pending)if(request.op==='cancel-owner'?
      item.performance===request.performance&&item.owner===request.owner:item.performance!==undefined)pending.delete(id);
    rebuild();notify();
    // Cancellations may retire already admitted future patches. Refresh only
    // at this explicit lifecycle event; ordinary playback has no state poll.
    await dispatch('getState');
  },
  stopped(){inspector.auditions.clear();inspector.byMidi.clear();inspector.notes.clear();notes.clear();auditionVoices.clear();pending.clear();optimisticSelected=null;selectionSequence++;},
  adoptStopped(snapshot){this.stopped();adopt(snapshot);},
  reset(){this.stopped();applied={voices:[createInitVoice()],selectedVoice:0};rebuild();notify();},
  dispose(){dead=true;listeners.clear();pending.clear();notes.clear();auditionVoices.clear();},};
}
