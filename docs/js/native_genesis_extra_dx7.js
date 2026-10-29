/** Independently owned Native DX7. Only controls and explicit snapshots cross
 * this endpoint; its sixteen allocated voices render on the Native callback. */
import {createInitVoice,parseSysex,packVoice} from './msfa_dx7/src/sysex.js';
import {presetToVoice,voiceToPreset,validatePreset,validateOperator,validateOperators} from './msfa_dx7/src/preset.js';
import {Dx7VoiceInspector} from './playground_dx7_inspector.js?v=ps1-deferred-release-1';
import {createNativeVoiceContext,nativeInteger as integer} from './native_genesis_voice_endpoint.js?v=ps1-deferred-release-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=ps1-native-1';

export const EXTRA_DX7_VOICE_HELD_ERROR='Release the manually held additional DX7 voices before changing the voice';
const patchMethods=new Set(['loadSysex','selectVoice','setPreset','setOperator','setOperators','setFeedback']);
const abort=()=>new DOMException('Native additional DX7 operation was cancelled','AbortError');
const copyBank=voices=>voices.map(voice=>voice.slice());
// Let the preset codec identify supplied fields, including edits that equal an
// existing value. This keeps operator envelopes and the VCED layout authoritative.
function maskedPatch(patch){
  const zero=new Uint8Array(155),one=new Uint8Array(155).fill(1),voice=presetToVoice(patch,zero),other=presetToVoice(patch,one),indices=[];
  for(let index=0;index<155;index++)if(voice[index]!==zero[index]||other[index]!==one[index])indices.push(index);
  return {voice:Array.from(voice),indices};
}
export function createNativeGenesisExtraDx7Endpoint(synth){
  const context=createNativeVoiceContext(synth,{backend:'extra-dx7',statusCommand:'native_genesis_extra_dx7_status',label:'additional DX7'}),{capture,current}=context;
  let applied={voices:[createInitVoice()],selectedVoice:0},logical={voices:copyBank(applied.voices),selectedVoice:0},serial=Promise.resolve(),editorSerial=Promise.resolve(),stateRevision=0,initialized=false,mainGroup,collection=null,editing=0,optimisticSelected=null,selectionSequence=0;
  const pending=new Map(),listeners=new Set(),operations=new Set(),notes=new Map(),auditionVoices=new Map();
  const state=()=>({sampleRate:synth.clock.sampleRate||44100,internalSampleRate:44100,voices:logical.voices.map((voice,index)=>({index,name:voiceToPreset(voice).name})),selectedVoice:logical.selectedVoice,stateRevision});
  const notify=()=>{const value=state();for(const listener of listeners)listener(value);synth.emit?.({type:'native-state',name:'dx7',state:value});};
  function project(target,message){
    if(message.method==='load-bank'){target.voices=message.voices.map(voice=>new Uint8Array(voice));target.selectedVoice=0;}
    else if(message.method==='select-voice'){if(message.index<target.voices.length)target.selectedVoice=message.index;}
    else if(message.method==='set-preset'&&message.indices===undefined)target.voices[target.selectedVoice]=new Uint8Array(message.voice);
    else if(message.method==='edit-voice'||message.method==='set-preset'){const voice=target.voices[target.selectedVoice];for(const index of message.indices)voice[index]=message.voice[index];}
  }
  function rebuild(){logical={voices:copyBank(applied.voices),selectedVoice:applied.selectedVoice};for(const item of [...pending.values()].sort((a,b)=>a.frame-b.frame||a.id-b.id))project(logical,item.message);stateRevision++;}
  function adopt(data){
    if(!data||!Array.isArray(data.voices)||!data.voices.length||data.voices.length>32||!Number.isInteger(data.selectedVoice)||data.selectedVoice<0||data.selectedVoice>=data.voices.length||!Array.isArray(data.activeNotes)||data.activeNotes.length>16||(data.held?.length??0)>16||data.activeNotes.some(note=>!Number.isInteger(note?.midi)||note.midi<0||note.midi>127||!Number.isInteger(note.velocity)||note.velocity<1||note.velocity>127))throw new Error('Native additional DX7 returned an invalid snapshot');
    context.validateHeld(data,127);
    const voices=data.voices.map(bytes=>{if(!Array.isArray(bytes)||bytes.length!==155||bytes.some(value=>!Number.isInteger(value)||value<0||value>127))throw new Error('Native additional DX7 returned an invalid voice');const voice=new Uint8Array(bytes);packVoice(voice);return voice;});
    applied={voices,selectedVoice:data.selectedVoice};const awaiting=new Set(data.pendingCommands??[]);for(const [id,item]of pending)if(item.accepted&&!awaiting.has(id))pending.delete(id);
    inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.notes.clear();for(const {midi,velocity}of data.activeNotes)inspector.notes.set(midi,velocity);
    if(data.held&&!editing){const held=new Set(data.held);for(const [id,{midi}]of inspector.auditions)if(!held.has(midi)){inspector.auditions.delete(id);inspector.byMidi.delete(midi);auditionVoices.delete(midi);}}
    rebuild();return data;
  }
  async function snapshot(args={}){const token=capture(),result=args.after===undefined?await synth.nativeRequest('native_genesis_extra_dx7_status',args):await synth.observeNativeSnapshot('native_genesis_extra_dx7_status',args);current(token);if(!result?.dx7||typeof result.dx7!=='object')throw new Error('Native additional DX7 returned an invalid snapshot');return adopt({...result.dx7,sampleRate:result.sampleRate??result.dx7.sampleRate,frame:result.frame??result.dx7.frame,revision:result.revision??result.dx7.revision});}
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
      default:throw new Error(`Unsupported Native additional DX7 operation: ${method}`);
    }
  }
  const key=(op,note)=>`${op.performance??'main'}:${op.owner??op.group??'main'}:${note}`;
  function operation(timing={},group=mainGroup){if(operations.size>=256)throw new RangeError('Native additional DX7 preparation request queue is full');const token=capture(),op={group,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(op);op.check=()=>{current(token);timing.checkCurrent?.();if(op.cancelled)throw abort();};return op;}
  function cancel(matches){for(const op of operations)if(matches(op))op.cancelled=true;for(const [id,item]of pending)if(matches(item))pending.delete(id);for(const [id,item]of notes)if(matches(item))notes.delete(id);rebuild();notify();}
  const send=(message,timing={},group)=>context.send('dx7',{...(group===undefined?{}:{group}),...message},timing);
  async function perform(method,args,timing,owner,prepared,op){
    op.check();if(method==='dispose')return true;
    if(method==='getState'||method==='getPreset'){await snapshot();op.check();return method==='getState'?state():voiceToPreset(logical.voices[logical.selectedVoice]);}
    const message={...prepared,id:context.identity()};if(owner)message.audition=true;
    const noteKey=key(op,message.note);
    if(message.method==='note-on'){
      const voice=context.identity();message.voice=voice;
      if(owner)auditionVoices.set(message.note,{owner,voice});else notes.set(noteKey,{voice,group:op.group,performance:op.performance,owner:op.owner});
    }else if(message.method==='note-off'){
      const held=owner?auditionVoices.get(message.note):notes.get(noteKey),voice=owner?(held?.owner===owner?held.voice:undefined):held?.voice;
      // An old key release must never become an unqualified note-off after its
      // newer audition stole the same MIDI note.
      if(owner&&voice===undefined)return state();if(voice!==undefined)message.voice=voice;
      if(owner)auditionVoices.delete(message.note);else notes.delete(noteKey);
    }
    const frame=method==='loadSysex'||timing.time===undefined?0:synth.frameAt(timing.time);
    if(patchMethods.has(method)){
      if(pending.size>=65536){await snapshot();op.check();if(pending.size>=65536)throw new RangeError('Native additional DX7 patch queue is full');}
      pending.set(message.id,{id:message.id,frame,message,accepted:false,group:op.group,performance:op.performance,owner:op.owner});
    }
    try{send(message,{...timing,...(method==='loadSysex'?{time:undefined}:{})},op.group);await synth.flush();op.check();}
    catch(error){pending.delete(message.id);rebuild();throw error;}
    const item=pending.get(message.id);if(item)item.accepted=true;rebuild();notify();
    if(owner){await snapshot({after:message.id});op.check();}
    return state();
  }
  // This serial orders admission and preparation only. Future sound frames do
  // not hold up Worker cancellation or another port's explicit applied read.
  function dispatch(method,args=[],timing={},owner,override){
    const op=operation(timing);let prepared;try{prepared=override??(['getState','getPreset','dispose'].includes(method)?undefined:normalize(method,args));}catch(error){operations.delete(op);throw error;}
    const copied=['noteOn','noteOff'].includes(method)?args.slice():[],timed={...timing};
    const result=serial.then(()=>perform(method,copied,timed,owner,prepared,op)).finally(()=>operations.delete(op));serial=result.catch(()=>{});return result;
  }
  const inspector=new Dx7VoiceInspector({sampleRate:synth.clock.sampleRate||44100,internalSampleRate:44100,getApplied:()=>applied,getLogical:()=>({...logical,pendingCommands:pending.size}),dispatch(command,owner){if(!collection)throw new Error('DX7 inspector command outside an edit');collection.push({command,owner});},beginAudition(){},endAudition(){}});
  const report=promise=>promise.catch(error=>{if(error?.name!=='AbortError')synth.reportAsyncError(error);});
  const client={internalSampleRate:44100,get sampleRate(){return synth.clock.sampleRate||44100;},get voices(){return state().voices;},get selectedVoice(){return optimisticSelected??logical.selectedVoice;},_getState:state,_onStateChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);},_adoptState(){return false;},
    _allocateMainOwner:()=>context.identity(),_withMainOwner(group,callback){const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}},
    _cancelMainOwner(group){cancel(op=>op.group===group);send({method:'cancel-main-owner',targetGroup:group,id:context.identity()});},
    _stopVoices(){return dispatch('stopVoices');},getState(){return dispatch('getState');},async loadSysex(bytes){return (await dispatch('loadSysex',[bytes])).voices;},
    async setPreset(preset){await dispatch('setPreset',[preset]);},async setOperator(operator,params){await dispatch('setOperator',[operator,params]);},async setOperators(entries){await dispatch('setOperators',[entries]);},async setFeedback(value){await dispatch('setFeedback',[value]);},getPreset(){return dispatch('getPreset');},
    selectVoice(index){normalize('selectVoice',[index]);const version=++selectionSequence;optimisticSelected=index;report(dispatch('selectVoice',[index]).finally(()=>{if(version===selectionSequence)optimisticSelected=null;}));},
    noteOn(note,velocity=100){normalize('noteOn',[note,velocity]);report(dispatch('noteOn',[note,velocity]));},noteOff(note){normalize('noteOff',[note]);report(dispatch('noteOff',[note]));},allNotesOff(){report(dispatch('allNotesOff'));},panic(){report(dispatch('panic'));},dispose(){},
  };
  return {client,async dispatch(message,timing={}){const value=await dispatch(message.method,message.args??[],timing);return message.id===undefined?undefined:{id:message.id,value:message.method==='getPreset'?value:state()};},
    async read(){await serial;await snapshot();return inspector.read();},
    invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=editorSerial.then(async()=>{
      current(token);await serial;await snapshot();current(token);const previous=new Map(inspector.auditions),previousByMidi=new Map(inspector.byMidi),previousVoices=new Map(auditionVoices);let value,commands;collection=[];
      try{value=inspector.invoke(method,copy);commands=collection;}finally{collection=null;}
      editing++;try{for(const {command,owner}of commands){
        // Inspector setPreset is a partial patch of the audible voice. Keep its
        // mask instead of copying unrelated applied bytes over future authors.
        // Keep set-preset's new cohort: subsequent live operator edits must not
        // retune notes that still belong to the previous algorithm/envelope.
        const prepared=method==='setPreset'&&command.method==='setPreset'?{method:'set-preset',...maskedPatch(copy[0])}:undefined;
        await dispatch(command.method,command.args??[],{},owner??'voice-editor:edit',prepared);
      }}catch(error){inspector.auditions=previous;inspector.byMidi=previousByMidi;auditionVoices.clear();for(const [midi,entry]of previousVoices)auditionVoices.set(midi,entry);throw error;}finally{editing--;}
      current(token);if(commands.length)await snapshot();current(token);return ['auditionOn','auditionOff','auditionAllOff'].includes(method)?value:inspector.read();
    });editorSerial=result.catch(()=>{});return result;},
    cancelOwner:(performance,owner)=>cancel(op=>op.performance===performance&&op.owner===owner),cancelPerformance:performance=>cancel(op=>op.performance!==undefined&&(performance===null||op.performance===performance)),
    async initialize(){const token=capture();context.enable('dx7');if(initialized)return;await snapshot();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid DX7 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){cancel(()=>true);context.invalidate();context.disable('dx7');initialized=false;mainGroup=undefined;listeners.clear();pending.clear();notes.clear();auditionVoices.clear();inspector.auditions.clear();inspector.byMidi.clear();inspector.notes.clear();optimisticSelected=null;selectionSequence++;},
  };
}
export async function createNativeGenesisExtraDx7(synth,options={}){const device=await createNativeGenesisExtraChip(synth,{...options,kind:'dx7',label:'DX7',layout:{polyphony:16},createEndpoint:createNativeGenesisExtraDx7Endpoint});Object.defineProperties(device,{sampleRate:{get:()=>device.client.sampleRate},internalSampleRate:{value:44100},voices:{get:()=>device.client.voices},selectedVoice:{get:()=>device.client.selectedVoice}});return device;}
